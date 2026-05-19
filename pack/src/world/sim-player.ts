/**
 * Simulated player driver: spawns a transient SimulatedPlayer to perform
 * a single block interaction (or block placement), then disposes of it.
 *
 * Why this exists: the Script API path for placing/mutating redstone
 * source blocks (lever, button) does NOT fire the same neighbor-update
 * notifications a real player's right-click does. See:
 *   bugs/script-api-lever-state-mutation-no-update.md
 *   bugs/script-api-piston-no-power-response.md
 *
 * A SimulatedPlayer's `interact()` raycast click and
 * `useItemInSlotOnBlock` placement go through the same engine code
 * paths as a human player's, so adjacent wires / pistons / comparators
 * respond correctly. The sim player is spawned, used once, and removed
 * within ~6 ticks.
 *
 * Spawn-on-demand instead of a persistent driver: we don't want a stray
 * player entity hanging around in the user's world between tests.
 *
 * NOTE: `@minecraft/server-gametest`'s top-level `spawnSimulatedPlayer`
 * is NOT tied to a registered GameTest, so we don't need a structure
 * file or `/gametest run` invocation.
 */
import {
  Direction,
  GameMode,
  ItemStack,
  system,
  type Dimension,
  type DimensionLocation,
  type Vector3,
} from "@minecraft/server";
import { spawnSimulatedPlayer } from "@minecraft/server-gametest";

const PLAYER_NAME = "RsForgeBot";

/**
 * Spawn a simulated player adjacent to `blockPos`, have it click that
 * block (as if a human right-clicked it), and remove the player.
 *
 * Resolves once the click has been issued and the player removed.
 * Throws if the spawn or interact API call fails.
 */
export async function simInteractWithBlock(
  dim: Dimension,
  blockPos: Vector3,
): Promise<void> {
  // Spawn the bot 2 blocks above the target so its head is roughly at
  // y = blockPos.y + 3 looking down at the lever. Creative + fly avoids
  // gravity, suffocation, and inventory clutter.
  const spawnLoc: DimensionLocation = {
    dimension: dim,
    x: blockPos.x + 0.5,
    y: blockPos.y + 2,
    z: blockPos.z + 0.5,
  };

  const player = spawnSimulatedPlayer(spawnLoc, PLAYER_NAME, GameMode.Creative);
  try {
    // Without fly(), the bot tends to fall during the look→interact gap.
    player.fly();
    player.lookAtBlock(blockPos);
    // One tick for lookAt to apply before raycasting.
    await waitTicks(1);
    // interact() does a raycast from the head and clicks whatever it
    // hits. This works for levers, buttons, doors, etc. — `interactWithBlock`
    // is documented as requiring a "solid" block, which levers aren't.
    const ok = player.interact();
    if (!ok) {
      // Fall back to direct block-targeted interact (works for some
      // attached blocks in current Bedrock builds).
      player.interactWithBlock(blockPos);
    }
    // Give the click a tick to register before despawning.
    await waitTicks(1);
  } finally {
    try { player.remove(); } catch { /* already gone */ }
  }
}

/**
 * Use a sim-player to break the block at `targetPos` (if any) and place
 * a fresh block of `itemId` there by clicking the `face` of an adjacent
 * `supportPos`. The sim-player ends up positioned on the opposite side
 * of `supportPos` from `targetPos`, looking through to it.
 *
 * For pistons/observers/etc. where placement direction matters: the
 * placed block faces the same direction as the sim-player looks (which
 * is the direction from sim-player → target, equal to `face`).
 *
 * `face` is the face of `supportPos` that touches `targetPos`. Caller
 * picks it such that the piston's head will extend in the intended
 * direction.
 *
 * This is the documented workaround for the script-api piston bug
 * (see bugs/script-api-piston-no-power-response.md). Real-player and
 * sim-player-via-useItemInSlotOnBlock placements integrate correctly
 * with the redstone update graph; runCommand and setBlockPermutation
 * placements don't.
 */
export async function simReplaceBlock(
  dim: Dimension,
  targetPos: Vector3,
  supportPos: Vector3,
  face: Direction,
  itemId: string,
): Promise<{ broke: boolean; placed: boolean; details: string }> {
  // Spawn high in the sky to avoid collisions during initialization,
  // then teleport into position.
  const spawnLoc: DimensionLocation = {
    dimension: dim,
    x: targetPos.x + 0.5,
    y: 300,
    z: targetPos.z + 0.5,
  };

  const player = spawnSimulatedPlayer(spawnLoc, PLAYER_NAME, GameMode.Creative);
  let broke = false;
  let placed = false;
  const log: string[] = [];

  try {
    player.fly();

    // Work position: on the opposite side of supportPos from targetPos.
    const delta = faceOffset(face);
    const workPos: Vector3 = {
      x: supportPos.x - delta.x + 0.5,
      y: supportPos.y,
      z: supportPos.z - delta.z + 0.5,
    };
    const targetCenter: Vector3 = {
      x: targetPos.x + 0.5, y: targetPos.y + 0.5, z: targetPos.z + 0.5,
    };
    player.teleport(workPos, {
      dimension: dim,
      facingLocation: targetCenter,
    });
    await waitTicks(4); // generous settle time
    log.push(`tp to ${workPos.x},${workPos.y},${workPos.z} facing ${targetCenter.x},${targetCenter.y},${targetCenter.z}`);

    // Break the existing block (if any) at targetPos.
    const beforeBreak = dim.getBlock(targetPos)?.typeId ?? "<null>";
    player.breakBlock(targetPos);
    await waitTicks(3);
    const afterBreak = dim.getBlock(targetPos)?.typeId ?? "<null>";
    broke = afterBreak === "minecraft:air";
    log.push(`break: ${beforeBreak} -> ${afterBreak} (broke=${broke})`);

    // Re-confirm look direction and use the item directly (bypass slot index).
    player.lookAtBlock(supportPos);
    await waitTicks(2);

    const stack = new ItemStack(itemId, 1);
    const placedResult = player.useItemOnBlock(stack, supportPos, face);
    await waitTicks(4);
    const afterPlace = dim.getBlock(targetPos)?.typeId ?? "<null>";
    placed = afterPlace === itemId;
    log.push(`useItemOnBlock returned ${placedResult}; block at target now: ${afterPlace}`);

    if (!placed) {
      console.warn(`[rsforge] simReplaceBlock failed: ${log.join(" | ")}`);
    }
  } finally {
    try { player.remove(); } catch { /* already gone */ }
  }
  return { broke, placed, details: log.join(" | ") };
}

function faceOffset(face: Direction): Vector3 {
  switch (face) {
    case Direction.Up:    return { x: 0, y: 1,  z: 0 };
    case Direction.Down:  return { x: 0, y: -1, z: 0 };
    case Direction.North: return { x: 0, y: 0,  z: -1 };
    case Direction.South: return { x: 0, y: 0,  z: 1 };
    case Direction.East:  return { x: 1, y: 0,  z: 0 };
    case Direction.West:  return { x: -1, y: 0, z: 0 };
  }
}

function waitTicks(n: number): Promise<void> {
  return new Promise((resolve) => system.runTimeout(() => resolve(), n));
}

