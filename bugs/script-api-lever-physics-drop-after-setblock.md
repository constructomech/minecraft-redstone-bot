# Lever placed via `setBlockPermutation` is dropped by a scheduled physics update ~5 ticks later

**Filed:** Redstone Forge project, 2026-05-16
**BDS:** 1.26.21.1 stable, Windows
**Script API:** `@minecraft/server@2.8.0-beta.1.26.21-stable`

## Summary

Placing a `minecraft:lever` via `Dimension.setBlockPermutation` with a
valid floor-mount `lever_direction` (e.g. `up_east_west`) and a real solid
support block directly below succeeds at the moment of placement — a
`getBlock(pos)` immediately after returns the lever — but a scheduled
physics update a few game ticks later drops the lever and replaces it with
air. No item entity drops in the world (this is BDS with no nearby
players); the lever silently vanishes.

A player placing the same lever on the same block via their inventory does
not see this drop.

## Minimal repro

```ts
import { world, BlockPermutation, system } from "@minecraft/server";

const overworld = world.getDimension("minecraft:overworld");
// Pre-conditions: chunk loaded via ticking area.

// Provide a solid floor for the lever.
overworld.setBlockType({ x: 4, y: 70, z: 4 }, "minecraft:stone");

// Place a floor-mount lever on top.
overworld.setBlockPermutation(
  { x: 4, y: 71, z: 4 },
  BlockPermutation.resolve("minecraft:lever", { lever_direction: "up_east_west" }),
);

// Immediately: lever is there.
console.log(`t=0: ${overworld.getBlock({ x: 4, y: 71, z: 4 })?.typeId}`);
// -> minecraft:lever

// After 1 tick: still there.
system.runTimeout(() => {
  console.log(`t=1: ${overworld.getBlock({ x: 4, y: 71, z: 4 })?.typeId}`);
  // -> minecraft:lever
}, 1);

// After 5 ticks: gone.
system.runTimeout(() => {
  console.log(`t=5: ${overworld.getBlock({ x: 4, y: 71, z: 4 })?.typeId}`);
  // -> minecraft:air
}, 5);
```

## Expected

The lever should remain in the world. It has valid floor support
(`up_east_west` mount + solid stone block directly below), exactly as a
player-placed lever would.

```
t=0: minecraft:lever
t=1: minecraft:lever
t=5: minecraft:lever
```

## Actual

```
t=0: minecraft:lever
t=1: minecraft:lever
t=5: minecraft:air
```

Same outcome with the support block placed first, then the lever (so the
support is already in the world at the moment the lever lands). Same
outcome whether the lever_direction is `up_east_west`, `up_north_south`,
`north`, `south`, `east`, or `west` (we did not exhaustively try every
mount but the symptom is consistent across the ones we tried).

Hypothesis: `setBlockPermutation` writes the block's state without
populating Bedrock's internal "attached_block" / mount-direction-target
pointer, so the next physics tick sees the lever as "no valid support" and
removes it. A player placing a lever populates that pointer through the
normal place-block path.

## What works

- A player placing a lever on the same block by hand.
- Placing the lever and then never letting any physics tick happen before
  reading it. (Not useful in practice.)

## Workaround

We have not landed a clean one. Likely candidates we haven't yet verified:

1. `dimension.runCommand("setblock 4 71 4 lever [...]")` — if the vanilla
   command goes through the proper place path that establishes attachment.
2. Avoid levers entirely in script-placed contraptions. We're using
   `redstone_block` (no attachment relationship) as a substitute input in
   our test harness — but that hits a separate bug, see
   `script-api-setblock-no-neighbor-redstone-update.md`.

## Why it matters for our project

We build redstone contraptions from a JSON spec. Many natural
contraptions include a lever as a player-toggleable input. With this bug,
levers placed by the builder live for ~5 ticks and then disappear, so any
test or interaction the user attempts on them fails silently.

In our final user-facing flow the user can stand on grass and run
`forge build`; the lever survives long enough to be visible and the user
can interact with it before physics drops it (since the grass below it
counts as valid support and the user's interaction re-establishes the
attached_block pointer). But in our headless test harness with the player
elsewhere in the world, the lever drops before the test runner gets a
chance to toggle it.

## Possibly related

- `script-api-lever-state-mutation-no-update.md` — programmatically
  flipping an existing lever's `open_bit` doesn't propagate.
- `script-api-setblock-no-neighbor-redstone-update.md` — programmatic
  block changes don't fire neighbor updates.

These three may all share a root cause: the Script API's
`setBlockPermutation` / `setBlockType` paths take a different code path
than vanilla world editing, and that path skips some of the bookkeeping
(neighbor updates, attached-block pointers) that other systems rely on.

## Update 2026-05-18: this bug NO LONGER REPRODUCES

Re-tested on BDS 1.26.21.1 (same version as the original report) with
the same setup — solid stone support, `up_east_west` floor-mount lever
placed via `setBlockPermutation`, no player anywhere in the world. The
lever survives indefinitely (verified at 5 ticks, 60+ ticks, and 100+
ticks). Re-tested in a fresh chunk (anchor at (50, 80, 50) with a
freshly-added `tickingarea`) — same result, lever does not drop.

Either Mojang fixed the underlying scheduled-physics-validity path
between the original filing and now, or our pipeline changes (use of
`runCommand` for adjacent components, sim-player click-driven inputs)
indirectly avoid whatever condition triggers the drop. Workaround in
the pack (use `setBlockPermutation` and don't worry about it) is now
correct without further intervention.

The selftest harness comment about "levers in mid-air get physics-
dropped" is now stale — re-enable the lever-driven test path in
selftest at the next opportunity.
