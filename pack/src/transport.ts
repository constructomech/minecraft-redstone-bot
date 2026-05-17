/**
 * Outbound HTTP transport: the pack is a client to the forge daemon.
 *
 *   heartbeat (~2s): push current state (anchor, packVersion) to daemon.
 *   poll      (~250ms): pull pending commands from daemon, dispatch,
 *                       POST results back.
 *
 * Both loops share auth config (variables.forge_endpoint +
 * secrets.forge_token). The poll loop is the agent → pack channel
 * since @minecraft/server-net has no inbound listening.
 */
import { system } from "@minecraft/server";
import { secrets, variables, type SecretString } from "@minecraft/server-admin";
import {
  http,
  HttpHeader,
  HttpRequest,
  HttpRequestMethod,
} from "@minecraft/server-net";
import { getAnchor } from "./anchor.js";
import { dispatch, type Command } from "./dispatcher.js";

const HEARTBEAT_INTERVAL_TICKS = 40; // 2 seconds at 20 ticks/sec
const POLL_INTERVAL_TICKS = 5;       // 250ms — interactive without spamming
const PACK_VERSION = "0.3.0";

export function startHeartbeat(): void {
  const endpointRaw = variables.get("forge_endpoint");
  const token = secrets.get("forge_token");

  if (typeof endpointRaw !== "string" || !endpointRaw) {
    console.warn("[rsforge] forge_endpoint variable not configured; transport disabled");
    return;
  }
  if (!token) {
    console.warn("[rsforge] forge_token secret not configured; transport disabled");
    return;
  }

  const endpoint = endpointRaw.replace(/\/+$/, "");
  console.log(`[rsforge] heartbeat -> ${endpoint}/heartbeat every ${HEARTBEAT_INTERVAL_TICKS} ticks`);
  console.log(`[rsforge] poll      -> ${endpoint}/poll every ${POLL_INTERVAL_TICKS} ticks`);

  // First heartbeat ASAP (next tick), then on interval.
  system.run(() => { void sendHeartbeat(endpoint, token); });
  system.runInterval(() => { void sendHeartbeat(endpoint, token); }, HEARTBEAT_INTERVAL_TICKS);

  // Command-pickup loop. We use a runTimeout chain so pollOnce always
  // completes (await included) before the next iteration is scheduled,
  // avoiding overlap if a build takes longer than the poll interval.
  schedulePoll(endpoint, token);
}

function schedulePoll(endpoint: string, token: SecretString): void {
  system.runTimeout(() => {
    void pollOnce(endpoint, token).finally(() => schedulePoll(endpoint, token));
  }, POLL_INTERVAL_TICKS);
}

// ---------- heartbeat ----------

let consecutiveFailures = 0;
const QUIET_AFTER_N_FAILURES = 3;

async function sendHeartbeat(endpoint: string, token: SecretString): Promise<void> {
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

// ---------- poll + dispatch + result ----------

let pollFailureCount = 0;

async function pollOnce(endpoint: string, token: SecretString): Promise<void> {
  // Quiet during normal operation; only log if poll itself fails
  // (e.g. daemon down). We re-use the heartbeat quieting behaviour.
  const req = new HttpRequest(`${endpoint}/poll`);
  req.method = HttpRequestMethod.Post;
  req.headers = [
    new HttpHeader("Content-Type", "application/json"),
    new HttpHeader("X-Forge-Token", token),
  ];
  req.body = "{}";
  req.timeout = 5;

  let body: { commands?: Command[] } = {};
  try {
    const res = await http.request(req);
    if (res.status !== 200) {
      pollFailureCount += 1;
      if (pollFailureCount <= QUIET_AFTER_N_FAILURES) {
        console.warn(`[rsforge] poll HTTP ${res.status}`);
      }
      return;
    }
    pollFailureCount = 0;
    try {
      body = JSON.parse(res.body ?? "{}") as { commands?: Command[] };
    } catch {
      console.warn(`[rsforge] poll: invalid JSON from daemon`);
      return;
    }
  } catch (err) {
    pollFailureCount += 1;
    if (pollFailureCount <= QUIET_AFTER_N_FAILURES) {
      console.warn(`[rsforge] poll failed: ${String(err)}`);
    }
    return;
  }

  const commands = body.commands ?? [];
  for (const cmd of commands) {
    const result = dispatch(cmd);
    await postResult(endpoint, token, cmd.jobId, result);
  }
}

async function postResult(
  endpoint: string,
  token: SecretString,
  jobId: string,
  result: unknown,
): Promise<void> {
  const req = new HttpRequest(`${endpoint}/result`);
  req.method = HttpRequestMethod.Post;
  req.headers = [
    new HttpHeader("Content-Type", "application/json"),
    new HttpHeader("X-Forge-Token", token),
  ];
  req.body = JSON.stringify({ jobId, result });
  req.timeout = 5;

  try {
    const res = await http.request(req);
    if (res.status !== 200) {
      console.warn(`[rsforge] result for ${jobId}: daemon HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(`[rsforge] result for ${jobId} failed to post: ${String(err)}`);
  }
}
