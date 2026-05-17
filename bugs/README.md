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

## Open

- [`script-api-setblock-no-neighbor-redstone-update.md`](script-api-setblock-no-neighbor-redstone-update.md)
  — `Dimension.setBlockType` / `setBlockPermutation` placing or removing
  a power source next to existing redstone wire doesn't notify the wire
  to re-evaluate. Wire stays unpowered.
- [`script-api-lever-state-mutation-no-update.md`](script-api-lever-state-mutation-no-update.md)
  — Mutating a lever's `open_bit` via `block.permutation.withState(...)`
  + `setBlockPermutation` flips the state value but doesn't propagate
  power.
- [`script-api-lever-physics-drop-after-setblock.md`](script-api-lever-physics-drop-after-setblock.md)
  — Levers placed by `setBlockPermutation` are dropped by a scheduled
  physics update ~5 ticks later (no attached-to-block pointer).
- [`script-api-lamp-destroyed-on-transition.md`](script-api-lamp-destroyed-on-transition.md)
  — `redstone_lamp` placed by `setBlockPermutation` is destroyed
  (replaced with air) instead of transitioning to `lit_redstone_lamp`
  when adjacent wire becomes powered. Lamp placed by
  `runCommand("setblock ...")` transitions correctly.
- [`script-api-piston-no-power-response.md`](script-api-piston-no-power-response.md)
  — Piston placed via `runCommand("setblock ...")` lands correctly but
  doesn't respond when a `redstone_block` is then placed adjacent to it
  the same way. The piston never extends. A player placing the
  redstone_block by hand triggers extension immediately. **Most severe
  of the five for our project — it blocks automated testing of any
  piston-based contraption.**

All five almost certainly share a root cause: blocks introduced or
modified via the Script API's block-set methods, or even via
`Dimension.runCommand`, end up in a different state graph than the
same operations done from player actions, specifically with respect
to neighbour update notifications and physics-validity bookkeeping.
Fixing the underlying "make Script API placements participate in the
same update queues that player placements do" should clear most of
these reports at once.

## How to reproduce against this repo

Each bug report has a minimal self-contained repro. End-to-end:

1. Clone https://github.com/constructomech/minecraft-redstone-bot
2. `npm install`
3. `pwsh tools/bds-install.ps1` (or point at an existing BDS install —
   the harness reads `%LOCALAPPDATA%\RedstoneForge\bds`)
4. `pwsh tools/bds-run.ps1` once to generate the world; stop it
5. `npm run deploy`
6. `npm run selftest` — exercises the workarounds the project ships for
   these bugs and shows them in CI-style output with diagnostic
   `debug_blockat` dumps
