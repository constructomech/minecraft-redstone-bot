/**
 * Command dispatcher: invoked by the pack's poll loop once it picks up
 * a command from the daemon. Routes by `cmd.type` to the right handler
 * (build, undo, test), catches errors, returns a structured result the
 * dispatcher posts back to the daemon.
 *
 * Async since /test uses system.runTimeout between steps.
 */
import { world } from "@minecraft/server";
import { getAnchor } from "./anchor.js";
import { getJob, latest, latestUndoable, recordJob } from "./jobs.js";
import { validateSpec } from "./spec/schema.js";
import { runAllTests, runTest } from "./test/runner.js";
import { executeBuild } from "./world/builder.js";
import { restoreSnapshot } from "./world/snapshot.js";

export type Command =
  | { jobId: string; type: "build"; payload: { spec: unknown } }
  | { jobId: string; type: "undo";  payload: { jobId?: string } }
  | { jobId: string; type: "test";  payload: { jobId?: string; testName?: string } };

export type CommandResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; errors?: unknown };

export async function dispatch(cmd: Command): Promise<CommandResult> {
  try {
    switch (cmd.type) {
      case "build": return handleBuild(cmd.payload, cmd.jobId);
      case "undo":  return handleUndo(cmd.payload);
      case "test":  return await handleTest(cmd.payload);
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
