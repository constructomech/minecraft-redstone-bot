/**
 * Input drivers: mutate the world to "press" a port the test runner is
 * driving. Drivers are sync (mutations apply this tick); the runner is
 * responsible for following each set with a wait_ticks so propagation
 * has time to settle.
 *
 * IMPORTANT: programmatic Script API placement (setBlockType /
 * setBlockPermutation) does NOT reliably fire the neighbor-block-update
 * events that redstone propagation relies on. See:
 *   bugs/script-api-setblock-no-neighbor-redstone-update.md
 *   bugs/script-api-lever-state-mutation-no-update.md
 * The workaround in these drivers is `dimension.runCommand("setblock ...")`
 * which goes through the same path as a player-issued command and fires
 * updates correctly.
 */
import { type Dimension, type Vector3 } from "@minecraft/server";
import type { InputKind } from "../spec/schema.js";

export function driveInput(
  dim: Dimension,
  pos: Vector3,
  kind: InputKind,
  value: "on" | "off",
): void {
  switch (kind) {
    case "lever":          return driveLever(dim, pos, value === "on");
    case "redstone_block": return driveRedstoneBlock(dim, pos, value === "on");
  }
}

function driveLever(dim: Dimension, pos: Vector3, on: boolean): void {
  // Verify there's actually a lever here. If not, fail loud — the test
  // author probably has the wrong port position.
  const block = dim.getBlock(pos);
  if (!block) {
    throw new Error(`driveLever: block at ${pos.x},${pos.y},${pos.z} is null (chunk unloaded?)`);
  }
  if (block.typeId !== "minecraft:lever") {
    throw new Error(
      `driveLever: expected minecraft:lever at ${pos.x},${pos.y},${pos.z}, found ${block.typeId}`,
    );
  }
  // Carry the existing lever_direction across so we don't lose it.
  const dir = String(block.permutation.getState("lever_direction") ?? "up_east_west");
  // /setblock + state value list. Booleans are unquoted true/false.
  const cmd = `setblock ${pos.x} ${pos.y} ${pos.z} minecraft:lever ["lever_direction"="${dir}","open_bit"=${on ? "true" : "false"}]`;
  dim.runCommand(cmd);
}

function driveRedstoneBlock(dim: Dimension, pos: Vector3, on: boolean): void {
  // "on" = redstone block present (powering adjacent),
  // "off" = air at that position.
  const target = on ? "minecraft:redstone_block" : "minecraft:air";
  const cmd = `setblock ${pos.x} ${pos.y} ${pos.z} ${target}`;
  let successCount = 0;
  try {
    const r = dim.runCommand(cmd);
    successCount = r.successCount;
  } catch (err) {
    console.error(`[rsforge] driveRedstoneBlock '${cmd}' threw: ${String(err)}`);
    throw err;
  }
  // Immediate read-back so we can tell whether runCommand placed it or
  // lied about success. (See bugs/.)
  const after = dim.getBlock(pos);
  console.log(
    `[rsforge] driveRedstoneBlock '${cmd}' -> successCount=${successCount}, immediate read=${after?.typeId ?? "null"}`,
  );
}

