/**
 * Input drivers: mutate the world to "press" a port the test runner is
 * driving. Async — the runner must `await driveInput` so propagation
 * has time to settle between steps.
 *
 * Two strategies:
 *
 *   1) For LEVER and BUTTON we use a transient SimulatedPlayer to
 *      right-click the block. A real interact() is the only reliable
 *      way to make a placed lever's signal propagate to adjacent
 *      wire/pistons — programmatic setblock toggling does NOT fire
 *      the neighbor-update events. See:
 *        bugs/script-api-lever-state-mutation-no-update.md
 *
 *   2) For REDSTONE_BLOCK we swap to air (off) or redstone_block (on)
 *      via dim.runCommand("setblock ..."). The /setblock command goes
 *      through the same path as a player-issued command and fires
 *      neighbor updates correctly.
 *
 *   3) PRESSURE_PLATE uses /setblock to mutate the redstone_signal
 *      state (no good simulated-player equivalent for "stand on a
 *      plate momentarily").
 */
import { type Dimension, type Vector3 } from "@minecraft/server";
import type { InputKind } from "../spec/schema.js";
import { simInteractWithBlock } from "./sim-player.js";

export async function driveInput(
  dim: Dimension,
  pos: Vector3,
  kind: InputKind,
  value: "on" | "off",
): Promise<void> {
  switch (kind) {
    case "lever":           return driveLever(dim, pos, value === "on");
    case "redstone_block":  return driveRedstoneBlock(dim, pos, value === "on");
    case "button":          return driveButton(dim, pos, value === "on");
    case "pressure_plate":  return drivePressurePlate(dim, pos, value === "on");
  }
}

async function driveLever(dim: Dimension, pos: Vector3, on: boolean): Promise<void> {
  const block = dim.getBlock(pos);
  if (!block) {
    throw new Error(`driveLever: block at ${pos.x},${pos.y},${pos.z} is null (chunk unloaded?)`);
  }
  if (block.typeId !== "minecraft:lever") {
    throw new Error(
      `driveLever: expected minecraft:lever at ${pos.x},${pos.y},${pos.z}, found ${block.typeId}`,
    );
  }
  // Interact toggles. Only click if current != desired.
  const currentlyOn = block.permutation.getState("open_bit") === true;
  if (currentlyOn === on) return;
  await simInteractWithBlock(dim, pos);
}

function driveRedstoneBlock(dim: Dimension, pos: Vector3, on: boolean): void {
  const target = on ? "minecraft:redstone_block" : "minecraft:air";
  dim.runCommand(`setblock ${pos.x} ${pos.y} ${pos.z} ${target}`);
}

async function driveButton(dim: Dimension, pos: Vector3, on: boolean): Promise<void> {
  const block = dim.getBlock(pos);
  if (!block) {
    throw new Error(`driveButton: block at ${pos.x},${pos.y},${pos.z} is null (chunk unloaded?)`);
  }
  if (block.typeId !== "minecraft:wooden_button" && block.typeId !== "minecraft:stone_button") {
    throw new Error(
      `driveButton: expected a button at ${pos.x},${pos.y},${pos.z}, found ${block.typeId}`,
    );
  }
  // Buttons are momentary: a single right-click presses + auto-releases.
  // "on" -> click it; "off" -> no-op (button will already be releasing).
  if (!on) return;
  await simInteractWithBlock(dim, pos);
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
