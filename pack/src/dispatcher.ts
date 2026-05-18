/**
 * Command dispatcher: invoked by the pack's poll loop once it picks up
 * a command from the daemon. Routes by `cmd.type` to the right handler
 * (build, undo, test), catches errors, returns a structured result the
 * dispatcher posts back to the daemon.
 *
 * Async since /test uses system.runTimeout between steps.
 */
import { world } from "@minecraft/server";
import { getAnchor, setAnchor, type Facing } from "./anchor.js";
import { getJob, latest, latestUndoable, latestUndone, listJobs, recordJob } from "./jobs.js";
import { validateSpec } from "./spec/schema.js";
import { runAllTests, runTest } from "./test/runner.js";
import { executeBuild, planPlacements } from "./world/builder.js";
import { restoreSnapshot } from "./world/snapshot.js";

export type Command =
  | { jobId: string; type: "build"; payload: { spec: unknown } }
  | { jobId: string; type: "undo";  payload: { jobId?: string } }
  | { jobId: string; type: "redo";  payload: { jobId?: string } }
  | { jobId: string; type: "test";  payload: { jobId?: string; testName?: string } }
  | { jobId: string; type: "world"; payload: { bounds: [number, number, number, number, number, number]; dimension?: string } }
  | { jobId: string; type: "setanchor"; payload: { x: number; y: number; z: number; facing: string; dimension?: string } };

export type CommandResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; errors?: unknown };

export async function dispatch(cmd: Command): Promise<CommandResult> {
  try {
    switch (cmd.type) {
      case "build": return handleBuild(cmd.payload, cmd.jobId);
      case "undo":  return handleUndo(cmd.payload);
      case "redo":  return handleRedo(cmd.payload, cmd.jobId);
      case "test":  return await handleTest(cmd.payload);
      case "world": return handleWorld(cmd.payload);
      case "setanchor": return handleSetAnchor(cmd.payload);
      default: {
        const t = (cmd as { type?: unknown }).type;
        return { ok: false, error: `unknown command type: ${String(t)}` };
      }
    }
  } catch (err) {
    return { ok: false, error: `unhandled exception: ${String(err)}` };
  }
}

// ---------- build ----------

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
    spec,
    anchor,
    rotationSteps: result.rotationSteps,
    snapshot: result.snapshot,
    bounds: result.bounds,
    placed: result.placed,
    status: "completed",
    createdAt: Date.now(),
  });

  console.log(
    `[rsforge] build ${jobId} '${spec.name}': placed ${result.placed} blocks rotation=${result.rotationSteps} bounds=${JSON.stringify(result.bounds)}`,
  );

  return {
    ok: true,
    data: {
      jobId,
      name: spec.name,
      placed: result.placed,
      bounds: result.bounds,
      rotationSteps: result.rotationSteps,
    },
  };
}

// ---------- undo ----------

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

// ---------- redo ----------

function handleRedo(payload: { jobId?: string }, newJobId: string): CommandResult {
  const job = payload.jobId ? getJob(payload.jobId) : latestUndone();
  if (!job) {
    return {
      ok: false,
      error: payload.jobId
        ? `no job with id '${payload.jobId}'`
        : "no undone job available to redo",
    };
  }
  if (job.status !== "undone") {
    return { ok: false, error: `job '${job.id}' is not undone (status: ${job.status})` };
  }

  // Re-execute the same build (same spec + same anchor + same rotation).
  let result;
  try {
    result = executeBuild(job.spec, job.anchor);
  } catch (err) {
    return { ok: false, error: `redo failed: ${String(err)}` };
  }

  // Mark the original as 'redone' (terminal status — not eligible for
  // further /redo) and record a new completed job with a fresh snapshot.
  job.status = "redone";
  recordJob({
    id: newJobId,
    name: job.name,
    spec: job.spec,
    anchor: job.anchor,
    rotationSteps: result.rotationSteps,
    snapshot: result.snapshot,
    bounds: result.bounds,
    placed: result.placed,
    status: "completed",
    createdAt: Date.now(),
  });

  console.log(`[rsforge] redo ${newJobId} from ${job.id} '${job.name}': placed ${result.placed} blocks`);

  return {
    ok: true,
    data: {
      jobId: newJobId,
      fromJobId: job.id,
      name: job.name,
      placed: result.placed,
      bounds: result.bounds,
      rotationSteps: result.rotationSteps,
    },
  };
}

// ---------- world (region dump) ----------

const MAX_WORLD_BLOCKS = 4096; // safety cap so a runaway bounds doesn't OOM

function handleWorld(payload: { bounds: [number, number, number, number, number, number]; dimension?: string }): CommandResult {
  const b = payload.bounds;
  if (!Array.isArray(b) || b.length !== 6 || !b.every((n) => Number.isInteger(n))) {
    return { ok: false, error: "bounds must be [x1,y1,z1,x2,y2,z2] of integers" };
  }
  const [x1, y1, z1, x2, y2, z2] = b;
  const xMin = Math.min(x1, x2), xMax = Math.max(x1, x2);
  const yMin = Math.min(y1, y2), yMax = Math.max(y1, y2);
  const zMin = Math.min(z1, z2), zMax = Math.max(z1, z2);
  const count = (xMax - xMin + 1) * (yMax - yMin + 1) * (zMax - zMin + 1);
  if (count > MAX_WORLD_BLOCKS) {
    return {
      ok: false,
      error: `bounds covers ${count} blocks; cap is ${MAX_WORLD_BLOCKS}. Narrow the bounds.`,
    };
  }

  const dimId = payload.dimension ?? "minecraft:overworld";
  let dim;
  try { dim = world.getDimension(dimId); }
  catch { return { ok: false, error: `unknown dimension '${dimId}'` }; }

  const blocks: Array<{ pos: [number, number, number]; id: string; states?: Record<string, unknown> }> = [];
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      for (let z = zMin; z <= zMax; z++) {
        const block = dim.getBlock({ x, y, z });
        if (!block || block.typeId === "minecraft:air") continue;
        const states = block.permutation.getAllStates();
        const hasStates = Object.keys(states).length > 0;
        blocks.push({
          pos: [x, y, z],
          id: block.typeId,
          ...(hasStates ? { states } : {}),
        });
      }
    }
  }

  return {
    ok: true,
    data: {
      dimension: dimId,
      bounds: { min: [xMin, yMin, zMin], max: [xMax, yMax, zMax] },
      blockCount: blocks.length,
      airSkipped: count - blocks.length,
      blocks,
    },
  };
}

// ---------- setanchor ----------

const VALID_FACINGS: readonly string[] = ["north", "south", "east", "west"];

function handleSetAnchor(payload: { x: number; y: number; z: number; facing: string; dimension?: string }): CommandResult {
  const { x, y, z, facing } = payload;
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) {
    return { ok: false, error: `setanchor: x,y,z must be integers (got ${x},${y},${z})` };
  }
  if (!VALID_FACINGS.includes(facing)) {
    return { ok: false, error: `setanchor: facing must be one of ${VALID_FACINGS.join("|")} (got '${facing}')` };
  }
  const dimension = payload.dimension ?? "minecraft:overworld";
  try { world.getDimension(dimension); }
  catch { return { ok: false, error: `setanchor: unknown dimension '${dimension}'` }; }

  setAnchor({
    dimension,
    pos: { x, y, z },
    facing: facing as Facing,
    setBy: { name: "agent", id: "agent" },
    setAt: Date.now(),
  });
  console.log(`[rsforge] setanchor (agent): ${dimension} ${x} ${y} ${z} ${facing}`);
  return { ok: true, data: { dimension, pos: { x, y, z }, facing } };
}

// ---------- test ----------

async function handleTest(payload: { jobId?: string; testName?: string }): Promise<CommandResult> {
  const job = payload.jobId ? getJob(payload.jobId) : latest();
  if (!job) {
    return {
      ok: false,
      error: payload.jobId
        ? `no job with id '${payload.jobId}'`
        : "no job recorded yet — build a spec first",
    };
  }
  if (job.status === "undone") {
    return {
      ok: false,
      error: `job '${job.id}' has been undone; rebuild before testing`,
    };
  }

  const tests = job.spec.tests ?? [];
  if (tests.length === 0) {
    return {
      ok: false,
      error: `job '${job.id}' (${job.name}) has no tests declared in its spec`,
    };
  }

  let results;
  if (payload.testName !== undefined) {
    const t = tests.find((x) => x.name === payload.testName);
    if (!t) {
      return {
        ok: false,
        error: `no test named '${payload.testName}' (available: ${tests.map((x) => x.name).join(", ")})`,
      };
    }
    results = [await runTest(t, job)];
  } else {
    results = await runAllTests(job);
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(
    `[rsforge] test ${job.id} '${job.name}': ${passed}/${results.length} passed`,
  );

  return {
    ok: failed === 0,
    data: {
      jobId: job.id,
      name: job.name,
      passed,
      failed,
      results,
    },
    ...(failed > 0 ? { error: `${failed} of ${results.length} tests failed` } : {}),
  } as CommandResult;
}
