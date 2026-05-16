---
name: contraption-testing
description: Use when designing the tests array of a ContraptionSpec or writing tests for an existing build. Covers the test-step grammar (set, wait_ticks, expect), how to drive each input kind (lever, button, redstone-block, pressure plate), how to read each output kind (lamp, piston extension, comparator analog, observer pulse window), choosing wait_ticks for the signal to settle, detecting race conditions, and writing truth-table-style tests for combinational circuits vs sequence tests for stateful ones.
---

# contraption-testing

How to write the `tests` array of a ContraptionSpec so that "all green"
actually means "the contraption works."

> Status: stub. Fills in during Phase 4.

## Intended scope

- Test step grammar:
  - `{ "set": "<port>", "to": "on" | "off" | <analog 0-15> }`
  - `{ "wait_ticks": <n> }` — uses `system.runTimeout` inside the pack.
  - `{ "expect": { "<port>": "on" | "off" | <analog> } }`
- How each input is driven:
  - `lever`: state mutation (`open_bit`).
  - `button`: brief redstone-block placement adjacent, then removal —
    simulates a momentary press, configurable pulse width.
  - `pressure_plate`: entity spawn / despawn at the plate (or a
    transient block toggle for weighted plates).
  - `redstone_block` (analog input): place/break, or for analog use a
    pulsed comparator chain.
- How each output is read (cross-reference probes in `pack/src/test/probes.ts`):
  - `lamp`: block ID is `redstone_lamp` (off) or `lit_redstone_lamp` (on).
  - `piston`: head block at facing offset present + correct facing.
  - `comparator`: `output_signal` state value (0–15).
  - `observer`: sample over a small window; an observer pulse is 1 tick.
- Choosing `wait_ticks`:
  - 1 tick for a direct wire to lamp.
  - 2 ticks per repeater (default delay).
  - Add slack — undercounted ticks are the single most common test
    failure.
- Truth-table testing for combinational circuits: exhaustive over
  inputs when `inputs ≤ 4`, otherwise property-style sampling.
- Sequence testing for stateful circuits: cover reset → first
  transition → return to initial → second transition.

## Hard rules

- Every named port in `tests` must exist in `ports`.
- Every `expect` value must be in the value set for that port's kind.
- A test that "passes" because the pack accepted it without errors but
  reported zero assertions is **not** passing. The runner counts
  asserted steps.
