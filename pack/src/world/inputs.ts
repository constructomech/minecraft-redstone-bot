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
    case "lever":           return driveLever(dim, pos, value === "on");
    case "redstone_block":  return driveRedstoneBlock(dim, pos, value === "on");
    case "button":          return driveButton(dim, pos, value === "on");
    case "pressure_plate":  return drivePressurePlate(dim, pos, value === "on");
  }
}

function driveLever(dim: Dimension, pos: Vector3, on: boolean): void {
  const block = dim.getBlock(pos);
  if (!block) {
    throw new Error(`driveLever: block at ${pos.x},${pos.y},${pos.z} is null (chunk unloaded?)`);
  }
  if (block.typeId !== "minecraft:lever") {
    throw new Error(
      `driveLever: expected minecraft:lever at ${pos.x},${pos.y},${pos.z}, found ${block.typeId}`,
    );
  }
  const dir = String(block.permutation.getState("lever_direction") ?? "up_east_west");
  const cmd = `setblock ${pos.x} ${pos.y} ${pos.z} minecraft:lever ["lever_direction"="${dir}","open_bit"=${on ? "true" : "false"}]`;
  dim.runCommand(cmd);
}

function driveRedstoneBlock(dim: Dimension, pos: Vector3, on: boolean): void {
  const target = on ? "minecraft:redstone_block" : "minecraft:air";
  dim.runCommand(`setblock ${pos.x} ${pos.y} ${pos.z} ${target}`);
}

function driveButton(dim: Dimension, pos: Vector3, on: boolean): void {
  const block = dim.getBlock(pos);
  if (!block) {
    throw new Error(`driveButton: block at ${pos.x},${pos.y},${pos.z} is null (chunk unloaded?)`);
  }
  if (block.typeId !== "minecraft:wooden_button" && block.typeId !== "minecraft:stone_button") {
    throw new Error(
      `driveButton: expected a button at ${pos.x},${pos.y},${pos.z}, found ${block.typeId}`,
    );
  }
  // Preserve facing_direction so the button stays on the same wall.
  const facing = block.permutation.getState("facing_direction") ?? 0;
  const cmd = `setblock ${pos.x} ${pos.y} ${pos.z} ${block.typeId} ["facing_direction"=${facing},"button_pressed_bit"=${on ? "true" : "false"}]`;
  dim.runCommand(cmd);
}

function drivePressurePlate(dim: Dimension, pos: Vector3, on: boolean): void {
  const block = dim.getBlock(pos);
  if (!block) {
    throw new Error(`drivePressurePlate: block at ${pos.x},${pos.y},${pos.z} is null`);
  }
  if (block.typeId !== "minecraft:wooden_pressure_plate" && block.typeId !== "minecraft:stone_pressure_plate") {
    throw new Error(
      `drivePressurePlate: expected a pressure plate at ${pos.x},${pos.y},${pos.z}, found ${block.typeId}`,
    );
  }
  // Pressure plates output 15 when pressed, 0 when released.
  const signal = on ? 15 : 0;
  const cmd = `setblock ${pos.x} ${pos.y} ${pos.z} ${block.typeId} ["redstone_signal"=${signal}]`;
  dim.runCommand(cmd);
}
