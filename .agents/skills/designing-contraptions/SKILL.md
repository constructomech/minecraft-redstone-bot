---
name: designing-contraptions
description: Use at the start of any non-trivial contraption request — when the user has described what a circuit should do but no spec exists yet. Covers decomposition (identify inputs, outputs, behavior class: combinational vs sequential vs timed), topology choices, orientation/anchor selection, and how to pick between patterns from patterns/ vs designing fresh.
---

# designing-contraptions

How to go from "build me a thing that does X" to a concrete
`ContraptionSpec`.

## Step 1: Decomposition

Always answer these four questions BEFORE drafting any spec. If any of
them is ambiguous in the user's request, ask one focused question.

**1. Inputs.** What kind, and how many?

| User says | Likely port kind |
| --------- | ---------------- |
| "a button" | `button` (auto-release pulse) — but note button input is unreliable in the harness; use `redstone_block` for tests |
| "a switch" / "a toggle" / "a lever" | `lever` — works for human use, broken in harness |
| "a sensor" / "step on" | `pressure_plate` |
| "always on" / "constant signal" / "always powered" | `redstone_block` (no toggle; just on) |

Default to `redstone_block` for testable inputs and `lever` /
`button` for human UX. Use both kinds in the same spec if needed
(test path uses one; player path uses the other).

**2. Outputs.** What kind, and how many?

| User says | Likely port kind |
| --------- | ---------------- |
| "a lamp" / "indicator" / "light up" | `lamp` (binary, off/on) |
| "raw signal" / "for further wiring" | `wire` (binary; bypasses the lamp transition bug) |
| "moving part" / "door" / "trapdoor" | `piston` (head extends/retracts) |

For tests, prefer `wire` outputs — the lamp transition bug
(bugs/script-api-lamp-destroyed-on-transition.md) makes lamp tests
unreliable in the harness. Pistons currently can't be driven
automatically (bugs/script-api-piston-no-power-response.md) — use
`piston` outputs for player-driven verification, not test-runner.

**3. Behavior class.** Three categories matter:

| Class | Telltale | Topology |
| ----- | -------- | -------- |
| **Combinational** | Output is a pure function of current inputs | gate composition (AND/OR/NOT/XOR via torches + wire) |
| **Sequential** | Output depends on history (latches, flip-flops, counters) | RS / D / T latch families |
| **Timed** | Pulses, clocks, delays | repeater clocks, observer loops |

Combinational gets a truth-table test. Sequential gets a sequence
test (reset → first input → check → second input → check). Timed gets
a pulse-pattern test.

**4. State count.** For sequential circuits, how many distinct internal
states does the user need?

- 2 states → flip-flop (T or D or RS)
- Small N (4-16) → counter built from flip-flops, or a single tape
- Large N → consider hopper-comparator memory (analog 0-15) or
  composing multiple smaller cells

## Step 2: Reuse vs fresh

ALWAYS check `patterns/` first. The library is curated and tested.
Composing two known-good patterns beats designing from scratch.

| Request shape | Probably reuse |
| ------------- | -------------- |
| "AND two inputs" | `patterns/and-gate.json` |
| "invert a signal" | `patterns/not-gate.json` |
| "toggle on each button press" | `patterns/t-flip-flop.json` (when shipped) |
| "remember which of two inputs fired" | `patterns/rs-latch.json` (when shipped) |
| "count button presses" | edge-detector → adder → memory; compose from patterns |

If 80% of the request matches an existing pattern, build on top of it
via the spec's `includes` field (Phase 6) and only spec the delta.

## Step 3: Orientation and footprint

- Default anchor mode: `player-facing`. The spec's local +X axis maps
  to "in front of the player." That makes the contraption land
  intuitively wherever the player ran `/rsforge:anchor`.
- Place inputs at low x (near the player), outputs at high x (away
  from the player). Wire goes between.
- Keep `y=0` flush with the anchor; use `y=1` for blocks above the
  ground level (lever on stone, wire on stone, etc.). The anchor lands
  at the air block at the player's feet, so a spec putting visible
  blocks at y=0 lands at the player's chin height — usually fine for
  flat circuits but use `y=1` if you want the contraption to sit on
  whatever block the player was standing on.
- Footprint should be the tightest bounding box enclosing all spec
  blocks. The validator enforces this.

## Step 4: Drafting

Once you have inputs/outputs/behavior decided, write the spec by:

1. Importing valid block IDs from `redstone-components-reference`.
2. Setting any directional states explicitly — defaults are sometimes
   wrong (lever defaults to upside-down ceiling mount; torch defaults
   to `unknown` mount). See "Default-state footguns" in
   `redstone-components-reference`.
3. Adding `ports.inputs` and `ports.outputs` AFTER you've laid out the
   blocks, so port positions are concrete.
4. Adding `tests` after ports: a truth table or sequence test that
   would FAIL if the circuit is wrong.
5. Local validation: any value of `node tools/forge.mjs build` will
   surface a validator error before the spec hits the world.

## Step 5: Saving

Successful specs go in `specs/` with a deterministic kebab-case name:
`specs/lever-wire-lamp.json`, `specs/and-gate.json`, etc. Patterns
(intended for reuse via `includes`) go in `patterns/`.

## Common decomposition examples

**"A door that opens with a button on each side."** Inputs: 2 buttons
(or `redstone_block` toggles for harness). Output: piston extension
state. Behavior: combinational OR of the two inputs → piston.
Footprint: 3-4 wide, 3-4 tall, deep enough for the door + pistons.
Pattern: OR-gate driving a piston pair.

**"A 4-digit binary counter."** Inputs: 1 clock or button (edge
detector trigger). Output: 4 lamps showing the binary digits. Behavior:
sequential, 16 states. Composition: edge-detector → 4 chained T
flip-flops (each one's output triggers the next).

**"A combination lock."** Inputs: 4 buttons in sequence. Output: 1
lamp / door. Behavior: sequential, must match a specific input order.
Composition: 4 single-bit memory cells with cross-validation logic.

For anything more complex than two patterns, ask the user to clarify
the EXACT behaviour they want before designing.
