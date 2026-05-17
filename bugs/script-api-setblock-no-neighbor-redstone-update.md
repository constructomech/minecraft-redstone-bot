# `Dimension.setBlockType` / `setBlockPermutation` doesn't notify adjacent redstone wire of a new power source

**Filed:** Redstone Forge project, 2026-05-16
**BDS:** 1.26.21.1 stable, Windows
**Script API:** `@minecraft/server@2.8.0-beta.1.26.21-stable`

## Summary

Placing a `minecraft:redstone_block` next to an existing `minecraft:redstone_wire`
via the Script API does **not** cause the wire to re-evaluate its power
state. The redstone block is fully present (verified via `getBlock(...).typeId`)
and the wire is fully present with a valid solid support beneath it, but the
wire stays at `redstone_signal: 0` for at least 4 game ticks afterward.

The equivalent player action (place a redstone block from the inventory next
to a wire) immediately powers the wire.

## Minimal repro

```ts
import { world, BlockPermutation, system } from "@minecraft/server";

const overworld = world.getDimension("minecraft:overworld");

// Pre-conditions: chunk (0..15, 0..15) is loaded via a ticking area.
// Lay down a 3-block self-supporting circuit at y=70 / 71.
overworld.setBlockType({ x: 4, y: 70, z: 4 }, "minecraft:stone");
overworld.setBlockType({ x: 5, y: 70, z: 4 }, "minecraft:stone");
overworld.setBlockType({ x: 6, y: 70, z: 4 }, "minecraft:stone");

overworld.setBlockType({ x: 5, y: 71, z: 4 }, "minecraft:redstone_wire");
overworld.setBlockType({ x: 6, y: 71, z: 4 }, "minecraft:redstone_lamp");

// Now place a redstone block adjacent to the wire.
overworld.setBlockType({ x: 4, y: 71, z: 4 }, "minecraft:redstone_block");

// Wait 4 game ticks for propagation.
system.runTimeout(() => {
  const wire = overworld.getBlock({ x: 5, y: 71, z: 4 });
  const lamp = overworld.getBlock({ x: 6, y: 71, z: 4 });
  console.log(`wire: ${wire?.typeId} signal=${wire?.permutation.getState("redstone_signal")}`);
  console.log(`lamp: ${lamp?.typeId}`);
}, 4);
```

## Expected

```
wire: minecraft:redstone_wire signal=15
lamp: minecraft:lit_redstone_lamp
```

## Actual

```
wire: minecraft:redstone_wire signal=0
lamp: minecraft:redstone_lamp
```

The wire's `redstone_signal` state remains at 0 indefinitely even though it
has a power source directly adjacent. Confirmed by `debug_blockat` dumps in
the project's selftest harness.

`setBlockPermutation` (with `BlockPermutation.resolve("minecraft:redstone_block")`)
shows the same behaviour as `setBlockType`. Both APIs apparently bypass the
neighbor-update path that vanilla placement uses.

## What works

- **Vanilla `/setblock` via `dimension.runCommand("setblock 4 71 4 redstone_block")`**
  appears to fire neighbor updates correctly (haven't verified end-to-end in
  this project yet, but it's our planned workaround).
- A player placing the redstone block from their inventory works correctly.
- Building the spec from scratch (placing all blocks for the first time)
  works because the wire happens to be placed *after* the redstone block and
  picks up power on placement.

## Workaround

Use `dimension.runCommand("setblock x y z redstone_block")` instead of
`setBlockType` whenever placing a block that needs to trigger redstone
propagation. Costly (string formatting + command parsing) but reliable.

## Why it matters for our project

We build redstone contraptions programmatically from a JSON spec and run
automated tests that toggle inputs and probe outputs. The test runner
toggles a `redstone_block` input on/off between test steps; the spec
declares the expected output state after each toggle. With this bug, every
"on" step fails because the wire never sees the power source even though
it's placed. The project's `npm run selftest` shows the failure:

```
step 5: expected out=on, observed out=off
--- post-test diagnostic ---
input @ 4,71,4: minecraft:redstone_block {}
wire  @ 5,71,4: minecraft:redstone_wire {"redstone_signal":0}
lamp  @ 6,71,4: minecraft:redstone_lamp {}
```

## Possibly the same root cause as

- `script-api-lever-state-mutation-no-update.md` — mutating an existing
  power source's state via `withState(...)` also doesn't trigger neighbor
  re-evaluation.
- `script-api-lever-physics-drop-after-setblock.md` — may also be related
  if "no scheduled update fired" extends to physics-validity checks.
