/**
 * Debug scriptevent handlers — server-source commands that let the
 * agent's self-test harness drive the pack without needing a player.
 *
 * Activated only when `variables.debug_enabled === true`. Off-switch
 * exists for any future non-dev deployment.
 *
 * Driven from BDS console (or any /scriptevent invocation):
 *
 *   /scriptevent rsforge:debug_setanchor 0 64 0 north
 *   /scriptevent rsforge:debug_setanchor 0 64 0 north minecraft:nether
 *   /scriptevent rsforge:debug_clearanchor
 *   /scriptevent rsforge:debug_state
 *
 * `debug_state` writes the current anchor JSON to the BDS console so
 * the harness can match it from stdout if it needs to.
 */
import { system, world, BlockPermutation } from "@minecraft/server";
import { variables } from "@minecraft/server-admin";
import {
  clearAnchor,
  getAnchor,
  setAnchor,
  type Anchor,
  type Facing,
} from "./anchor.js";

const VALID_FACINGS: readonly string[] = ["north", "south", "east", "west"];

export function startDebug(): void {
  const enabled = variables.get("debug_enabled");
  if (enabled !== true) {
    console.log("[rsforge] debug: disabled (variables.debug_enabled !== true)");
    return;
  }
  console.log(
    "[rsforge] debug: scriptevent handlers active under namespace 'rsforge'",
  );

  system.afterEvents.scriptEventReceive.subscribe(
    (event) => handle(event.id, event.message ?? ""),
    { namespaces: ["rsforge"] },
  );
}

function handle(id: string, message: string): void {
  try {
    switch (id) {
      case "rsforge:debug_setanchor":
        debugSetAnchor(message);
        break;
      case "rsforge:debug_clearanchor":
        debugClearAnchor();
        break;
      case "rsforge:debug_state":
        debugState();
        break;
      case "rsforge:debug_place_and_dump":
        debugPlaceAndDump(message);
        break;
      case "rsforge:debug_blockat":
        debugBlockAt(message);
        break;
      case "rsforge:debug_setperm":
        debugSetPermutation(message);
        break;
      case "rsforge:debug_setstate":
        debugSetState(message);
        break;
      default:
        // Other rsforge:* scriptevents are not ours; ignore.
        return;
    }
  } catch (err) {
    console.error(`[rsforge] debug ${id} failed: ${String(err)}`);
  }
}

function debugSetAnchor(message: string): void {
  const parts = message.trim().split(/\s+/);
  if (parts.length < 4) {
    console.error(
      `[rsforge] debug_setanchor: expected "<x> <y> <z> <facing> [dim]", got "${message}"`,
    );
    return;
  }
  const [xs, ys, zs, facingStr, dimStr] = parts as [string, string, string, string, string?];
  const x = Number.parseInt(xs, 10);
  const y = Number.parseInt(ys, 10);
  const z = Number.parseInt(zs, 10);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    console.error(`[rsforge] debug_setanchor: non-integer coords in "${message}"`);
    return;
  }
  if (!VALID_FACINGS.includes(facingStr)) {
    console.error(
      `[rsforge] debug_setanchor: invalid facing "${facingStr}" (want one of ${VALID_FACINGS.join("|")})`,
    );
    return;
  }
  const dimension = dimStr ?? "minecraft:overworld";

  const anchor: Anchor = {
    dimension,
    pos: { x, y, z },
    facing: facingStr as Facing,
    setBy: { name: "debug", id: "debug" },
    setAt: Date.now(),
  };

  setAnchor(anchor);
  console.log(
    `[rsforge] debug_setanchor: ${dimension} ${x} ${y} ${z} ${facingStr}`,
  );
}

function debugClearAnchor(): void {
  clearAnchor();
  console.log("[rsforge] debug_clearanchor: cleared");
}

function debugState(): void {
  const a = getAnchor();
  console.log(`[rsforge] debug_state: anchor=${JSON.stringify(a)}`);
}

/**
 * Mutate a single state value on the block at (x, y, z) via
 * `block.permutation.withState(...)` + `setBlockPermutation`. Used to
 * empirically test whether state mutations fire neighbour updates the
 * way a player toggle would.
 *
 * Payload: "<x> <y> <z> <key> <value>"
 *   value parses as: "true"/"false" -> boolean, integer string -> number,
 *   otherwise string.
 *   e.g. "8 81 8 open_bit true"
 */
function debugSetState(message: string): void {
  const parts = message.trim().split(/\s+/);
  if (parts.length < 5) {
    console.error(`[rsforge] debug_setstate: expected "<x> <y> <z> <key> <value>"`);
    return;
  }
  const [xs, ys, zs, key, valStr] = parts as [string, string, string, string, string];
  const x = Number.parseInt(xs, 10);
  const y = Number.parseInt(ys, 10);
  const z = Number.parseInt(zs, 10);
  let value: string | number | boolean = valStr;
  if (valStr === "true") value = true;
  else if (valStr === "false") value = false;
  else if (/^-?\d+$/.test(valStr)) value = Number.parseInt(valStr, 10);
  const dim = world.getDimension("minecraft:overworld");
  try {
    const block = dim.getBlock({ x, y, z });
    if (!block) {
      console.error(`[rsforge] debug_setstate: block at ${x},${y},${z} is null`);
      return;
    }
    const newPerm = block.permutation.withState(key, value);
    dim.setBlockPermutation({ x, y, z }, newPerm);
    console.log(`[rsforge] debug_setstate: ${block.typeId}.${key} -> ${String(value)} at ${x},${y},${z}`);
  } catch (err) {
    console.error(`[rsforge] debug_setstate failed: ${String(err)}`);
  }
}

/**
 * Place a block via `setBlockPermutation` (the Script API path) — the
 * one historically suspected of bypassing neighbour updates. Used to
 * empirically compare against `runCommand setblock` placement in the
 * same scenario.
 *
 * Payload: "<x> <y> <z> <blockId> [key=value ...]"
 *   e.g. "8 81 8 minecraft:redstone_block"
 *   e.g. "9 80 8 minecraft:sticky_piston facing_direction=4"
 *
 * State value parsing: "true"/"false" -> boolean, integer string -> number,
 * otherwise string.
 */
function debugSetPermutation(message: string): void {
  const parts = message.trim().split(/\s+/);
  if (parts.length < 4) {
    console.error(`[rsforge] debug_setperm: expected "<x> <y> <z> <id> [key=value ...]"`);
    return;
  }
  const [xs, ys, zs, blockId, ...stateAssignments] = parts as [string, string, string, string, ...string[]];
  const x = Number.parseInt(xs, 10);
  const y = Number.parseInt(ys, 10);
  const z = Number.parseInt(zs, 10);
  const states: Record<string, string | number | boolean> = {};
  for (const assign of stateAssignments) {
    const eq = assign.indexOf("=");
    if (eq < 0) {
      console.error(`[rsforge] debug_setperm: bad state assignment '${assign}' (expected key=value)`);
      return;
    }
    const k = assign.slice(0, eq);
    const v = assign.slice(eq + 1);
    if (v === "true") states[k] = true;
    else if (v === "false") states[k] = false;
    else if (/^-?\d+$/.test(v)) states[k] = Number.parseInt(v, 10);
    else states[k] = v;
  }
  const dim = world.getDimension("minecraft:overworld");
  try {
    const perm = Object.keys(states).length > 0
      ? BlockPermutation.resolve(blockId, states)
      : BlockPermutation.resolve(blockId);
    dim.setBlockPermutation({ x, y, z }, perm);
    console.log(
      `[rsforge] debug_setperm: ${blockId} at ${x},${y},${z} states=${JSON.stringify(states)} (via setBlockPermutation)`,
    );
  } catch (err) {
    console.error(`[rsforge] debug_setperm failed: ${String(err)}`);
  }
}

/**
 * Place a block at a fixed scratch location, then read it back and
 * log its typeId + every state key/value. Used during component
 * onboarding to confirm the actual Bedrock state schema.
 *
 * Payload: "<x> <y> <z> <blockId>"
 *   e.g. "1000 64 1000 minecraft:lever"
 */
function debugPlaceAndDump(message: string): void {
  const parts = message.trim().split(/\s+/);
  if (parts.length < 4) {
    console.error(`[rsforge] debug_place_and_dump: expected "<x> <y> <z> <id>"`);
    return;
  }
  const [xs, ys, zs, blockId] = parts as [string, string, string, string];
  const x = Number.parseInt(xs, 10);
  const y = Number.parseInt(ys, 10);
  const z = Number.parseInt(zs, 10);
  const dim = world.getDimension("minecraft:overworld");
  try {
    dim.setBlockType({ x, y, z }, blockId);
    const block = dim.getBlock({ x, y, z });
    if (!block) {
      console.log(`[rsforge] debug_place_and_dump: block at ${x},${y},${z} is null`);
      return;
    }
    const p = block.permutation;
    const allStates = p.getAllStates();
    console.log(
      `[rsforge] debug_place_and_dump: typeId=${block.typeId} states=${JSON.stringify(allStates)}`,
    );
  } catch (err) {
    console.error(`[rsforge] debug_place_and_dump failed: ${String(err)}`);
  }
}

/**
 * Read a block at absolute coords and log its typeId + states.
 * Used by the selftest to verify built contraptions.
 *
 * Payload: "<x> <y> <z> [dim]"
 */
function debugBlockAt(message: string): void {
  const parts = message.trim().split(/\s+/);
  if (parts.length < 3) {
    console.error(`[rsforge] debug_blockat: expected "<x> <y> <z> [dim]"`);
    return;
  }
  const [xs, ys, zs, dimStr] = parts as [string, string, string, string?];
  const x = Number.parseInt(xs, 10);
  const y = Number.parseInt(ys, 10);
  const z = Number.parseInt(zs, 10);
  const dim = world.getDimension(dimStr ?? "minecraft:overworld");
  try {
    const block = dim.getBlock({ x, y, z });
    if (!block) {
      console.log(`[rsforge] debug_blockat: ${x},${y},${z} -> null (unloaded?)`);
      return;
    }
    const states = block.permutation.getAllStates();
    console.log(
      `[rsforge] debug_blockat: ${x},${y},${z} -> ${block.typeId} ${JSON.stringify(states)}`,
    );
  } catch (err) {
    console.error(`[rsforge] debug_blockat failed: ${String(err)}`);
  }
}
