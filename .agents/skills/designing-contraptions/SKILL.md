---
name: designing-contraptions
description: Use at the start of any non-trivial contraption request — when the user has described what a circuit should do but no spec exists yet. Covers decomposition (identify inputs, outputs, behavior class: combinational vs sequential vs timed), topology choices, orientation/anchor selection, and how to pick between patterns from the library vs designing fresh.
---

# designing-contraptions

How to go from "build me a thing that does X" to a sketch concrete
enough to write a `ContraptionSpec` for.

> Status: stub. Fills in during Phase 5.

## Intended scope

- Decomposition checklist:
  1. **Inputs.** Kind (lever, button, pressure plate, redstone-block
     toggle) × count × where the user wants them.
  2. **Outputs.** Kind (lamp, piston, dispenser, comparator readout) ×
     count × where the user wants them.
  3. **Behavior class.** Combinational (output is a pure function of
     inputs), sequential (has memory; output depends on history), or
     timed (clock, pulse, delay-based).
  4. **State count.** For sequential: how many distinct internal states?
     Two → flip-flop; small N → counter; large N → consider hopper /
     comparator memory.
- Picking a topology:
  - Combinational: gate composition (NOT/AND/OR/XOR) → wire layout.
  - Sequential: latch family (RS, D, T) or counter.
  - Timed: repeater clock vs hopper clock vs observer loop.
- Orientation and footprint:
  - Default anchor is `player-facing`: `+x local` runs forward from the
    player. Place inputs near `x=0`, outputs near `x=footprint.x-1`,
    with logic in between.
  - Keep Y at 0 unless you genuinely need vertical layout; flat builds
    are easier to inspect.
- Reuse first:
  - Always check `patterns/` before designing. A composition of two
    known-good patterns is almost always better than a fresh design.
  - If 80% of the request matches an existing pattern, build on top
    of it via `includes` and only spec the delta.

## What to ask the user

If any of the four decomposition questions are ambiguous, ask **one**
focused question. Don't ask all four at once. Common ambiguities:

- Pulse vs latch ("button" alone is ambiguous — momentary or toggle?)
- Output kind ("a counter" — show the count how? lamps in binary?
  comparator on a container?)
- Reset behavior for sequential circuits
