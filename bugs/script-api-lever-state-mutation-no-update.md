# Mutating `lever.open_bit` via `block.permutation.withState(...)` + `setBlockPermutation` doesn't trigger redstone propagation

**Filed:** Redstone Forge project, 2026-05-16
**BDS:** 1.26.21.1 stable, Windows
**Script API:** `@minecraft/server@2.8.0-beta.1.26.21-stable`

## Summary

Calling `block.permutation.withState("open_bit", true)` on a placed
`minecraft:lever` and applying the result via `Dimension.setBlockPermutation`
updates the lever's stored state value to `open_bit: true` but does NOT cause
adjacent redstone components to see the lever as powered. Adjacent wire stays
at `redstone_signal: 0`; adjacent lamps stay unlit.

Toggling the lever by hand (player right-click) on the same lever block
*does* fire propagation correctly.

## Minimal repro

```ts
import { world, system } from "@minecraft/server";

const overworld = world.getDimension("minecraft:overworld");

// Pre-conditions: chunk loaded via ticking area.
// Self-supporting circuit: stone foundation, lever, wire, lamp.
overworld.setBlockType({ x: 4, y: 70, z: 4 }, "minecraft:stone");
overworld.setBlockType({ x: 5, y: 70, z: 4 }, "minecraft:stone");
overworld.setBlockType({ x: 6, y: 70, z: 4 }, "minecraft:stone");

// Place a floor-mount lever on top of the foundation. up_east_west.
import { BlockPermutation } from "@minecraft/server";
overworld.setBlockPermutation(
  { x: 4, y: 71, z: 4 },
  BlockPermutation.resolve("minecraft:lever", { lever_direction: "up_east_west" }),
);
overworld.setBlockType({ x: 5, y: 71, z: 4 }, "minecraft:redstone_wire");
overworld.setBlockType({ x: 6, y: 71, z: 4 }, "minecraft:redstone_lamp");

// Wait one tick so the world settles, then flip the lever on.
system.runTimeout(() => {
  const lever = overworld.getBlock({ x: 4, y: 71, z: 4 });
  if (!lever) return;
  const newPerm = lever.permutation.withState("open_bit", true);
  overworld.setBlockPermutation({ x: 4, y: 71, z: 4 }, newPerm);

  // Wait 4 more ticks for propagation, then dump state.
  system.runTimeout(() => {
    const l = overworld.getBlock({ x: 4, y: 71, z: 4 });
    const w = overworld.getBlock({ x: 5, y: 71, z: 4 });
    const lp = overworld.getBlock({ x: 6, y: 71, z: 4 });
    console.log(`lever: ${l?.typeId} states=${JSON.stringify(l?.permutation.getAllStates())}`);
    console.log(`wire:  ${w?.typeId} signal=${w?.permutation.getState("redstone_signal")}`);
    console.log(`lamp:  ${lp?.typeId}`);
  }, 4);
}, 2);
```

## Expected

```
lever: minecraft:lever states={"lever_direction":"up_east_west","open_bit":true}
wire:  minecraft:redstone_wire signal=15
lamp:  minecraft:lit_redstone_lamp
```

## Actual

```
lever: minecraft:lever states={"lever_direction":"up_east_west","open_bit":true}
wire:  minecraft:redstone_wire signal=0
lamp:  minecraft:redstone_lamp
```

The lever's `open_bit` is correctly updated to `true`, but it apparently
doesn't count as a "power source" event in Bedrock's redstone simulation.
The adjacent wire never sees a power update; the lamp never lights.

## What works

- Right-clicking the same lever in-game (player interaction) does propagate
  power normally.
- Manually-placing a `minecraft:redstone_block` is what we tried as a
  workaround for inputs, but that hits a sibling bug — see
  `script-api-setblock-no-neighbor-redstone-update.md`.

## Workaround

Use `SimulatedPlayer.interact()` (from `@minecraft/server-gametest`)
to right-click the lever instead of mutating its state from a script.
A simulated player click goes through the same engine code path as a
real player's right-click, and adjacent components see the lever as
powered correctly.

`pack/src/world/sim-player.ts:simInteractWithBlock` is the helper used
by the test runner's `driveLever` to drive the lever between test
steps. It spawns a transient `SimulatedPlayer`, has it click the lever
once if its current `open_bit` differs from the desired value, then
removes the player. ~6 ticks per click.

## Why it matters for our project

Our test runner declares `tests: [{ steps: [{ set: {a: "on"} }, ...] }]`. The
agent uses these to verify combinational circuits — toggle each input through
the truth table, check the output after each step. With this bug, "lever"
inputs are unusable for automated testing because state changes don't
propagate.

## Possibly related

- ~~`script-api-setblock-no-neighbor-redstone-update.md`~~ — same pattern
  was suspected (programmatic Script API mutation that should fire
  neighbor block updates doesn't), but as of 2026-05-19 re-verification
  setBlockType / setBlockPermutation for a NEW block placement DO fire
  neighbor updates correctly. The remaining gap is specifically about
  *mutating an existing block's state*, which this report is about.
