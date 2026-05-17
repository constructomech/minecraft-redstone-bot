#!/usr/bin/env node
/**
 * Redstone Forge end-to-end self-test.
 *
 * Spawns the forge daemon and BDS, drives the pack via /scriptevent
 * (server-source so no player needed), polls the daemon's HTTP API,
 * asserts the observed state matches expectations, and tears
 * everything down.
 *
 * Designed to be run repeatedly by the agent during Phase 3+ build
 * iteration without human-in-the-loop turnaround.
 *
 * Usage:
 *   node tools/selftest.mjs              # quiet, fail-on-error
 *   node tools/selftest.mjs --verbose    # stream BDS + daemon logs
 *
 * Exits 0 on all checks green, 1 on any failure.
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BdsProcess } from "./bds-control.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const verbose = process.argv.includes("--verbose");

// ---------- env ----------

const env = await loadEnv();
const FORGE_PORT = Number.parseInt(env.FORGE_PORT ?? "33000", 10);
const FORGE_TOKEN = env.FORGE_TOKEN;
const FORGE_URL = env.FORGE_URL ?? `http://127.0.0.1:${FORGE_PORT}`;
if (!FORGE_TOKEN) {
  die("FORGE_TOKEN missing from .env. Run tools/pack-deploy.ps1 first.");
}

// ---------- reporting ----------

const results = []; // [{name, ok, detail?}]
const t0 = Date.now();

function pass(name) {
  results.push({ name, ok: true });
  console.log(`  \x1b[32m[PASS]\x1b[0m ${name}`);
}
function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.log(`  \x1b[31m[FAIL]\x1b[0m ${name}`);
  if (detail) {
    for (const line of String(detail).split("\n")) {
      console.log(`         ${line}`);
    }
  }
}

function diag(msg) {
  if (verbose) console.log(`  \x1b[90m· ${msg}\x1b[0m`);
}

// ---------- preflight: nothing else holding the port or running BDS ----------

console.log("Redstone Forge self-test");
console.log(`  daemon URL  : ${FORGE_URL}`);
console.log(`  daemon port : ${FORGE_PORT}`);
console.log(`  repo root   : ${repoRoot}`);
console.log("");

if (await isPortInUse(FORGE_PORT)) {
  die(
    `port ${FORGE_PORT} is already in use. Stop any running 'node tools/forge.mjs daemon' first.`,
  );
}

const leftover = await findBedrockProcesses();
if (leftover.length > 0) {
  die(
    `bedrock_server.exe is already running (PID ${leftover.join(", ")}). Stop it first — it holds the world LevelDB and the server port.`,
  );
}

// ---------- spawn daemon ----------

let daemon = null;
let bds = null;

try {
  console.log("Starting forge daemon...");
  daemon = spawn("node", ["tools/forge.mjs", "daemon"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    windowsHide: true,
  });
  let daemonReady = false;
  daemon.stdout.setEncoding("utf8");
  daemon.stderr.setEncoding("utf8");
  daemon.stdout.on("data", (c) => {
    if (verbose) process.stdout.write(`\x1b[35m[daemon]\x1b[0m ${c}`);
    if (/listening on/.test(c)) daemonReady = true;
  });
  daemon.stderr.on("data", (c) => {
    if (verbose) process.stderr.write(`\x1b[31m[daemon-err]\x1b[0m ${c}`);
  });
  await waitFor(() => daemonReady, 5000, "forge daemon to print 'listening on'");
  pass("daemon started");

  // ---------- spawn BDS ----------

  console.log("\nStarting BDS...");
  bds = new BdsProcess({
    onLog: verbose ? (line) => process.stdout.write(`\x1b[36m[bds]\x1b[0m ${line}\n`) : undefined,
  });
  await bds.start({ readyTimeoutMs: 30000 });
  pass("BDS booted and reached 'Server started.'");
  diag(`install: ${bds.installDir}`);

  // Phase 3 needs chunks loaded to set/read blocks. With no player,
  // chunks unload by default; add a ticking area near spawn so the
  // build site stays live.
  bds.send("tickingarea add 0 0 0 31 255 31 rsforge_selftest");
  await new Promise((r) => setTimeout(r, 1000)); // tickingarea is fire-and-forget
  pass("ticking area added at spawn");

  await bds.waitForLog(/\[Scripting\] \[rsforge\] startup: commands registered/, { timeoutMs: 15000 });
  pass("pack startup ran (commands registered)");

  await bds.waitForLog(/\[rsforge\] heartbeat ->/, { timeoutMs: 5000 });
  pass("pack transport bootstrapped (heartbeat URL logged)");

  await bds.waitForLog(/\[rsforge\] debug: scriptevent handlers active/, { timeoutMs: 5000 });
  pass("pack debug handlers active (variables.debug_enabled === true)");

  // ---------- heartbeat lands on daemon ----------

  console.log("\nVerifying heartbeat reaches daemon...");
  const initial = await pollHealth({ timeoutMs: 6000, predicate: (h) => h.heartbeatCount >= 1 });
  pass(`heartbeat received by daemon (count=${initial.heartbeatCount})`);
  diag(`packVersion=${initial.packVersion} lastHeartbeat=${initial.lastHeartbeat}`);
  diag(`pre-existing anchor (will be cleared): ${JSON.stringify(initial.anchor)}`);

  // ---------- reset to a known baseline ----------

  console.log("\nResetting anchor to known baseline (null)...");
  bds.send("scriptevent rsforge:debug_clearanchor");
  await bds.waitForLog(/debug_clearanchor: cleared/, { timeoutMs: 5000 });
  const baseline = await pollHealth({
    timeoutMs: 6000,
    predicate: (h) => h.anchor === null,
  });
  pass(`baseline anchor=null established (count=${baseline.heartbeatCount})`);

  // ---------- drive: set anchor via scriptevent ----------

  console.log("\nSetting anchor via /scriptevent...");
  bds.send("scriptevent rsforge:debug_setanchor 7 64 -3 east");
  await bds.waitForLog(
    /\[rsforge\] debug_setanchor: minecraft:overworld 7 64 -3 east/,
    { timeoutMs: 5000 },
  );
  pass("pack acknowledged debug_setanchor in console log");

  const set = await pollHealth({
    timeoutMs: 6000,
    predicate: (h) =>
      h.anchor &&
      h.anchor.pos.x === 7 &&
      h.anchor.pos.y === 64 &&
      h.anchor.pos.z === -3 &&
      h.anchor.facing === "east",
  });
  pass("anchor propagated to daemon via heartbeat");
  diag(`anchor: ${JSON.stringify(set.anchor)}`);

  if (set.anchor.dimension !== "minecraft:overworld") {
    fail("anchor.dimension", `expected minecraft:overworld, got ${set.anchor.dimension}`);
  } else {
    pass("anchor.dimension defaults to overworld");
  }
  if (set.anchor.setBy?.name !== "debug") {
    fail("anchor.setBy.name", `expected 'debug', got ${set.anchor.setBy?.name}`);
  } else {
    pass("anchor.setBy reflects debug source");
  }

  // ---------- direct /anchor endpoint ----------

  const fromAnchor = await getJson("/anchor");
  if (
    !fromAnchor ||
    fromAnchor.pos.x !== 7 ||
    fromAnchor.pos.y !== 64 ||
    fromAnchor.pos.z !== -3
  ) {
    fail("/anchor endpoint", `unexpected payload: ${JSON.stringify(fromAnchor)}`);
  } else {
    pass("/anchor endpoint returns the anchor directly");
  }

  // ---------- explicit dimension override ----------

  console.log("\nOverriding with explicit dimension...");
  bds.send("scriptevent rsforge:debug_setanchor -5 70 10 west minecraft:the_nether");
  await bds.waitForLog(/debug_setanchor: minecraft:the_nether -5 70 10 west/, { timeoutMs: 5000 });
  const nether = await pollHealth({
    timeoutMs: 6000,
    predicate: (h) => h.anchor && h.anchor.dimension === "minecraft:the_nether",
  });
  if (nether.anchor.facing === "west" && nether.anchor.pos.x === -5) {
    pass("explicit dimension + new coords accepted");
  } else {
    fail("explicit-dim anchor", JSON.stringify(nether.anchor));
  }

  // ---------- clear ----------

  console.log("\nClearing anchor...");
  bds.send("scriptevent rsforge:debug_clearanchor");
  await bds.waitForLog(/debug_clearanchor: cleared/, { timeoutMs: 5000 });
  const cleared = await pollHealth({
    timeoutMs: 6000,
    predicate: (h) => h.anchor === null,
  });
  pass(`anchor cleared (heartbeatCount=${cleared.heartbeatCount})`);

  // ---------- Phase 3: build a spec via /build, verify in world, undo ----------

  console.log("\nBuilding a 3-block lever -> wire -> lamp spec...");
  // Anchor at (4, 70, 4) overworld — inside the ticking area we added.
  bds.send("scriptevent rsforge:debug_setanchor 4 70 4 north");
  await bds.waitForLog(/debug_setanchor: minecraft:overworld 4 70 4 north/, { timeoutMs: 5000 });
  await pollHealth({
    timeoutMs: 6000,
    predicate: (h) => h.anchor && h.anchor.dimension === "minecraft:overworld" && h.anchor.pos.x === 4,
  });

  // Clear the build site so pre-build state is deterministic.
  // (Selftest reruns and discover-states.mjs both leave stuff behind.)
  for (const x of [4, 5, 6]) bds.send(`setblock ${x} 70 4 air`);
  await new Promise((r) => setTimeout(r, 300));
  for (const x of [4, 5, 6]) await checkBlock(bds, x, 70, 4, "minecraft:air");

  const testSpec = {
    name: "selftest-circuit",
    footprint: { size: [3, 1, 1] },
    anchor: "absolute",
    blocks: [
      { at: [0, 0, 0], id: "minecraft:lever" },
      { at: [1, 0, 0], id: "minecraft:redstone_wire" },
      { at: [2, 0, 0], id: "minecraft:redstone_lamp" },
    ],
  };

  const buildRes = await callJson("POST", "/build", { spec: testSpec });
  if (buildRes.ok && buildRes.data?.placed === 3 && buildRes.data?.jobId) {
    pass(`build placed 3 blocks (jobId=${buildRes.data.jobId.slice(0, 8)}...)`);
    diag(`bounds=${JSON.stringify(buildRes.data.bounds)}`);
  } else {
    fail("build", JSON.stringify(buildRes));
    throw new Error("build failed; aborting downstream checks");
  }

  // Verify each block landed where expected
  await checkBlock(bds, 4, 70, 4, "minecraft:lever");
  await checkBlock(bds, 5, 70, 4, "minecraft:redstone_wire");
  await checkBlock(bds, 6, 70, 4, "minecraft:redstone_lamp");

  // ---------- undo ----------

  console.log("\nUndoing the build (snapshot must restore the air we set)...");
  const undoRes = await callJson("POST", "/undo", {});
  if (undoRes.ok && undoRes.data?.restored === 3) {
    pass(`undo restored 3 blocks`);
  } else {
    fail("undo", JSON.stringify(undoRes));
  }

  await checkBlock(bds, 4, 70, 4, "minecraft:air");
  await checkBlock(bds, 5, 70, 4, "minecraft:air");
  await checkBlock(bds, 6, 70, 4, "minecraft:air");

  // ---------- validation rejection ----------

  console.log("\nVerifying spec validation rejects garbage...");
  const badRes = await callJson("POST", "/build", { spec: { name: "bad" } });
  if (badRes.ok === false && Array.isArray(badRes.errors) && badRes.errors.length > 0) {
    pass(`bad spec rejected (${badRes.errors.length} validation errors)`);
    diag(`first error: ${badRes.errors[0].path} - ${badRes.errors[0].message}`);
  } else {
    fail("validation rejection", JSON.stringify(badRes));
  }

  console.log("\nVerifying build without anchor is rejected...");
  bds.send("scriptevent rsforge:debug_clearanchor");
  await bds.waitForLog(/debug_clearanchor: cleared/, { timeoutMs: 5000, fromIndex: bds.log.length - 1 });
  await pollHealth({ timeoutMs: 6000, predicate: (h) => h.anchor === null });
  const noAnchorRes = await callJson("POST", "/build", { spec: testSpec });
  if (noAnchorRes.ok === false && /no anchor/.test(noAnchorRes.error ?? "")) {
    pass("build without anchor rejected with descriptive error");
  } else {
    fail("no-anchor rejection", JSON.stringify(noAnchorRes));
  }

  // ---------- echo round-trip via CLI ----------

  console.log("\nVerifying /echo via CLI...");
  const echoOut = await runCli("echo", "hello-from-selftest");
  const echoJson = JSON.parse(echoOut.stdout);
  if (echoJson.echo === "hello-from-selftest") {
    pass("forge CLI echo round-trip");
  } else {
    fail("forge CLI echo", `unexpected: ${JSON.stringify(echoJson)}`);
  }

  // ---------- auth failure ----------

  console.log("\nVerifying auth gate rejects bad tokens...");
  const badAuth = await fetch(`${FORGE_URL}/health`, {
    headers: { "X-Forge-Token": "definitely-not-the-token" },
  });
  if (badAuth.status === 401) {
    pass("daemon returns 401 on bad token");
  } else {
    fail("auth gate", `expected 401 but got ${badAuth.status}`);
  }
} catch (err) {
  fail("self-test threw", err.stack ?? String(err));
} finally {
  console.log("\nTearing down...");
  if (bds) {
    try {
      await bds.stop({ timeoutMs: 15000 });
      pass("BDS stopped cleanly");
    } catch (err) {
      fail("BDS clean stop", String(err));
      bds.kill();
    }
  }
  if (daemon && daemon.exitCode === null) {
    daemon.kill();
  }
}

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
const totalMs = Date.now() - t0;
console.log("");
if (failed === 0) {
  console.log(`\x1b[32mall ${passed} checks passed in ${(totalMs / 1000).toFixed(1)}s\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m${failed} of ${results.length} checks FAILED (${(totalMs / 1000).toFixed(1)}s)\x1b[0m`);
  process.exit(1);
}

// ---------- helpers ----------

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

function die(msg) {
  console.error(`selftest: ${msg}`);
  process.exit(2);
}

async function isPortInUse(port) {
  const { createServer } = await import("node:net");
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(true));
    s.once("listening", () => s.close(() => resolve(false)));
    s.listen(port, "127.0.0.1");
  });
}

/** Return PIDs of any running bedrock_server.exe processes. */
async function findBedrockProcesses() {
  if (process.platform !== "win32") return [];
  return new Promise((resolve) => {
    const p = spawn(
      "tasklist",
      ["/fi", "imagename eq bedrock_server.exe", "/fo", "csv", "/nh"],
      { windowsHide: true },
    );
    let out = "";
    p.stdout.on("data", (c) => { out += c; });
    p.once("exit", () => {
      const pids = [];
      for (const line of out.split(/\r?\n/)) {
        // CSV: "image","pid","session",...
        const m = line.match(/^"[^"]+","(\d+)"/);
        if (m) pids.push(Number.parseInt(m[1], 10));
      }
      resolve(pids);
    });
    p.once("error", () => resolve([]));
  });
}

async function waitFor(pred, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function getJson(route) {
  const res = await fetch(`${FORGE_URL}${route}`, {
    headers: { "X-Forge-Token": FORGE_TOKEN },
  });
  if (!res.ok) throw new Error(`${route} -> HTTP ${res.status}`);
  return res.json();
}

async function callJson(method, route, body) {
  const headers = { "X-Forge-Token": FORGE_TOKEN, "Content-Type": "application/json" };
  const res = await fetch(`${FORGE_URL}${route}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return { ok: false, error: `non-JSON response: ${text.slice(0, 200)}` }; }
}

async function checkBlock(bds, x, y, z, expectedId) {
  const cursor = bds.log.length;
  bds.send(`scriptevent rsforge:debug_blockat ${x} ${y} ${z}`);
  try {
    const m = await bds.waitForLog(
      new RegExp(`debug_blockat: ${x},${y},${z} -> (\\S+) `),
      { timeoutMs: 5000, fromIndex: cursor },
    );
    if (m[1] === expectedId) {
      pass(`block at ${x},${y},${z} is ${expectedId}`);
    } else {
      fail(`block at ${x},${y},${z}`, `expected ${expectedId} but got ${m[1]}`);
    }
  } catch (err) {
    fail(`block at ${x},${y},${z}`, String(err.message ?? err));
  }
}

/** Poll /health until predicate is true. */
async function pollHealth({ timeoutMs, predicate, intervalMs = 250 }) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await getJson("/health");
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `pollHealth: timeout after ${timeoutMs}ms; last response: ${JSON.stringify(last)}`,
  );
}

function runCli(...args) {
  return new Promise((resolve, reject) => {
    const p = spawn("node", ["tools/forge.mjs", ...args], {
      cwd: repoRoot,
      env: process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (c) => { stdout += c; });
    p.stderr.on("data", (c) => { stderr += c; });
    p.once("error", reject);
    p.once("exit", (code) => resolve({ stdout, stderr, code }));
  });
}
