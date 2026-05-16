/**
 * Anchor state: where in the world the agent will place contraptions.
 *
 * Persisted across world reloads via a world dynamic property
 * (JSON-encoded). One anchor per world for now; per-player anchors
 * are a possible future extension (PLAN.md "open questions").
 */
import { world, type Vector3 } from "@minecraft/server";

const DYNAMIC_KEY = "rsforge:anchor";

export type Facing = "north" | "south" | "east" | "west";

export type Anchor = {
  /** Dimension id, e.g. "minecraft:overworld". */
  dimension: string;
  /** Integer block coords. */
  pos: { x: number; y: number; z: number };
  /** Cardinal direction the player faced when setting the anchor. */
  facing: Facing;
  /** Player name + xuid for record-keeping. */
  setBy: { name: string; id: string };
  /** ms-since-epoch when set. */
  setAt: number;
};

/**
 * Convert a Minecraft player's yaw to the nearest cardinal direction.
 *
 * Bedrock yaw convention (degrees):
 *    0   = facing +Z (south)
 *   90   = facing -X (west)
 *   180  = facing -Z (north)
 *  -90   = facing +X (east)
 */
export function yawToFacing(yawDeg: number): Facing {
  // Normalize to [-180, 180).
  let y = ((yawDeg + 180) % 360 + 360) % 360 - 180;
  if (y >= -45 && y < 45) return "south";
  if (y >= 45 && y < 135) return "west";
  if (y >= -135 && y < -45) return "east";
  return "north";
}

/** Unit offset for a cardinal direction. Useful for "show anchor" particles. */
export function facingOffset(f: Facing): Vector3 {
  switch (f) {
    case "north": return { x: 0, y: 0, z: -1 };
    case "south": return { x: 0, y: 0, z:  1 };
    case "east":  return { x: 1, y: 0, z:  0 };
    case "west":  return { x: -1, y: 0, z: 0 };
  }
}

// In-memory cache. `undefined` means "not loaded yet"; `null` means
// "loaded and definitely absent". JS shorthand: a 3-state.
let cached: Anchor | null | undefined = undefined;

export function getAnchor(): Anchor | null {
  if (cached !== undefined) return cached;
  const raw = world.getDynamicProperty(DYNAMIC_KEY);
  if (typeof raw === "string") {
    try {
      cached = JSON.parse(raw) as Anchor;
    } catch {
      console.warn(`[rsforge] anchor dynamic property is corrupt, clearing`);
      world.setDynamicProperty(DYNAMIC_KEY, undefined);
      cached = null;
    }
  } else {
    cached = null;
  }
  return cached;
}

export function setAnchor(a: Anchor): void {
  cached = a;
  world.setDynamicProperty(DYNAMIC_KEY, JSON.stringify(a));
}

export function clearAnchor(): void {
  cached = null;
  world.setDynamicProperty(DYNAMIC_KEY, undefined);
}
