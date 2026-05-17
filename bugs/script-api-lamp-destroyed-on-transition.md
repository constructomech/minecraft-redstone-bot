# Bedrock bug reports

Issues encountered while building this project that look like Bedrock or
Script API bugs (rather than my code). Each entry below is intended to be
self-contained: a minimal repro, expected vs actual behavior, the workaround
we ended up using, and any context about how broadly it bites.

Tested against:

- Bedrock Dedicated Server **1.26.21.1** (stable, Windows)
- `@minecraft/server` **2.8.0-beta.1.26.21-stable**
- `@minecraft/server-net` **1.0.0-beta.1.26.21-stable**
- `@minecraft/server-admin` **1.0.0-beta.1.26.21-stable**

## Open

- [`script-api-setblock-no-neighbor-redstone-update.md`](script-api-setblock-no-neighbor-redstone-update.md)
  — `Dimension.setBlockType` / `setBlockPermutation` placing or removing a
  power source next to an existing redstone wire doesn't notify the wire to
  re-evaluate its power. Wire stays unpowered even though a fully-formed
  power source landed adjacent to it.
- [`script-api-lever-state-mutation-no-update.md`](script-api-lever-state-mutation-no-update.md)
  — Mutating a lever's `open_bit` via `block.permutation.withState(...)` +
  `setBlockPermutation` flips the state value but doesn't propagate power.
  Lever shows `open_bit: true` but adjacent wire stays at
  `redstone_signal: 0`.
- [`script-api-lever-physics-drop-after-setblock.md`](script-api-lever-physics-drop-after-setblock.md)
  — A lever placed via `setBlockPermutation` with a valid floor-mount
  `lever_direction` and a real solid block directly below survives the
  immediate tick but is dropped by a scheduled physics update ~5 ticks
  later. A player placing the same lever on the same block doesn't see
  this.
- [`script-api-lamp-destroyed-on-transition.md`](script-api-lamp-destroyed-on-transition.md)
  — `redstone_lamp` placed via `setBlockPermutation` is destroyed (replaced
  with air) instead of transitioning to `lit_redstone_lamp` when adjacent
  wire becomes powered. Lamp placed by `runCommand("setblock ...")`
  transitions correctly.

All four are almost certainly the same root cause: blocks introduced or
modified via the Script API's direct block-set methods end up in a
different state graph than the same operations done via `runCommand` or
player actions, specifically with respect to neighbour update
notifications and physics-validity bookkeeping. Fixing the underlying
"fire the same updates that runCommand fires" should clear all four
reports at once.

## How to reproduce against this repo

Each bug report has a minimal self-contained repro. If you want to run them
end-to-end against the harness this project ships:

1. Clone https://github.com/constructomech/minecraft-redstone-bot
2. `npm install`
3. `pwsh tools/bds-install.ps1` (or point at an existing BDS install — the
   harness reads `%LOCALAPPDATA%\RedstoneForge\bds`)
4. `pwsh tools/bds-run.ps1` once to generate the world; stop it
5. `npm run deploy`
6. `npm run selftest` — this exercises the workarounds the project ships
   for these bugs and shows them in CI-style output with diagnostic
   `debug_blockat` dumps
