/**
 * Outbound HTTP transport: heartbeats the pack's state to the forge
 * daemon every HEARTBEAT_INTERVAL_TICKS. The pack is purely a client;
 * the daemon caches state and serves it to the agent's CLI.
 *
 * Config:
 *   variables.forge_endpoint  (string)  — base URL like "http://127.0.0.1:33000"
 *   secrets.forge_token       (SecretString) — bearer token, never visible to script
 */
import { system } from "@minecraft/server";
import { secrets, variables } from "@minecraft/server-admin";
import {
  http,
  HttpHeader,
  HttpRequest,
  HttpRequestMethod,
} from "@minecraft/server-net";
import { getAnchor } from "./anchor.js";

const HEARTBEAT_INTERVAL_TICKS = 40; // 2 seconds at 20 ticks/sec
const PACK_VERSION = "0.2.0";

export function startHeartbeat(): void {
  const endpointRaw = variables.get("forge_endpoint");
  const token = secrets.get("forge_token");

  if (typeof endpointRaw !== "string" || !endpointRaw) {
    console.warn(
      "[rsforge] forge_endpoint variable not configured; heartbeat disabled",
    );
    return;
  }
  if (!token) {
    console.warn(
      "[rsforge] forge_token secret not configured; heartbeat disabled",
    );
    return;
  }

  const endpoint = endpointRaw.replace(/\/+$/, "");
  console.log(`[rsforge] heartbeat -> ${endpoint}/heartbeat every ${HEARTBEAT_INTERVAL_TICKS} ticks`);

  // First heartbeat ASAP (next tick), then on interval.
  system.run(() => { void sendHeartbeat(endpoint, token); });
  system.runInterval(() => { void sendHeartbeat(endpoint, token); }, HEARTBEAT_INTERVAL_TICKS);
}

// We track consecutive failures so a flapping daemon doesn't spam the log.
let consecutiveFailures = 0;
const QUIET_AFTER_N_FAILURES = 3;

async function sendHeartbeat(
  endpoint: string,
  token: import("@minecraft/server-admin").SecretString,
): Promise<void> {
  const anchor = getAnchor();
  const payload = {
    timestamp: Date.now(),
    packVersion: PACK_VERSION,
    anchor,
  };

  const req = new HttpRequest(`${endpoint}/heartbeat`);
  req.method = HttpRequestMethod.Post;
  req.headers = [
    new HttpHeader("Content-Type", "application/json"),
    new HttpHeader("X-Forge-Token", token),
  ];
  req.body = JSON.stringify(payload);
  req.timeout = 5;

  try {
    const res = await http.request(req);
    if (res.status === 200) {
      if (consecutiveFailures > 0) {
        console.log(`[rsforge] heartbeat recovered after ${consecutiveFailures} failures`);
      }
      consecutiveFailures = 0;
      return;
    }
    consecutiveFailures += 1;
    if (consecutiveFailures <= QUIET_AFTER_N_FAILURES) {
      console.warn(`[rsforge] heartbeat HTTP ${res.status}: ${res.body?.slice(0, 200) ?? ""}`);
    }
  } catch (err) {
    consecutiveFailures += 1;
    if (consecutiveFailures <= QUIET_AFTER_N_FAILURES) {
      console.warn(`[rsforge] heartbeat failed: ${String(err)}`);
    }
    if (consecutiveFailures === QUIET_AFTER_N_FAILURES + 1) {
      console.warn(`[rsforge] suppressing further heartbeat failure logs; will report on recovery`);
    }
  }
}
