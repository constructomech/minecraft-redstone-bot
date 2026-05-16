#!/usr/bin/env node
/**
 * forge — combined daemon and CLI for Redstone Forge.
 *
 * Usage:
 *   node tools/forge.mjs daemon            # run the broker daemon
 *   node tools/forge.mjs health            # GET  /health
 *   node tools/forge.mjs anchor            # GET  /anchor
 *   node tools/forge.mjs echo <msg>        # POST /echo
 *
 * The daemon listens on FORGE_PORT (default 33000), accepts
 * authenticated heartbeats from the pack, and exposes the cached state
 * to the agent / CLI. The CLI is just a thin wrapper that calls the
 * daemon over HTTP.
 *
 * Token + URL are read from .env at the repo root (created by
 * tools/pack-deploy.ps1 on first deploy).
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
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
  case "help":
  default:        printHelp(); process.exit(cmd === "help" ? 0 : 2);
}

function printHelp() {
  console.log(`Usage:
  node tools/forge.mjs daemon            run the broker daemon
  node tools/forge.mjs health            GET  /health
  node tools/forge.mjs anchor            GET  /anchor
  node tools/forge.mjs echo <message>    POST /echo

Reads FORGE_PORT, FORGE_URL, FORGE_TOKEN from .env at the repo root.`);
}

// ──────────────────────────────────────────────────────────────
// Daemon
// ──────────────────────────────────────────────────────────────

function runDaemon() {
  const state = {
    anchor: null,
    packVersion: null,
    lastHeartbeat: null,
    heartbeatCount: 0,
    startedAt: new Date().toISOString(),
  };

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

      if (req.method === "GET" && url.pathname === "/health") {
        return send(200, {
          ok: true,
          anchor: state.anchor,
          packVersion: state.packVersion,
          lastHeartbeat: state.lastHeartbeat,
          heartbeatCount: state.heartbeatCount,
          daemonStartedAt: state.startedAt,
        });
      }

      if (req.method === "GET" && url.pathname === "/anchor") {
        return send(200, state.anchor);
      }

      if (req.method === "POST" && url.pathname === "/echo") {
        return send(200, { echo: body });
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

async function cliCall(method, route, body) {
  const headers = { "X-Forge-Token": TOKEN };
  if (body !== undefined) headers["Content-Type"] = "application/json";

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
