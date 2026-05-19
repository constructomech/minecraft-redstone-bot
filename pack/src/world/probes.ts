/**
 * Output probes: read the world to determine whether a named output
 * port is on/off (or analog, in the future).
 */
import type { Dimension, Vector3 } from "@minecraft/server";
import type { OutputKind, Binary } from "../spec/schema.js";

export function readOutput(
  dim: Dimension,
  pos: Vector3,
  kind: OutputKind,
): Binary {
  switch (kind) {
    case "lamp":   return readLamp(dim, pos);
    case "wire":   return readWire(dim, pos);
    case "piston": return readPiston(dim, pos);
  }
}

/**
 * Lamps in Bedrock are two block IDs:
 *   minecraft:redstone_lamp       -> unlit (off)
 *   minecraft:lit_redstone_lamp   -> lit   (on)
 *
 * NOTE: There's a Bedrock 1.26.21 bug where lamps placed via the
 * Script API get destroyed instead of transitioned when adjacent
 * wire becomes powered. See bugs/script-api-lamp-destroyed-on-transition.md.
 * For automated tests that need a binary signal indicator, prefer the
 * 'wire' output kind, which reads redstone_signal directly and is
 * unaffected by the transition bug.
 */
function readLamp(dim: Dimension, pos: Vector3): Binary {
  const block = dim.getBlock(pos);
  if (!block) return "off";
  if (block.typeId === "minecraft:lit_redstone_lamp") return "on";
  return "off";
}

/**
 * Read a redstone_wire's signal strength. "on" when signal > 0, "off"
 * otherwise. Useful as a binary indicator when the lamp transition
 * bug bites (see readLamp comment above).
 */
function readWire(dim: Dimension, pos: Vector3): Binary {
  const block = dim.getBlock(pos);
  if (!block) return "off";
  if (block.typeId !== "minecraft:redstone_wire") return "off";
  const signal = block.permutation.getState("redstone_signal");
  return typeof signal === "number" && signal > 0 ? "on" : "off";
}

/**
 * Read a piston's extension state. "on" when the piston has its head
 * extended (i.e. there's an arm_collision block adjacent to the piston
 * body), "off" otherwise.
 *
 * Implementation note: we used to interpret the piston's
 * `facing_direction` state to know which neighbour to look at, but
 * empirically the value Bedrock reports doesn't match its docs (and
 * differs depending on whether the piston was placed via setblock vs.
 * a real/simulated player). Robust path: check ALL 6 neighbours for
 * either piston_arm_collision (regular) or sticky_piston_arm_collision
 * (sticky). The head only ever appears in exactly one cell when
 * extended.
 */
function readPiston(dim: Dimension, pos: Vector3): Binary {
  const block = dim.getBlock(pos);
  if (!block) return "off";
  const isPiston = block.typeId === "minecraft:piston" || block.typeId === "minecraft:sticky_piston";
  if (!isPiston) return "off";
  const neighbours: Vector3[] = [
    { x: pos.x + 1, y: pos.y,     z: pos.z     },
    { x: pos.x - 1, y: pos.y,     z: pos.z     },
    { x: pos.x,     y: pos.y + 1, z: pos.z     },
    { x: pos.x,     y: pos.y - 1, z: pos.z     },
    { x: pos.x,     y: pos.y,     z: pos.z + 1 },
    { x: pos.x,     y: pos.y,     z: pos.z - 1 },
  ];
  for (const np of neighbours) {
    const nb = dim.getBlock(np);
    if (!nb) continue;
    if (nb.typeId === "minecraft:piston_arm_collision" ||
        nb.typeId === "minecraft:sticky_piston_arm_collision") {
      return "on";
    }
  }
  return "off";
}
