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
 * IMPORTANT: blocks whose behaviour depends on neighbour power state
 * (redstone wire, lamp, repeater, comparator, observer) need to go
 * through Bedrock's vanilla /setblock path to be correctly registered
 * in the redstone update graph. setBlockPermutation alone places the
 * block but doesn't fire the neighbor-update notifications, so e.g.
 * lamps placed by setBlockPermutation are destroyed (set to air)
 * instead of transitioning to lit_redstone_lamp when adjacent wire
 * powers up. See bugs/script-api-lamp-destroyed-on-transition.md
 * (and the three sibling bug reports — they share a root cause).
 *
 * Workaround used here: after the natural setBlockPermutation call,
 * follow up with `dim.runCommand("setblock x y z <id>")` for the
 * affected block types. The block ends up placed twice but only the
 * second placement registers properly in the update graph.
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
 * Block IDs that need to skip setBlockPermutation entirely and go
 * straight through runCommand("setblock ...") for placement. These
 * are the redstone-responsive blocks whose update-graph registration
 * gets poisoned by setBlockPermutation, causing the on/off ID-swap
 * transition to destroy them. See
 * bugs/script-api-lamp-destroyed-on-transition.md.
 *
 * Only listed for STATELESS blocks here; stateful blocks (repeater,
 * comparator, observer, piston) need their state values preserved,
 * so they keep using setBlockPermutation + a runCommand follow-up.
 */
const RUNCOMMAND_ONLY_STATELESS: ReadonlySet<string> = new Set([
  "minecraft:redstone_wire",
  "minecraft:redstone_lamp",
]);

/**
 * Stateful redstone-responsive blocks: use setBlockPermutation for the
 * state, then re-register via runCommand. Imperfect but the best we
 * can do without re-implementing block-state encoding inline in the
 * /setblock command string.
 */
const STATEFUL_REREGISTER: ReadonlySet<string> = new Set([
  "minecraft:unpowered_repeater",
  "minecraft:powered_repeater",
  "minecraft:unpowered_comparator",
  "minecraft:powered_comparator",
  "minecraft:observer",
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
    if (RUNCOMMAND_ONLY_STATELESS.has(p.id)) {
      // Skip setBlockPermutation entirely for these — using it poisons
      // the block's update-graph registration so subsequent state
      // transitions destroy the block. See module header.
      try {
        dim.runCommand(`setblock ${p.abs.x} ${p.abs.y} ${p.abs.z} ${p.id}`);
      } catch (err) {
        throw new Error(
          `runCommand placement failed for ${p.id} at ${p.abs.x},${p.abs.y},${p.abs.z}: ${String(err)}`,
        );
      }
      continue;
    }

    dim.setBlockPermutation(p.abs, p.permutation);

    if (STATEFUL_REREGISTER.has(p.id)) {
      // Re-register stateful redstone blocks in the update graph.
      // (Their state values are already established by the
      // setBlockPermutation call above.)
      try {
        dim.runCommand(`setblock ${p.abs.x} ${p.abs.y} ${p.abs.z} ${p.id}`);
      } catch (err) {
        console.warn(
          `[rsforge] re-register failed for ${p.id} at ${p.abs.x},${p.abs.y},${p.abs.z}: ${String(err)}`,
        );
      }
    }
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
