/**
 * Simulated player driver: spawns a transient SimulatedPlayer to perform
 * a single block interaction, then disposes of it.
 *
 * Why this exists: the Script API path for placing/mutating redstone
 * source blocks (lever, button) does NOT fire the same neighbor-update
 * notifications a real player's right-click does. See:
 *   bugs/script-api-lever-state-mutation-no-update.md
 *
 * A SimulatedPlayer's `interact()` raycast click goes through the same
 * code path as a human player's, so adjacent wires/pistons/comparators
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
  GameMode,
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

function waitTicks(n: number): Promise<void> {
  return new Promise((resolve) => system.runTimeout(() => resolve(), n));
}
