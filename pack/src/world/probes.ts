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
 * extended (i.e. there's a piston_arm_collision block at the facing
 * offset), "off" otherwise.
 *
 * facing_direction conventions (Bedrock):
 *   0 = down  (head at pos.y-1)
 *   1 = up    (head at pos.y+1)
 *   2 = north (head at pos.z-1)
 *   3 = south (head at pos.z+1)
 *   4 = west  (head at pos.x-1)
 *   5 = east  (head at pos.x+1)
 */
function readPiston(dim: Dimension, pos: Vector3): Binary {
  const block = dim.getBlock(pos);
  if (!block) return "off";
  const isPiston = block.typeId === "minecraft:piston" || block.typeId === "minecraft:sticky_piston";
  if (!isPiston) return "off";
  const facing = block.permutation.getState("facing_direction");
  if (typeof facing !== "number") return "off";
  const headPos: Vector3 = { ...pos };
  switch (facing) {
    case 0: headPos.y -= 1; break;
    case 1: headPos.y += 1; break;
    case 2: headPos.z -= 1; break;
    case 3: headPos.z += 1; break;
    case 4: headPos.x -= 1; break;
    case 5: headPos.x += 1; break;
    default: return "off";
  }
  const head = dim.getBlock(headPos);
  if (!head) return "off";
  return head.typeId === "minecraft:piston_arm_collision" ? "on" : "off";
}
