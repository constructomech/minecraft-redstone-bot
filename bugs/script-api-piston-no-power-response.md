# Piston placed via `runCommand("setblock ...")` doesn't respond to adjacent power placed the same way

**Filed:** Redstone Forge project, 2026-05-17
**BDS:** 1.26.21.1 stable, Windows
**Script API:** `@minecraft/server@2.8.0-beta.1.26.21-stable`

## Summary

A `minecraft:piston` placed via `Dimension.runCommand("setblock x y z minecraft:piston [\"facing_direction\"=5]")` lands correctly in the world with the right state. A `minecraft:redstone_block` then placed via `runCommand("setblock x y z minecraft:redstone_block")` directly adjacent to the piston ALSO lands correctly. But the piston does not extend, even after waiting 6+ game ticks for propagation. The expected `minecraft:piston_arm_collision` block at the piston's facing offset is air.

A player placing the same redstone_block next to the same piston by hand triggers extension immediately.

## Minimal repro

```ts
import { world, system } from "@minecraft/server";

const ow = world.getDimension("minecraft:overworld");

// Ticking area near spawn keeps chunks loaded.
// Self-supporting circuit at y=80..81.
ow.runCommand("setblock 20 79 20 minecraft:stone");
ow.runCommand("setblock 21 79 20 minecraft:stone");

// Piston facing east. Head should land at (22, 81, 20) when powered.
ow.runCommand('setblock 21 81 20 minecraft:piston ["facing_direction"=5]');

// Power source on the west face of the piston.
system.runTimeout(() => {
  ow.runCommand("setblock 20 81 20 minecraft:redstone_block");

  // Wait 6 ticks for propagation.
  system.runTimeout(() => {
    const piston = ow.getBlock({ x: 21, y: 81, z: 20 });
    const head   = ow.getBlock({ x: 22, y: 81, z: 20 });
    console.log(`piston: ${piston?.typeId} states=${JSON.stringify(piston?.permutation.getAllStates())}`);
    console.log(`head:   ${head?.typeId}`);
  }, 6);
}, 2);
```

## Expected

```
piston: minecraft:piston states={"facing_direction":5}
head:   minecraft:piston_arm_collision
```

## Actual

```
piston: minecraft:piston states={"facing_direction":5}
head:   minecraft:air
```

The piston is placed correctly. The redstone_block is placed correctly and adjacent. But the piston never extends.

## What works

- A player placing the redstone_block manually.
- A player flipping a lever wired up to the piston.
- (Plausibly) firing a `minecraft:piston_arm_collision` placement via runCommand directly, though that bypasses the actual mechanic.

## Workaround

We have not found one. The pattern of "use runCommand instead of
setBlockPermutation to force vanilla update propagation" works for
redstone wires (the wire's `redstone_signal` correctly transitions),
but does NOT work for piston extension. The piston's mechanical
state seems to live behind a different update queue.

In Redstone Forge we now ship the `piston` output kind (the probe
correctly reads `piston_arm_collision` at the facing offset when a
real player triggers the piston) but the automated test harness
can't drive a piston via `redstone_block` toggling. We document this
in the `contraption-testing` skill and recommend reserving piston
tests for player-driven verification until this is resolved.

## Why it matters for our project

The agent needs to design and validate piston-based contraptions
(doors, secret entrances, combination locks, BUD circuits). With
this bug, every piston design has to be hand-verified by a player —
which is exactly the slow human-in-the-loop the test runner was
meant to eliminate.

## Possibly related

Almost certainly part of the same family as the other four open
Script API placement bugs (see `README.md`). The common theme is
that programmatic placement establishes a block in the world's
storage but doesn't fully integrate it with the engine's redstone
/ physics / update graphs.
