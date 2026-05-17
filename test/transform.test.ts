/**
 * Host-side unit tests for pack/src/world/transform.ts.
 *
 * Pure-data rotation math, no Minecraft. Runs via `node:test` so
 * `npm test` finishes in milliseconds.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  rotateAxis6,
  rotateCardinal,
  rotateDirectionInt,
  rotateFacingInt,
  rotateLeverMount,
  rotatePosition,
  rotateStates,
  rotateStateValue,
  rotateTorchMount,
  rotationForFacing,
  type RotationStep,
} from "../pack/src/world/transform.ts";

// ---------- rotationForFacing ----------

test("rotationForFacing: east is identity", () => {
  assert.equal(rotationForFacing("east"), 0);
});

test("rotationForFacing: south is 1 CW step", () => {
  assert.equal(rotationForFacing("south"), 1);
});

test("rotationForFacing: west is 180°", () => {
  assert.equal(rotationForFacing("west"), 2);
});

test("rotationForFacing: north is 3 CW steps", () => {
  assert.equal(rotationForFacing("north"), 3);
});

// ---------- rotatePosition: spec local +X must point in front of player ----------

test("rotatePosition: facing east is identity", () => {
  assert.deepEqual(rotatePosition([1, 0, 0], 0), [1, 0, 0]);
  assert.deepEqual(rotatePosition([5, 7, -3], 0), [5, 7, -3]);
});

test("rotatePosition: facing south maps +X to +Z", () => {
  // Player faces south (+Z). Spec local +X should land on world +Z.
  assert.deepEqual(rotatePosition([1, 0, 0], 1), [0, 0, 1]);
  assert.deepEqual(rotatePosition([2, 0, 0], 1), [0, 0, 2]);
});

test("rotatePosition: facing west maps +X to -X", () => {
  assert.deepEqual(rotatePosition([1, 0, 0], 2), [-1, 0, 0]);
  assert.deepEqual(rotatePosition([2, 0, 0], 2), [-2, 0, 0]);
});

test("rotatePosition: facing north maps +X to -Z", () => {
  assert.deepEqual(rotatePosition([1, 0, 0], 3), [0, 0, -1]);
  assert.deepEqual(rotatePosition([2, 0, 0], 3), [0, 0, -2]);
});

test("rotatePosition: 4 steps is identity (full revolution)", () => {
  for (const p of [[1, 2, 3], [-4, 0, 5], [7, -1, -2]]) {
    const v = p as [number, number, number];
    let r = v;
    for (let i = 0; i < 4; i++) r = rotatePosition(r, 1) as [number, number, number];
    assert.deepEqual(r, v);
  }
});

test("rotatePosition: Y is never modified", () => {
  for (let steps = 0 as RotationStep; steps < 4; steps = (steps + 1) as RotationStep) {
    assert.equal(rotatePosition([3, 42, -7], steps)[1], 42);
  }
});

// ---------- rotateCardinal: CW cycle ----------

test("rotateCardinal: north -> east -> south -> west -> north", () => {
  assert.equal(rotateCardinal("north", 1), "east");
  assert.equal(rotateCardinal("east", 1), "south");
  assert.equal(rotateCardinal("south", 1), "west");
  assert.equal(rotateCardinal("west", 1), "north");
});

test("rotateCardinal: 180° swaps opposites", () => {
  assert.equal(rotateCardinal("north", 2), "south");
  assert.equal(rotateCardinal("east", 2), "west");
  assert.equal(rotateCardinal("south", 2), "north");
  assert.equal(rotateCardinal("west", 2), "east");
});

test("rotateCardinal: 3 steps = 1 step CCW", () => {
  assert.equal(rotateCardinal("north", 3), "west");
  assert.equal(rotateCardinal("east", 3), "north");
});

test("rotateCardinal: 0 steps is identity", () => {
  for (const d of ["north", "south", "east", "west"] as const) {
    assert.equal(rotateCardinal(d, 0), d);
  }
});

// ---------- rotateAxis6: up/down invariant ----------

test("rotateAxis6: up and down never rotate", () => {
  for (let s = 0 as RotationStep; s < 4; s = (s + 1) as RotationStep) {
    assert.equal(rotateAxis6("up", s), "up");
    assert.equal(rotateAxis6("down", s), "down");
  }
});

test("rotateAxis6: cardinals follow rotateCardinal", () => {
  assert.equal(rotateAxis6("north", 1), "east");
  assert.equal(rotateAxis6("east", 2), "west");
});

// ---------- rotateTorchMount: top invariant ----------

test("rotateTorchMount: top never rotates", () => {
  for (let s = 0 as RotationStep; s < 4; s = (s + 1) as RotationStep) {
    assert.equal(rotateTorchMount("top", s), "top");
  }
});

test("rotateTorchMount: cardinals rotate normally", () => {
  assert.equal(rotateTorchMount("north", 1), "east");
  assert.equal(rotateTorchMount("south", 2), "north");
});

// ---------- rotateLeverMount ----------

test("rotateLeverMount: wall cardinals rotate", () => {
  assert.equal(rotateLeverMount("north", 1), "east");
  assert.equal(rotateLeverMount("south", 2), "north");
  assert.equal(rotateLeverMount("east", 3), "north");
});

test("rotateLeverMount: ceiling axis values swap on 90°/270°", () => {
  assert.equal(rotateLeverMount("up_north_south", 1), "up_east_west");
  assert.equal(rotateLeverMount("up_east_west", 1), "up_north_south");
  assert.equal(rotateLeverMount("up_north_south", 3), "up_east_west");
});

test("rotateLeverMount: ceiling axis values are 180° invariant", () => {
  assert.equal(rotateLeverMount("up_north_south", 2), "up_north_south");
  assert.equal(rotateLeverMount("up_east_west", 2), "up_east_west");
});

test("rotateLeverMount: floor axis values swap on 90°/270°", () => {
  assert.equal(rotateLeverMount("down_north_south", 1), "down_east_west");
  assert.equal(rotateLeverMount("down_east_west", 3), "down_north_south");
});

// ---------- rotateFacingInt (0–5) ----------

test("rotateFacingInt: down (0) and up (1) are invariant", () => {
  for (let s = 0 as RotationStep; s < 4; s = (s + 1) as RotationStep) {
    assert.equal(rotateFacingInt(0, s), 0);
    assert.equal(rotateFacingInt(1, s), 1);
  }
});

test("rotateFacingInt: 1 CW step rotates cardinals", () => {
  // 2=north, 5=east, 3=south, 4=west; CW cycle: 2→5→3→4→2
  assert.equal(rotateFacingInt(2, 1), 5);
  assert.equal(rotateFacingInt(5, 1), 3);
  assert.equal(rotateFacingInt(3, 1), 4);
  assert.equal(rotateFacingInt(4, 1), 2);
});

test("rotateFacingInt: 180° flips opposite cardinals", () => {
  assert.equal(rotateFacingInt(2, 2), 3); // north -> south
  assert.equal(rotateFacingInt(5, 2), 4); // east -> west
});

// ---------- rotateDirectionInt (0–3) ----------

test("rotateDirectionInt: CW cycle is n+steps mod 4", () => {
  // 0=south, 1=west, 2=north, 3=east
  assert.equal(rotateDirectionInt(2, 1), 3); // north -> east
  assert.equal(rotateDirectionInt(3, 1), 0); // east -> south
  assert.equal(rotateDirectionInt(0, 1), 1); // south -> west
  assert.equal(rotateDirectionInt(1, 1), 2); // west -> north
});

test("rotateDirectionInt: 4 steps is identity", () => {
  for (let v = 0; v < 4; v++) {
    let r = v;
    for (let i = 0; i < 4; i++) r = rotateDirectionInt(r, 1);
    assert.equal(r, v);
  }
});

test("rotateDirectionInt: out-of-range values pass through", () => {
  assert.equal(rotateDirectionInt(7, 1), 7);
  assert.equal(rotateDirectionInt(-1, 1), -1);
});

// ---------- rotateStateValue dispatcher ----------

test("rotateStateValue: dispatches by kind", () => {
  assert.equal(rotateStateValue("cardinal", "north", 1), "east");
  assert.equal(rotateStateValue("axis6", "up", 1), "up");
  assert.equal(rotateStateValue("torch_mount", "top", 2), "top");
  assert.equal(rotateStateValue("lever_mount", "up_north_south", 1), "up_east_west");
  assert.equal(rotateStateValue("facing_int", 2, 1), 5);
  assert.equal(rotateStateValue("direction_int", 2, 1), 3);
});

test("rotateStateValue: 0 steps is identity for any kind", () => {
  assert.equal(rotateStateValue("cardinal", "north", 0), "north");
  assert.equal(rotateStateValue("facing_int", 5, 0), 5);
});

test("rotateStateValue: type mismatches pass through", () => {
  // string value for int-kind, or vice versa, returns unchanged.
  assert.equal(rotateStateValue("cardinal", 42, 1), 42);
  assert.equal(rotateStateValue("facing_int", "north", 1), "north");
});

// ---------- rotateStates batch transform ----------

test("rotateStates: applies declared rotations and passes others through", () => {
  const states = {
    lever_direction: "north",
    open_bit: true,
    repeater_delay: 2,
  };
  const out = rotateStates(states, { lever_direction: "lever_mount" }, 1);
  assert.deepEqual(out, {
    lever_direction: "east",
    open_bit: true,
    repeater_delay: 2,
  });
});

test("rotateStates: with no rotations map, passes everything through", () => {
  const states = { x: 1, y: "north", z: false };
  const out = rotateStates(states, undefined, 1);
  assert.deepEqual(out, states);
  assert.notStrictEqual(out, states); // new object
});

test("rotateStates: 4 rotations of cardinal returns to original", () => {
  let s = { dir: "north" } as Record<string, string | number | boolean>;
  for (let i = 0; i < 4; i++) {
    s = rotateStates(s, { dir: "cardinal" }, 1);
  }
  assert.deepEqual(s, { dir: "north" });
});

// ---------- end-to-end: a 3-block "lever -> wire -> lamp" round trip ----------

test("end-to-end rotation: lever-wire-lamp positions across 4 facings", () => {
  const localPositions: Array<[number, number, number]> = [
    [0, 0, 0], // lever
    [1, 0, 0], // wire
    [2, 0, 0], // lamp
  ];
  // facing east: identity
  assert.deepEqual(localPositions.map((p) => rotatePosition(p, rotationForFacing("east"))), [
    [0, 0, 0], [1, 0, 0], [2, 0, 0],
  ]);
  // facing south: +X -> +Z
  assert.deepEqual(localPositions.map((p) => rotatePosition(p, rotationForFacing("south"))), [
    [0, 0, 0], [0, 0, 1], [0, 0, 2],
  ]);
  // facing west: +X -> -X
  assert.deepEqual(localPositions.map((p) => rotatePosition(p, rotationForFacing("west"))), [
    [0, 0, 0], [-1, 0, 0], [-2, 0, 0],
  ]);
  // facing north: +X -> -Z
  assert.deepEqual(localPositions.map((p) => rotatePosition(p, rotationForFacing("north"))), [
    [0, 0, 0], [0, 0, -1], [0, 0, -2],
  ]);
});
