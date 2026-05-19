# Bedrock bug reports

Issues encountered while building this project that look like Bedrock or
Script API bugs. Each entry is intended to be self-contained: minimal
repro, expected vs actual, the workaround we ended up using, and any
context about how broadly it bites.

Tested against:

- Bedrock Dedicated Server **1.26.21.1** (stable, Windows)
- `@minecraft/server` **2.8.0-beta.1.26.21-stable**
- `@minecraft/server-net` **1.0.0-beta.1.26.21-stable**
- `@minecraft/server-admin` **1.0.0-beta.1.26.21-stable**
- `@minecraft/server-gametest` **1.0.0-beta.1.26.21-stable**

## Open

- [`script-api-lever-state-mutation-no-update.md`](script-api-lever-state-mutation-no-update.md)
  — Mutating an existing lever's `open_bit` via
  `block.permutation.withState(...)` + `setBlockPermutation` flips the
  stored state but does not fire neighbour updates. Adjacent wire stays
  at `redstone_signal: 0`; adjacent lamp stays unlit. Workaround: use a
  `SimulatedPlayer.interact()` click instead — the click goes through
  the engine's player-action path and propagates correctly.
- [`script-api-piston-no-power-response.md`](script-api-piston-no-power-response.md)
  — Pistons placed via `runCommand setblock` (or `setBlockPermutation`)
  never extend, regardless of how the adjacent power source was placed.
  Workaround: have a `SimulatedPlayer` break the piston and place a
  fresh one via `useItemOnBlock`; the resulting piston is correctly
  registered in the redstone update graph and tracks power changes from
  the adjacent runCommand-placed source. **Most severe of the two for
  this project — drives the post-placement "kick pistons" pass in
  `executeBuild`.**

## Closed (no longer reproduce on BDS 1.26.21.1)

Three earlier reports filed against the same BDS version no longer
reproduce when re-tested with the current pack. The repros from those
reports were re-run from scratch on 2026-05-19 with the world cleaned
between trials; the bugs are gone.

- ~~`script-api-setblock-no-neighbor-redstone-update.md`~~ — placing
  redstone power sources via `setBlockType` or `setBlockPermutation`
  adjacent to existing wire now correctly fires the wire's update
  evaluation. Wire goes to `redstone_signal: 15` as a player placement
  would.
- ~~`script-api-lever-physics-drop-after-setblock.md`~~ — levers placed
  via `setBlockPermutation` on a valid floor support survive
  indefinitely (verified at 100+ ticks in a fresh chunk with no players
  loaded). The original "drops after ~5 ticks" symptom is gone.
- ~~`script-api-lamp-destroyed-on-transition.md`~~ — `redstone_lamp`
  placed via `setBlockPermutation` correctly transitions to
  `lit_redstone_lamp` when an adjacent wire becomes powered. The
  original "destroyed instead of transitioning" symptom is gone.

Mojang either fixed these between filing and the re-verification window
or the original repros had a confounding factor we didn't isolate. In
either case the pack's workarounds for these three are now unnecessary,
though we haven't yet removed the `runCommand`-based placement paths
in `pack/src/world/builder.ts` that exist to work around them.

The remaining two open bugs are about a different code path
(propagation from already-placed source whose state mutates rather than
from a new placement), and that gap still appears genuine.

## How to reproduce against this repo

Each open bug report has a minimal self-contained repro. End-to-end:

1. Clone https://github.com/constructomech/minecraft-redstone-bot
2. `npm install`
3. `pwsh tools/bds-install.ps1` (or point at an existing BDS install —
   the harness reads `%LOCALAPPDATA%\RedstoneForge\bds`)
4. `pwsh tools/bds-run.ps1` once to generate the world; stop it
5. `npm run deploy`
6. `npm run selftest` — exercises the workarounds the project ships for
   these bugs and shows them in CI-style output with diagnostic
   `debug_blockat` dumps
