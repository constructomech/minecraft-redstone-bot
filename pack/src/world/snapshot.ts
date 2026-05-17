/**
 * Snapshot a set of block positions so /undo can restore them.
 *
 * Phase 3: stores BlockPermutation references in memory. Permutations
 * are immutable engine objects, so this is cheap and correct as long
 * as the pack stays loaded. Snapshots are lost on world reload — that
 * tradeoff is acceptable for Phase 3; persistent snapshots come in
 * Phase 7.
 */
import {
  BlockPermutation,
  type Dimension,
  type Vector3,
} from "@minecraft/server";

export type SnapshotEntry = {
  readonly pos: Vector3;
  readonly permutation: BlockPermutation;
};

export type Snapshot = {
  readonly dimension: string;
  readonly entries: readonly SnapshotEntry[];
};

export function captureSnapshot(
  dim: Dimension,
  positions: readonly Vector3[],
): Snapshot {
  const entries: SnapshotEntry[] = [];
  for (const pos of positions) {
    const block = dim.getBlock(pos);
    if (!block) {
      throw new Error(
        `snapshot: block at ${pos.x},${pos.y},${pos.z} is null (chunk unloaded?)`,
      );
    }
    entries.push({ pos: { x: pos.x, y: pos.y, z: pos.z }, permutation: block.permutation });
  }
  return { dimension: dim.id, entries };
}

/**
 * Restore every block in the snapshot. Idempotent — calling twice
 * just re-applies the same permutations.
 *
 * Returns the number of blocks actually touched.
 */
export function restoreSnapshot(dim: Dimension, snap: Snapshot): number {
  let restored = 0;
  for (const { pos, permutation } of snap.entries) {
    dim.setBlockPermutation(pos, permutation);
    restored += 1;
  }
  return restored;
}

/** Equivalent to setBlockType("minecraft:air") for every position. */
export function clearPositions(dim: Dimension, positions: readonly Vector3[]): number {
  const air = BlockPermutation.resolve("minecraft:air");
  let cleared = 0;
  for (const pos of positions) {
    dim.setBlockPermutation(pos, air);
    cleared += 1;
  }
  return cleared;
}
