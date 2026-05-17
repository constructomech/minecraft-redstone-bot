#!/usr/bin/env node
/**
 * forge — combined daemon and CLI for Redstone Forge.
 *
 * Usage:
 *   node tools/forge.mjs daemon            # run the broker daemon
 *   node tools/forge.mjs health            # GET  /health
 *   node tools/forge.mjs anchor            # GET  /anchor
 *   node tools/forge.mjs echo <msg>        # POST /echo
 *   node tools/forge.mjs build <spec.json> # POST /build (waits for pack to apply)
 *   node tools/forge.mjs undo [jobId]      # POST /undo (waits for pack to apply)
 *
 * The daemon listens on FORGE_PORT (default 33000). The pack
 * heartbeats outbound to it (state) AND short-polls for queued
 * commands every ~250ms. Agent commands enqueue via /build, /undo;
 * the daemon holds the agent's request until the pack reports a
 * result, then forwards it back.
 *
 * Token + URL are read from .env at the repo root.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

async function loadEnv() {
  const envPath = path.join(repoRoot, ".env");
  try {
    const content = await readFile(envPath, "utf8");
    const out = {};
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return out;
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

const env = await loadEnv();
const PORT = Number.parseInt(env.FORGE_PORT ?? "33000", 10);
const TOKEN = env.FORGE_TOKEN;
const URL_BASE = env.FORGE_URL ?? `http://127.0.0.1:${PORT}`;
const cmd = process.argv[2] ?? "help";

if (!TOKEN && cmd !== "help") {
  console.error("FORGE_TOKEN missing from .env. Run pack-deploy.ps1 first.");
  process.exit(1);
}

switch (cmd) {
  case "daemon":  runDaemon();           break;
  case "health":  await cliCall("GET", "/health"); break;
  case "anchor":  await cliCall("GET", "/anchor"); break;
  case "echo":    await cliCall("POST", "/echo", process.argv.slice(3).join(" ")); break;
  case "build":   await cliBuild(process.argv[3]); break;
  case "undo":    await cliCall("POST", "/undo", JSON.stringify(process.argv[3] ? { jobId: process.argv[3] } : {}), "application/json"); break;
  case "redo":    await cliCall("POST", "/redo", JSON.stringify(process.argv[3] ? { jobId: process.argv[3] } : {}), "application/json"); break;
  case "test":    await cliTest(process.argv[3], process.argv[4]); break;
  case "world":   await cliWorld(process.argv.slice(3)); break;
  case "help":
  default:        printHelp(); process.exit(cmd === "help" ? 0 : 2);
}

function printHelp() {
  console.log(`Usage:
  node tools/forge.mjs daemon                      run the broker daemon
  node tools/forge.mjs health                      GET  /health
  node tools/forge.mjs anchor                      GET  /anchor
  node tools/forge.mjs echo <message>              POST /echo
  node tools/forge.mjs build <spec.json>           POST /build  (blocks up to 30s)
  node tools/forge.mjs undo [jobId]                POST /undo
  node tools/forge.mjs redo [jobId]                POST /redo
  node tools/forge.mjs test [jobId] [test]         POST /test
  node tools/forge.mjs world <x1> <y1> <z1> <x2> <y2> <z2>   GET /world?bounds=...

Reads FORGE_PORT, FORGE_URL, FORGE_TOKEN from .env at the repo root.`);
}

// ──────────────────────────────────────────────────────────────
// Daemon
// ──────────────────────────────────────────────────────────────

function runDaemon() {
  /** Cached pack state from heartbeats. */
  const state = {
    anchor: null,
    packVersion: null,
    lastHeartbeat: null,
    heartbeatCount: 0,
    startedAt: new Date().toISOString(),
  };

  /** FIFO queue of commands waiting for the pack to poll for them. */
  const pendingCommands = [];

  /** Map<jobId, { resolve, reject, timer, agentReq }> for in-flight agent requests. */
  const awaiting = new Map();

  const AGENT_REQUEST_TIMEOUT_MS = 30_000;

  function enqueueCommand(type, payload) {
    return new Promise((resolve, reject) => {
      const jobId = randomUUID();
      const timer = setTimeout(() => {
        awaiting.delete(jobId);
        // also try to remove from pending queue if it never got picked up
        const idx = pendingCommands.findIndex((c) => c.jobId === jobId);
        if (idx >= 0) pendingCommands.splice(idx, 1);
        reject(new Error(`pack did not return a result for ${type} within ${AGENT_REQUEST_TIMEOUT_MS}ms`));
      }, AGENT_REQUEST_TIMEOUT_MS);
      awaiting.set(jobId, { resolve, reject, timer });
      pendingCommands.push({ jobId, type, payload });
    });
  }

  const server = createServer(async (req, res) => {
    const reqStart = Date.now();
    let logged = false;
    const finish = (status) => {
      if (logged) return;
      logged = true;
      const ms = Date.now() - reqStart;
      console.log(`${new Date().toISOString()} ${req.method} ${req.url} ${status} ${ms}ms`);
    };

    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
      const tokenHeader = req.headers["x-forge-token"];
      if (tokenHeader !== TOKEN) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        finish(401);
        return;
      }

      let body = "";
      if (req.method !== "GET" && req.method !== "HEAD") {
        for await (const chunk of req) body += chunk;
      }

      const send = (status, payload) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
        finish(status);
      };

      // ---- pack → daemon ----

      if (req.method === "POST" && url.pathname === "/heartbeat") {
        let parsed;
        try { parsed = JSON.parse(body || "{}"); }
        catch { return send(400, { error: "invalid json" }); }
        state.anchor = parsed.anchor ?? null;
        state.packVersion = parsed.packVersion ?? null;
        state.lastHeartbeat = new Date().toISOString();
        state.heartbeatCount += 1;
        return send(200, { ok: true });
      }

      if (req.method === "POST" && url.pathname === "/poll") {
        // Hand all pending commands to the pack at once and clear queue.
        const commands = pendingCommands.splice(0, pendingCommands.length);
        return send(200, { commands });
      }

      if (req.method === "POST" && url.pathname === "/result") {
        let parsed;
        try { parsed = JSON.parse(body || "{}"); }
        catch { return send(400, { error: "invalid json" }); }
        const { jobId, result } = parsed;
        if (!jobId) return send(400, { error: "missing jobId" });
        const entry = awaiting.get(jobId);
        if (!entry) {
          // late result (timeout already fired, or duplicate). Log and ack.
          console.warn(`/result for unknown jobId ${jobId}; agent already moved on`);
          return send(200, { ok: true, note: "no pending agent request" });
        }
        clearTimeout(entry.timer);
        awaiting.delete(jobId);
        entry.resolve(result);
        return send(200, { ok: true });
      }

      // ---- agent → daemon ----

      if (req.method === "GET" && url.pathname === "/health") {
        return send(200, {
          ok: true,
          anchor: state.anchor,
          packVersion: state.packVersion,
          lastHeartbeat: state.lastHeartbeat,
          heartbeatCount: state.heartbeatCount,
          daemonStartedAt: state.startedAt,
          pendingCommands: pendingCommands.length,
          awaitingResults: awaiting.size,
        });
      }

      if (req.method === "GET" && url.pathname === "/anchor") {
        return send(200, state.anchor);
      }

      if (req.method === "POST" && url.pathname === "/echo") {
        return send(200, { echo: body });
      }

      if (req.method === "POST" && url.pathname === "/build") {
        let payload;
        try { payload = JSON.parse(body || "{}"); }
        catch { return send(400, { error: "invalid json" }); }
        if (!payload.spec) return send(400, { error: "body must be { spec: <ContraptionSpec> }" });
        try {
          const result = await enqueueCommand("build", { spec: payload.spec });
          const status = result?.ok === false ? 422 : 200;
          return send(status, result);
        } catch (err) {
          return send(504, { ok: false, error: String(err.message ?? err) });
        }
      }

      if (req.method === "POST" && url.pathname === "/undo") {
        let payload = {};
        if (body.trim()) {
          try { payload = JSON.parse(body); }
          catch { return send(400, { error: "invalid json" }); }
        }
        try {
          const result = await enqueueCommand("undo", { jobId: payload.jobId });
          const status = result?.ok === false ? 422 : 200;
          return send(status, result);
        } catch (err) {
          return send(504, { ok: false, error: String(err.message ?? err) });
        }
      }

      if (req.method === "POST" && url.pathname === "/test") {
        let payload = {};
        if (body.trim()) {
          try { payload = JSON.parse(body); }
          catch { return send(400, { error: "invalid json" }); }
        }
        try {
          const result = await enqueueCommand("test", {
            jobId: payload.jobId,
            testName: payload.testName,
          });
          const status = result?.ok === false ? 422 : 200;
          return send(status, result);
        } catch (err) {
          return send(504, { ok: false, error: String(err.message ?? err) });
        }
      }

      if (req.method === "POST" && url.pathname === "/redo") {
        let payload = {};
        if (body.trim()) {
          try { payload = JSON.parse(body); }
          catch { return send(400, { error: "invalid json" }); }
        }
        try {
          const result = await enqueueCommand("redo", { jobId: payload.jobId });
          const status = result?.ok === false ? 422 : 200;
          return send(status, result);
        } catch (err) {
          return send(504, { ok: false, error: String(err.message ?? err) });
        }
      }

      if (req.method === "GET" && url.pathname === "/world") {
        const boundsStr = url.searchParams.get("bounds");
        const dimension = url.searchParams.get("dimension") ?? "minecraft:overworld";
        if (!boundsStr) return send(400, { error: "missing bounds= query param (format: x1,y1,z1,x2,y2,z2)" });
        const parts = boundsStr.split(",").map((s) => Number.parseInt(s.trim(), 10));
        if (parts.length !== 6 || parts.some((n) => !Number.isInteger(n))) {
          return send(400, { error: "bounds must be 6 comma-separated integers" });
        }
        try {
          const result = await enqueueCommand("world", { bounds: parts, dimension });
          const status = result?.ok === false ? 422 : 200;
          return send(status, result);
        } catch (err) {
          return send(504, { ok: false, error: String(err.message ?? err) });
        }
      }

      // GET /spec/<name> — read a spec JSON from disk for the
      // pack-side /rsforge:build slash command. Looks in specs/,
      // specs/examples/, and patterns/ in that order.
      if (req.method === "GET" && url.pathname.startsWith("/spec/")) {
        const name = decodeURIComponent(url.pathname.substring("/spec/".length));
        if (!/^[a-z0-9][a-z0-9_\-]*$/i.test(name)) {
          return send(400, { error: `invalid spec name: ${name}` });
        }
        const candidates = [
          `specs/${name}.json`,
          `specs/examples/${name}.json`,
          `patterns/${name}.json`,
        ];
        for (const rel of candidates) {
          const abs = path.join(repoRoot, rel);
          try {
            const content = await readFile(abs, "utf8");
            const spec = JSON.parse(content);
            return send(200, { source: rel, spec });
          } catch (err) {
            if (err.code === "ENOENT") continue;
            return send(500, { error: `failed to read ${rel}: ${err.message}` });
          }
        }
        return send(404, { error: `spec '${name}' not found in specs/, specs/examples/, or patterns/` });
      }

      send(404, { error: "not found", path: url.pathname });
    } catch (err) {
      console.error("handler error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
      finish(500);
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`forge daemon listening on http://127.0.0.1:${PORT}`);
    console.log(`(authenticated routes require header X-Forge-Token)`);
  });
}

// ──────────────────────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────────────────────

async function cliBuild(specPath) {
  if (!specPath) {
    console.error("forge build: missing <spec.json> path");
    process.exit(2);
  }
  let raw;
  try {
    raw = await readFile(path.resolve(repoRoot, specPath), "utf8");
  } catch (err) {
    console.error(`forge build: cannot read ${specPath}: ${err.message}`);
    process.exit(2);
  }
  let spec;
  try {
    spec = JSON.parse(raw);
  } catch (err) {
    console.error(`forge build: ${specPath} is not valid JSON: ${err.message}`);
    process.exit(2);
  }
  await cliCall("POST", "/build", JSON.stringify({ spec }), "application/json");
}

async function cliTest(jobId, testName) {
  const body = {};
  if (jobId) body.jobId = jobId;
  if (testName) body.testName = testName;
  await cliCall("POST", "/test", JSON.stringify(body), "application/json");
}

async function cliWorld(coords) {
  if (coords.length < 6) {
    console.error("forge world: need six integers (x1 y1 z1 x2 y2 z2)");
    process.exit(2);
  }
  const bounds = coords.slice(0, 6).join(",");
  await cliCall("GET", `/world?bounds=${bounds}`);
}

async function cliCall(method, route, body, contentType) {
  const headers = { "X-Forge-Token": TOKEN };
  if (body !== undefined) {
    headers["Content-Type"] = contentType ?? (method === "POST" ? "text/plain" : "application/json");
  }

  let res;
  try {
    res = await fetch(`${URL_BASE}${route}`, { method, headers, body });
  } catch (err) {
    console.error(`forge ${cmd}: connection failed (${err.code ?? err.name}). Is the daemon running?`);
    console.error(`  start it with: node tools/forge.mjs daemon`);
    process.exit(1);
  }
  const text = await res.text();
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
  process.exit(res.ok ? 0 : 1);
}
