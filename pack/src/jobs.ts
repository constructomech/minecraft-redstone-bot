/**
 * Job store: tracks builds the pack has executed so /undo can find the
 * snapshot. In-memory for Phase 3; lost on world reload (acceptable
 * tradeoff — Phase 7 polish can persist via dynamic properties).
 */
import type { Snapshot } from "./world/snapshot.js";
import type { Vector3 } from "@minecraft/server";

export type JobStatus = "completed" | "undone";

export type Job = {
  readonly id: string;
  readonly name: string;
  readonly snapshot: Snapshot;
  readonly bounds: { readonly min: Vector3; readonly max: Vector3 };
  readonly placed: number;
  status: JobStatus;
  readonly createdAt: number;
};

const jobs = new Map<string, Job>();
const order: string[] = []; // chronological insertion order, for "latest"

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

/** Newest-first snapshot of the job list, optionally limited. */
export function listJobs(limit = 20): Job[] {
  const out: Job[] = [];
  for (let i = order.length - 1; i >= 0 && out.length < limit; i--) {
    const j = jobs.get(order[i]!);
    if (j) out.push(j);
  }
  return out;
}
