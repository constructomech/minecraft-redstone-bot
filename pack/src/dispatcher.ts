/**
 * Command dispatcher: invoked by the pack's poll loop once it picks up
 * a command from the daemon. Routes by `cmd.type` to the right handler
 * (build, undo, ...), catches errors, and returns a structured result
 * the dispatcher posts back to the daemon.
 */
import { world } from "@minecraft/server";
import { getAnchor } from "./anchor.js";
import { recordJob, getJob, latestUndoable } from "./jobs.js";
import { validateSpec } from "./spec/schema.js";
import { executeBuild } from "./world/builder.js";
import { restoreSnapshot } from "./world/snapshot.js";

export type Command =
  | { jobId: string; type: "build"; payload: { spec: unknown } }
  | { jobId: string; type: "undo";  payload: { jobId?: string } };

export type CommandResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; errors?: unknown };

export function dispatch(cmd: Command): CommandResult {
  try {
    switch (cmd.type) {
      case "build": return handleBuild(cmd.payload, cmd.jobId);
      case "undo":  return handleUndo(cmd.payload);
      default: {
        const t = (cmd as { type?: unknown }).type;
        return { ok: false, error: `unknown command type: ${String(t)}` };
      }
    }
  } catch (err) {
    return { ok: false, error: `unhandled exception: ${String(err)}` };
  }
}

function handleBuild(payload: { spec: unknown }, jobId: string): CommandResult {
  const v = validateSpec(payload.spec);
  if (!v.ok) {
    return { ok: false, error: "spec validation failed", errors: v.errors };
  }
  const spec = v.spec;

  const anchor = getAnchor();
  if (!anchor) {
    return {
      ok: false,
      error: "no anchor set. Run /rsforge:anchor in-game (or fire the rsforge:debug_setanchor scriptevent) before building.",
    };
  }

  let result;
  try {
    result = executeBuild(spec, anchor);
  } catch (err) {
    return { ok: false, error: `build failed: ${String(err)}` };
  }

  recordJob({
    id: jobId,
    name: spec.name,
    snapshot: result.snapshot,
    bounds: result.bounds,
    placed: result.placed,
    status: "completed",
    createdAt: Date.now(),
  });

  console.log(
    `[rsforge] build ${jobId} '${spec.name}': placed ${result.placed} blocks bounds=${JSON.stringify(result.bounds)}`,
  );

  return {
    ok: true,
    data: {
      jobId,
      name: spec.name,
      placed: result.placed,
      bounds: result.bounds,
    },
  };
}

function handleUndo(payload: { jobId?: string }): CommandResult {
  const job = payload.jobId ? getJob(payload.jobId) : latestUndoable();
  if (!job) {
    return {
      ok: false,
      error: payload.jobId
        ? `no job with id '${payload.jobId}'`
        : "no undoable job recorded since world load",
    };
  }
  if (job.status === "undone") {
    return { ok: false, error: `job '${job.id}' is already undone` };
  }

  const dim = world.getDimension(job.snapshot.dimension);
  const restored = restoreSnapshot(dim, job.snapshot);
  job.status = "undone";

  console.log(`[rsforge] undo ${job.id} '${job.name}': restored ${restored} blocks`);

  return {
    ok: true,
    data: { jobId: job.id, name: job.name, restored },
  };
}
