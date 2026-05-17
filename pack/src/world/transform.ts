/**
 * Rotation math: positions + directional block-state values rotate
 * around the world Y axis when a spec is built with
 * `anchor: "player-facing"`.
 *
 * Convention: the spec's LOCAL +X axis points "in front of the
 * player". When the player faces east (the identity case), local +X
 * already equals world +X. Other facings rotate the entire spec
 * clockwise around Y (viewed from above):
 *
 *   facing east  -> 0 steps (identity)
 *   facing south -> 1 step  (90° CW)
 *   facing west  -> 2 steps (180°)
 *   facing north -> 3 steps (270° CW = 90° CCW)
 *
 * This module is pure data, has NO imports, and is unit-tested
 * host-side via test/transform.test.ts. Anchor.ts and the builder
 * both use it.
 */

export type Facing = "north" | "south" | "east" | "west";
export type Vec3Tuple = readonly [number, number, number];

/** Clockwise 90° steps around the world Y axis, viewed from above. */
export type RotationStep = 0 | 1 | 2 | 3;

const CARDINAL_CW: readonly Facing[] = ["east", "south", "west", "north"];

export function rotationForFacing(facing: Facing): RotationStep {
  switch (facing) {
    case "east":  return 0;
    case "south": return 1;
    case "west":  return 2;
    case "north": return 3;
  }
}

/** Rotate an integer (x, y, z) around Y by N CW steps. */
export function rotatePosition(p: Vec3Tuple, steps: RotationStep): Vec3Tuple {
  let x = p[0], z = p[2];
  for (let i = 0; i < steps; i++) {
    const nx = -z, nz = x;
    x = nx; z = nz;
  }
  // Normalize -0 to +0 so deepEqual / hashing don't get confused.
  return [x + 0, p[1], z + 0];
}

export function rotateCardinal(dir: Facing, steps: RotationStep): Facing {
  const idx = CARDINAL_CW.indexOf(dir);
  if (idx < 0) return dir;
  return CARDINAL_CW[(idx + steps) % 4]!;
}

/** Rotate an axis-6 direction string (cardinals rotate; up/down invariant). */
export function rotateAxis6(dir: string, steps: RotationStep): string {
  if (dir === "up" || dir === "down") return dir;
  if (CARDINAL_CW.includes(dir as Facing)) {
    return rotateCardinal(dir as Facing, steps);
  }
  return dir;
}

/** Rotate a torch_facing_direction value (cardinals + "top"). */
export function rotateTorchMount(v: string, steps: RotationStep): string {
  if (v === "top") return v;
  if (CARDINAL_CW.includes(v as Facing)) {
    return rotateCardinal(v as Facing, steps);
  }
  return v;
}

/**
 * Rotate a lever_direction value.
 *
 * Cardinals (north/south/east/west) are wall mounts and rotate as
 * cardinals. The four axis values (up_north_south, up_east_west,
 * down_north_south, down_east_west) describe a ceiling- or
 * floor-mounted lever lying along the NS or EW axis. A 90° rotation
 * swaps NS↔EW; 180° is a no-op for the axis half (cardinals still
 * flip 180°).
 */
export function rotateLeverMount(v: string, steps: RotationStep): string {
  if (CARDINAL_CW.includes(v as Facing)) {
    return rotateCardinal(v as Facing, steps);
  }
  const axisSwap: Record<string, string> = {
    "up_north_south":   "up_east_west",
    "up_east_west":     "up_north_south",
    "down_north_south": "down_east_west",
    "down_east_west":   "down_north_south",
  };
  if ((steps === 1 || steps === 3) && axisSwap[v]) return axisSwap[v];
  return v;
}

/**
 * Rotate a 0–5 facing_direction integer (used by piston, observer,
 * button).
 *
 *   0 = down  (invariant)
 *   1 = up    (invariant)
 *   2 = north, 5 = east, 3 = south, 4 = west  (CW: 2 → 5 → 3 → 4 → 2)
 */
export function rotateFacingInt(n: number, steps: RotationStep): number {
  if (n === 0 || n === 1) return n;
  const cw = [2, 5, 3, 4]; // north, east, south, west
  const idx = cw.indexOf(n);
  if (idx < 0) return n;
  return cw[(idx + steps) % 4]!;
}

/**
 * Rotate a 0–3 direction integer (used by repeater/comparater).
 *
 *   0 = south, 1 = west, 2 = north, 3 = east
 *   1 CW step adds 1 (mod 4).
 */
export function rotateDirectionInt(n: number, steps: RotationStep): number {
  if (!Number.isInteger(n) || n < 0 || n > 3) return n;
  return (n + steps) % 4;
}

/** Tag enum for which rotation a state key needs. */
export type RotationKind =
  | "cardinal"
  | "axis6"
  | "torch_mount"
  | "lever_mount"
  | "facing_int"
  | "direction_int";

/** Apply the right rotation to a single state value. */
export function rotateStateValue(
  kind: RotationKind,
  value: string | number | boolean,
  steps: RotationStep,
): string | number | boolean {
  if (steps === 0) return value;
  switch (kind) {
    case "cardinal":
      return typeof value === "string" ? rotateCardinal(value as Facing, steps) : value;
    case "axis6":
      return typeof value === "string" ? rotateAxis6(value, steps) : value;
    case "torch_mount":
      return typeof value === "string" ? rotateTorchMount(value, steps) : value;
    case "lever_mount":
      return typeof value === "string" ? rotateLeverMount(value, steps) : value;
    case "facing_int":
      return typeof value === "number" ? rotateFacingInt(value, steps) : value;
    case "direction_int":
      return typeof value === "number" ? rotateDirectionInt(value, steps) : value;
  }
}

/**
 * Apply all rotation-kind-tagged transforms to a state object.
 * Returns a new object; the input is not mutated. State keys not in
 * `rotations` (e.g. open_bit, repeater_delay, redstone_signal) are
 * copied through unchanged.
 */
export function rotateStates(
  states: Readonly<Record<string, string | number | boolean>>,
  rotations: Readonly<Record<string, RotationKind>> | undefined,
  steps: RotationStep,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(states)) {
    const kind = rotations?.[key];
    out[key] = kind ? rotateStateValue(kind, value, steps) : value;
  }
  return out;
}
