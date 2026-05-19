/**
 * Builder: turn a ContraptionSpec + Anchor into actual block placements,
 * snapshotting the pre-build state first so /undo can restore it.
 *
 * Two anchor modes:
 *   - "absolute"      : local coords add to anchor.pos, no rotation.
 *   - "player-facing" : local +X axis is rotated to point "in front of
 *                       the player", and directional block states
 *                       rotate to match. See pack/src/world/transform.ts.
 *
 * Placement is via `dim.runCommand("setblock x y z <id> [..states..]")`
 * for almost everything. Empirically, batched `setBlockPermutation`
 * calls on a fresh BDS occasionally drop placements outright — the
 * selftest reproduces this for stone (foundation block) AND for lever
 * (placed lever vanishes a few ticks later, the old bug 3 symptom).
 * The vanilla `/setblock` command goes through Bedrock's normal place
 * path which establishes neighbor-update queues and attached-block
 * pointers correctly.
 *
 * The exception is pistons: `runCommand setblock` triggers bug 5 (piston
 * placed but never responds to power), while `setBlockPermutation`
 * places them correctly registered in the redstone graph. We carve
 * them out into the Script API path on purpose.
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

/**
 * Blocks placed via `setBlockPermutation`. These are blocks whose
 * runCommand placement path triggers a bug — currently just pistons
 * (bug 5). Everything else goes through runCommand.
 */
const SET_PERMUTATION_IDS: ReadonlySet<string> = new Set([
  "minecraft:piston",
  "minecraft:sticky_piston",
]);

export type Placement = {
  readonly abs: Vector3;
  readonly permutation: BlockPermutation;
  readonly id: string;
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
  return { abs, permutation, id: blk.id, specIndex: i };
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
    if (SET_PERMUTATION_IDS.has(p.id)) {
      dim.setBlockPermutation(p.abs, p.permutation);
    } else {
      dim.runCommand(formatSetblockCommand(p.abs, p.permutation));
    }
  }

  const bounds = computeBounds(positions);
  return { placed: placements.length, snapshot, bounds, rotationSteps };
}

/**
 * Format a `/setblock` command string that preserves block-state values.
 * For stateless blocks the command is bare; for stateful ones the
 * states are spelled out in Bedrock's bracket syntax.
 */
function formatSetblockCommand(pos: Vector3, perm: BlockPermutation): string {
  const states = perm.getAllStates();
  const keys = Object.keys(states);
  if (keys.length === 0) {
    return `setblock ${pos.x} ${pos.y} ${pos.z} ${perm.type.id}`;
  }
  const pairs = keys.map((k) => {
    const v = states[k];
    if (typeof v === "string")  return `"${k}"="${v}"`;
    if (typeof v === "boolean") return `"${k}"=${v ? "true" : "false"}`;
    if (typeof v === "number")  return `"${k}"=${v}`;
    return `"${k}"="${String(v)}"`;
  });
  return `setblock ${pos.x} ${pos.y} ${pos.z} ${perm.type.id} [${pairs.join(",")}]`;
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
