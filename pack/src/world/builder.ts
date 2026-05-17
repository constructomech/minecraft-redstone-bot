/**
 * Builder: turn a ContraptionSpec + Anchor into actual block placements,
 * snapshotting the pre-build state first so /undo can restore it.
 *
 * Two anchor modes:
 *   - "absolute"      : local coords add to anchor.pos, no rotation.
 *   - "player-facing" : local +X axis is rotated to point "in front of
 *                       the player", and directional block states
 *                       rotate to match. See pack/src/world/transform.ts.
 */
import {
  BlockPermutation,
  world,
  type Dimension,
  type Vector3,
} from "@minecraft/server";
import type { Anchor } from "../anchor.js";
import { findComponent } from "../spec/components.js";
import type { ContraptionSpec, SpecBlock } from "../spec/schema.js";
import { captureSnapshot, type Snapshot } from "./snapshot.js";
import {
  rotatePosition,
  rotationForFacing,
  rotateStates,
  type RotationStep,
} from "./transform.js";

export type Placement = {
  readonly abs: Vector3;
  readonly permutation: BlockPermutation;
  readonly specIndex: number;
};

export type BuildResult = {
  readonly placed: number;
  readonly snapshot: Snapshot;
  readonly bounds: { readonly min: Vector3; readonly max: Vector3 };
  readonly rotationSteps: RotationStep;
};

/**
 * Resolve a spec's blocks against an anchor into absolute positions
 * and concrete BlockPermutations. Throws on the first block whose
 * id+states are rejected by Bedrock's BlockPermutation.resolve.
 */
export function planPlacements(spec: ContraptionSpec, anchor: Anchor): {
  placements: Placement[];
  rotationSteps: RotationStep;
} {
  const mode = spec.anchor ?? "absolute";
  const steps: RotationStep = mode === "player-facing"
    ? rotationForFacing(anchor.facing)
    : 0;

  const placements: Placement[] = spec.blocks.map((blk, i) => placeOne(blk, i, anchor, steps));
  return { placements, rotationSteps: steps };
}

function placeOne(
  blk: SpecBlock,
  i: number,
  anchor: Anchor,
  steps: RotationStep,
): Placement {
  const localRotated = rotatePosition(blk.at, steps);
  const abs: Vector3 = {
    x: anchor.pos.x + localRotated[0],
    y: anchor.pos.y + localRotated[1],
    z: anchor.pos.z + localRotated[2],
  };

  let permutation: BlockPermutation;
  try {
    if (blk.states && Object.keys(blk.states).length > 0) {
      const def = findComponent(blk.id);
      const rotatedStates = rotateStates(blk.states, def?.stateRotations, steps);
      permutation = BlockPermutation.resolve(blk.id, rotatedStates);
    } else {
      permutation = BlockPermutation.resolve(blk.id);
    }
  } catch (err) {
    throw new Error(
      `block [${i}] ${blk.id} at local [${blk.at.join(",")}]: ${String(err)}`,
    );
  }
  return { abs, permutation, specIndex: i };
}

/**
 * Capture a snapshot of every position we'll write to, then apply the
 * placements. Returns the snapshot for the caller to associate with a
 * job for later /undo.
 */
export function executeBuild(spec: ContraptionSpec, anchor: Anchor): BuildResult {
  const dim = world.getDimension(anchor.dimension);

  const { placements, rotationSteps } = planPlacements(spec, anchor);
  const positions = placements.map((p) => p.abs);
  const snapshot = captureSnapshot(dim, positions);

  for (const p of placements) {
    dim.setBlockPermutation(p.abs, p.permutation);
  }

  const bounds = computeBounds(positions);
  return { placed: placements.length, snapshot, bounds, rotationSteps };
}

function computeBounds(positions: readonly Vector3[]): { min: Vector3; max: Vector3 } {
  if (positions.length === 0) {
    const zero: Vector3 = { x: 0, y: 0, z: 0 };
    return { min: zero, max: zero };
  }
  const first = positions[0]!;
  let minX = first.x, minY = first.y, minZ = first.z;
  let maxX = first.x, maxY = first.y, maxZ = first.z;
  for (const p of positions) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

/** Get the dimension referenced by an anchor. */
export function dimensionForAnchor(anchor: Anchor): Dimension {
  return world.getDimension(anchor.dimension);
}
