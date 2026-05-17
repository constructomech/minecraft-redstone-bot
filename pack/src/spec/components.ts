/**
 * Components allowlist + per-block state-key whitelist.
 *
 * The authoritative source for "what block IDs can appear in a
 * ContraptionSpec." Builders, validators, and the agent must only
 * use IDs and state keys listed here.
 *
 * Schema values come from empirical block dumps via
 * `tools/discover-states.mjs` against BDS 1.26.21.1. If a future BDS
 * release changes a state key, re-run that script and update.
 *
 * Phase 3: just the IDs + state-key whitelists. Rotation transforms
 * for directional states come in Phase 4.
 */

export type ComponentDef = {
  /** Bedrock block id. */
  readonly id: string;
  /** State keys the spec may set. Anything else is rejected. */
  readonly stateKeys: readonly string[];
  /** One-line human label. */
  readonly label: string;
};

export const COMPONENTS: readonly ComponentDef[] = [
  // ---- structural / filler ----
  { id: "minecraft:stone",         stateKeys: ["stone_type"], label: "stone (filler)" },
  { id: "minecraft:glass",         stateKeys: [],             label: "glass (visible filler)" },

  // ---- power sources & wire ----
  { id: "minecraft:redstone_wire",  stateKeys: [],            label: "redstone wire" },
  { id: "minecraft:redstone_block", stateKeys: [],            label: "redstone block (always-on power source)" },

  // ---- output ----
  { id: "minecraft:redstone_lamp", stateKeys: [], label: "redstone lamp (off by default; lights up when powered)" },
  // The lit variant exists but specs should use the off form — Bedrock
  // auto-swaps to lit_redstone_lamp when powered.

  // ---- inputs ----
  { id: "minecraft:lever",
    stateKeys: ["lever_direction", "open_bit"],
    label: "lever (lever_direction: north|south|east|west|up_north_south|up_east_west|down_north_south|down_east_west)" },
  { id: "minecraft:wooden_button",
    stateKeys: ["facing_direction", "button_pressed_bit"],
    label: "wooden button (facing_direction: 0-5)" },
  { id: "minecraft:stone_button",
    stateKeys: ["facing_direction", "button_pressed_bit"],
    label: "stone button (facing_direction: 0-5)" },
  { id: "minecraft:wooden_pressure_plate",
    stateKeys: ["redstone_signal"],
    label: "wooden pressure plate" },
  { id: "minecraft:stone_pressure_plate",
    stateKeys: ["redstone_signal"],
    label: "stone pressure plate" },

  // ---- inversion / signal shaping ----
  { id: "minecraft:redstone_torch",
    stateKeys: ["torch_facing_direction"],
    label: "redstone torch (torch_facing_direction: north|south|east|west|top)" },

  // ---- timing / logic ----
  { id: "minecraft:unpowered_repeater",
    stateKeys: ["direction", "repeater_delay", "minecraft:cardinal_direction"],
    label: "repeater (use this id even for powered state; Bedrock auto-switches to powered_repeater)" },
  { id: "minecraft:unpowered_comparator",
    stateKeys: ["direction", "minecraft:cardinal_direction", "output_lit_bit", "output_subtract_bit"],
    label: "comparator (output_subtract_bit=true for subtract mode)" },
  { id: "minecraft:observer",
    stateKeys: ["facing_direction", "minecraft:facing_direction", "powered_bit"],
    label: "observer (facing_direction: 0-5; fires 1-tick pulse on front-face block update)" },

  // ---- motion ----
  { id: "minecraft:piston",
    stateKeys: ["facing_direction"],
    label: "piston (facing_direction: 0-5; head extends to that side when powered)" },
  { id: "minecraft:sticky_piston",
    stateKeys: ["facing_direction"],
    label: "sticky piston" },
];

const BY_ID = new Map<string, ComponentDef>(COMPONENTS.map((c) => [c.id, c]));

export function findComponent(id: string): ComponentDef | undefined {
  return BY_ID.get(id);
}

export function isAllowedComponent(id: string): boolean {
  return BY_ID.has(id);
}

/**
 * Validate that a spec's state-key/values are at least nominally
 * allowed for the given component id. Returns null on success, or a
 * single-line error message on failure.
 *
 * We DON'T validate state VALUES here — Bedrock's BlockPermutation.resolve
 * does that authoritatively and gives a clear error. We only catch
 * obvious "unknown state key for this block" mistakes.
 */
export function checkStateKeys(
  id: string,
  states: Record<string, unknown>,
): string | null {
  const def = findComponent(id);
  if (!def) return `unknown block id '${id}' (not in components allowlist)`;
  const allowed = new Set(def.stateKeys);
  for (const key of Object.keys(states)) {
    if (!allowed.has(key)) {
      return `block '${id}': state key '${key}' not in allowed set [${def.stateKeys.join(", ")}]`;
    }
  }
  return null;
}
