/**
 * In-game build / undo / redo / history slash commands. These call
 * the same dispatcher the daemon-queued commands do, so semantics are
 * identical whether the user types in chat or the agent POSTs over HTTP.
 *
 * /rsforge:build <name>  re-anchors at the player's current position,
 *                        fetches the named spec from the daemon, and
 *                        builds it. Avoids the "anchor / walk / build"
 *                        UX trap where the spec lands behind the player.
 */
import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandSource,
  CustomCommandStatus,
  system,
  type CustomCommandOrigin,
  type CustomCommandRegistry,
  type CustomCommandResult,
  type Player,
} from "@minecraft/server";
import { secrets, variables } from "@minecraft/server-admin";
import {
  http,
  HttpHeader,
  HttpRequest,
  HttpRequestMethod,
} from "@minecraft/server-net";
import { setAnchor, yawToFacing, type Anchor } from "../anchor.js";
import { dispatch, type Command } from "../dispatcher.js";
import { listJobs } from "../jobs.js";

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function requirePlayer(origin: CustomCommandOrigin): Player | CustomCommandResult {
  if (origin.sourceType !== CustomCommandSource.Entity || !origin.sourceEntity) {
    return { status: CustomCommandStatus.Failure, message: "Must be invoked by a player." };
  }
  return origin.sourceEntity as Player;
}

export function registerWorkflowCommands(registry: CustomCommandRegistry): void {
  registry.registerCommand(
    {
      name: "rsforge:undo",
      description: "Undo the most recent build (restores the snapshot from before it).",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
    },
    undoCommand,
  );
  registry.registerCommand(
    {
      name: "rsforge:redo",
      description: "Redo the most recently undone build.",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
    },
    redoCommand,
  );
  registry.registerCommand(
    {
      name: "rsforge:history",
      description: "List recent build jobs and their status.",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
    },
    historyCommand,
  );
  registry.registerCommand(
    {
      name: "rsforge:build",
      description: "Re-anchor at your current position+facing and build the named spec.",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
      mandatoryParameters: [
        { name: "specName", type: CustomCommandParamType.String },
      ],
    },
    buildCommand,
  );
}

// ---------- /rsforge:undo ----------

function undoCommand(origin: CustomCommandOrigin): CustomCommandResult {
  const p = requirePlayer(origin);
  if (!("location" in p)) return p;
  const player = p;

  system.run(async () => {
    const cmd: Command = { jobId: genId(), type: "undo", payload: {} };
    const result = await dispatch(cmd);
    if (result.ok) {
      const d = result.data as { name: string; restored: number };
      player.sendMessage(`§a/rsforge:undo §rrestored ${d.restored} blocks for '${d.name}'`);
    } else {
      player.sendMessage(`§c/rsforge:undo failed: §r${result.error}`);
    }
  });

  return { status: CustomCommandStatus.Success, message: "Undoing..." };
}

// ---------- /rsforge:redo ----------

function redoCommand(origin: CustomCommandOrigin): CustomCommandResult {
  const p = requirePlayer(origin);
  if (!("location" in p)) return p;
  const player = p;

  system.run(async () => {
    const cmd: Command = { jobId: genId(), type: "redo", payload: {} };
    const result = await dispatch(cmd);
    if (result.ok) {
      const d = result.data as { name: string; placed: number };
      player.sendMessage(`§a/rsforge:redo §rplaced ${d.placed} blocks for '${d.name}'`);
    } else {
      player.sendMessage(`§c/rsforge:redo failed: §r${result.error}`);
    }
  });

  return { status: CustomCommandStatus.Success, message: "Redoing..." };
}

// ---------- /rsforge:history ----------

function historyCommand(origin: CustomCommandOrigin): CustomCommandResult {
  const p = requirePlayer(origin);
  if (!("location" in p)) return p;
  const player = p;

  const jobs = listJobs(10);
  if (jobs.length === 0) {
    return { status: CustomCommandStatus.Success, message: "No build jobs recorded since world load." };
  }

  // Print one line per job. Using sendMessage from inside the command
  // callback is fine because it doesn't mutate world state.
  player.sendMessage(`§7Recent build jobs (newest first):`);
  for (const j of jobs) {
    const status = j.status === "completed" ? "§acompleted§r" : "§7undone§r";
    player.sendMessage(`  §e${j.id.slice(0, 8)}§r '${j.name}' ${j.placed} blocks ${status}`);
  }
  return { status: CustomCommandStatus.Success };
}

// ---------- /rsforge:build ----------

function buildCommand(origin: CustomCommandOrigin, specName: string): CustomCommandResult {
  const p = requirePlayer(origin);
  if (!("location" in p)) return p;
  const player = p;

  // Capture player state immediately while we have it in the callback.
  const loc = player.location;
  const rot = player.getRotation();
  const dimensionId = player.dimension.id;
  const playerName = player.name;
  const playerId = player.id;

  system.run(async () => {
    try {
      // (1) Re-anchor at the player's current block + facing.
      const anchor: Anchor = {
        dimension: dimensionId,
        pos: { x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) },
        facing: yawToFacing(rot.y),
        setBy: { name: playerName, id: playerId },
        setAt: Date.now(),
      };
      setAnchor(anchor);

      // (2) Fetch the spec from the daemon.
      const endpoint = variables.get("forge_endpoint");
      const token = secrets.get("forge_token");
      if (typeof endpoint !== "string" || !token) {
        player.sendMessage(`§c/rsforge:build failed: §rdaemon endpoint or token not configured`);
        return;
      }
      const req = new HttpRequest(`${endpoint.replace(/\/+$/, "")}/spec/${specName}`);
      req.method = HttpRequestMethod.Get;
      req.headers = [new HttpHeader("X-Forge-Token", token)];
      req.timeout = 10;

      const res = await http.request(req);
      if (res.status !== 200) {
        player.sendMessage(`§c/rsforge:build §rcould not fetch spec '${specName}': HTTP ${res.status}`);
        return;
      }
      let body;
      try { body = JSON.parse(res.body ?? "{}"); }
      catch { player.sendMessage(`§c/rsforge:build §rdaemon returned non-JSON`); return; }
      const spec = body.spec;
      if (!spec) {
        player.sendMessage(`§c/rsforge:build §rdaemon response missing 'spec'`);
        return;
      }

      // (3) Dispatch the build through the same path as the agent's POST.
      const result = await dispatch({ jobId: genId(), type: "build", payload: { spec } });
      if (result.ok) {
        const d = result.data as { jobId: string; name: string; placed: number };
        player.sendMessage(
          `§a/rsforge:build §rbuilt '${d.name}' (${d.placed} blocks, job §e${d.jobId.slice(0, 8)}§r). §7Use /rsforge:undo to remove.`,
        );
      } else {
        const errs = (result as { errors?: unknown }).errors;
        player.sendMessage(`§c/rsforge:build failed: §r${result.error}`);
        if (errs) console.error(`[rsforge] build validation errors: ${JSON.stringify(errs)}`);
      }
    } catch (err) {
      player.sendMessage(`§c/rsforge:build threw: §r${String(err)}`);
    }
  });

  return { status: CustomCommandStatus.Success, message: `Building '${specName}'...` };
}
