/**
 * Job store: tracks builds the pack has executed so /undo + /test can
 * find the snapshot, spec, and anchor. In-memory; lost on world
 * reload (acceptable for Phase 4b; persistence is Phase 7 polish).
 */
import type { Vector3 } from "@minecraft/server";
import type { Anchor } from "./anchor.js";
import type { ContraptionSpec } from "./spec/schema.js";
import type { RotationStep } from "./world/transform.js";
import type { Snapshot } from "./world/snapshot.js";

export type JobStatus = "completed" | "undone" | "redone";

export type Job = {
  readonly id: string;
  readonly name: string;
  /** The original spec — needed so /test can find ports + tests. */
  readonly spec: ContraptionSpec;
  /** Anchor at build time. Ports resolve relative to this. */
  readonly anchor: Anchor;
  /** Rotation applied during build. Ports rotate by the same amount. */
  readonly rotationSteps: RotationStep;
  readonly snapshot: Snapshot;
  readonly bounds: { readonly min: Vector3; readonly max: Vector3 };
  readonly placed: number;
  status: JobStatus;
  readonly createdAt: number;
};

const jobs = new Map<string, Job>();
const order: string[] = []; // chronological insertion order

export function recordJob(job: Job): void {
  jobs.set(job.id, job);
  order.push(job.id);
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

/** Most recent job that's still in `completed` status (i.e. undoable). */
export function latestUndoable(): Job | undefined {
  for (let i = order.length - 1; i >= 0; i--) {
    const j = jobs.get(order[i]!);
    if (j && j.status === "completed") return j;
  }
  return undefined;
}

/** Most recent job that's in `undone` status (i.e. ready to redo). */
export function latestUndone(): Job | undefined {
  for (let i = order.length - 1; i >= 0; i--) {
    const j = jobs.get(order[i]!);
    if (j && j.status === "undone") return j;
  }
  return undefined;
}

/** Most recent completed job, regardless of status — for /test default. */
export function latest(): Job | undefined {
  for (let i = order.length - 1; i >= 0; i--) {
    const j = jobs.get(order[i]!);
    if (j) return j;
  }
  return undefined;
}

/** Newest-first snapshot of the job list, optionally limited. */
export function listJobs(limit = 20): Job[] {
  const out: Job[] = [];
  for (let i = order.length - 1; i >= 0 && out.length < limit; i--) {
    const j = jobs.get(order[i]!);
    if (j) out.push(j);
  }
  return out;
}
