/**
 * Spawn-and-control wrapper around bedrock_server.exe.
 *
 * Lets the self-test harness (or any host-side tool) start BDS with
 * stdin/stdout pipes, write commands to its console, wait for log
 * lines to appear, and shut it down cleanly via the built-in "stop"
 * console command.
 */

import { spawn } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import path from "node:path";

/** Compare two dotted version strings (BDS-style: a.b.c.d). */
function compareVersions(a, b) {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

async function findLatestInstall(installRoot) {
  let entries;
  try {
    entries = await readdir(installRoot, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(
        `BDS install root not found at ${installRoot}. Run tools/bds-install.ps1 first.`,
      );
    }
    throw err;
  }

  const candidates = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const exe = path.join(installRoot, e.name, "bedrock_server.exe");
    try {
      await access(exe);
      candidates.push(e.name);
    } catch {
      /* not an install dir */
    }
  }
  if (candidates.length === 0) {
    throw new Error(`no BDS install with bedrock_server.exe under ${installRoot}`);
  }
  candidates.sort(compareVersions);
  return path.join(installRoot, candidates[candidates.length - 1]);
}

export class BdsProcess {
  /**
   * @param {object} opts
   * @param {string} [opts.installRoot]
   * @param {string} [opts.version]            specific version subdir; defaults to latest
   * @param {(line: string) => void} [opts.onLog]   per-line hook for live tee
   */
  constructor(opts = {}) {
    this.installRoot = opts.installRoot ?? path.join(
      process.env.LOCALAPPDATA ?? "",
      "RedstoneForge",
      "bds",
    );
    this.version = opts.version;
    this.onLog = opts.onLog ?? null;

    this.proc = null;
    this.installDir = null;
    this.log = ""; // full accumulated stdout+stderr
    this._waiters = []; // [{regex, resolve, reject, timer, since}]
    this._lineBuf = "";
    this._exited = null; // promise
  }

  /** Spawn BDS and wait for "Server started." Returns this. */
  async start({ readyTimeoutMs = 30000 } = {}) {
    const dir = this.version
      ? path.join(this.installRoot, this.version)
      : await findLatestInstall(this.installRoot);
    this.installDir = dir;

    const exe = path.join(dir, "bedrock_server.exe");
    this.proc = spawn(exe, [], {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk) => this._absorb(chunk));
    this.proc.stderr.on("data", (chunk) => this._absorb(chunk));

    this._exited = new Promise((resolve) => {
      this.proc.once("exit", (code, signal) => {
        // Reject all in-flight waiters; the log they expect can't come.
        for (const w of this._waiters) {
          clearTimeout(w.timer);
          w.reject(
            new Error(
              `BDS exited (code=${code} signal=${signal}) before log matched ${w.regex}`,
            ),
          );
        }
        this._waiters.length = 0;
        resolve({ code, signal });
      });
    });

    await this.waitForLog(/Server started\./, { timeoutMs: readyTimeoutMs });
    return this;
  }

  /** Write a command to BDS's console. Appends newline. */
  send(cmd) {
    if (!this.proc || this.proc.exitCode !== null) {
      throw new Error("BDS not running");
    }
    this.proc.stdin.write(cmd + "\n");
  }

  /**
   * Wait until a log line matches `regex`. Searches existing buffer
   * first, then watches new output. Rejects on timeout or BDS exit.
   */
  waitForLog(regex, { timeoutMs = 5000 } = {}) {
    return new Promise((resolve, reject) => {
      // Quick scan of already-seen log first.
      const m = regex.exec(this.log);
      if (m) return resolve(m);

      const waiter = { regex, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const idx = this._waiters.indexOf(waiter);
        if (idx >= 0) this._waiters.splice(idx, 1);
        reject(
          new Error(
            `timeout after ${timeoutMs}ms waiting for ${regex} in BDS log`,
          ),
        );
      }, timeoutMs);
      this._waiters.push(waiter);
    });
  }

  /** Issue "stop" and wait for the process to exit. */
  async stop({ timeoutMs = 15000 } = {}) {
    if (!this.proc || this.proc.exitCode !== null) return;
    try {
      this.proc.stdin.write("stop\n");
    } catch {
      /* if stdin already closed, fall through to kill */
    }
    const winner = await Promise.race([
      this._exited,
      new Promise((resolve) => setTimeout(() => resolve("timeout"), timeoutMs)),
    ]);
    if (winner === "timeout") {
      this.proc.kill("SIGKILL");
      await this._exited;
    }
  }

  /** Force-kill (rude). Use only in error cleanup paths. */
  kill() {
    if (this.proc && this.proc.exitCode === null) {
      try {
        this.proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }

  // ---------- internal ----------

  _absorb(chunk) {
    this.log += chunk;
    this._lineBuf += chunk;
    let nl;
    while ((nl = this._lineBuf.indexOf("\n")) >= 0) {
      const line = this._lineBuf.slice(0, nl).replace(/\r$/, "");
      this._lineBuf = this._lineBuf.slice(nl + 1);
      if (this.onLog) {
        try { this.onLog(line); } catch { /* never let a log sink crash us */ }
      }
    }
    // Try waiters against the full accumulated log so multi-line
    // regexes work; callers usually pass single-line patterns.
    for (const w of [...this._waiters]) {
      const m = w.regex.exec(this.log);
      if (m) {
        clearTimeout(w.timer);
        const idx = this._waiters.indexOf(w);
        if (idx >= 0) this._waiters.splice(idx, 1);
        w.resolve(m);
      }
    }
  }
}
