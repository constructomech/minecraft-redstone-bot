---
name: pattern-library
description: Use before designing any contraption to check whether a vetted pattern already exists under patterns/ — index of all available sub-specs (NOT gate, AND gate; eventually T flip-flop, RS latch, 1-tick clock, edge detector, half/full adder, decoder, memory cells), their ports, footprints, and composition rules via the spec's includes field. Composing patterns is almost always better than designing from scratch.
---

# pattern-library

What patterns exist, when to pick each, and how to compose them.

## Where patterns live

`patterns/<name>.json` — each is a complete `ContraptionSpec` you can
build standalone OR include from a larger spec via the `includes`
field (Phase 6 wiring; the file format is already settled).

The `forge.mjs` daemon's `GET /spec/<name>` endpoint resolves patterns
the same way it resolves specs, so a player can run:

```
/rsforge:build not-gate
```

to build any pattern at their location directly.

## Current catalog

### `not-gate` — single-input inverter

- **Ports:** `inputs.a` (`redstone_block`), `outputs.out` (`wire`)
- **Behavior:** out = NOT a. When a is on, out is off; when a is off,
  out is on (driven high by the torch).
- **Footprint:** `[3, 2, 1]` (3 wide, 2 tall, 1 deep)
- **Pattern:** input → wire → solid block with torch on its far side
  → wire as output. The torch inverts.
- **Default delay:** ~2 game ticks (1 redstone tick) for the torch
  inversion.

### `and-gate` — two-input AND

- **Ports:** `inputs.a` and `inputs.b` (both `redstone_block`),
  `outputs.out` (`wire`)
- **Behavior:** out = a AND b. On only when BOTH inputs are on.
- **Footprint:** `[5, 3, 2]`
- **Pattern:** two NOT gates feeding a wire-OR'd intermediate,
  then a third NOT to re-invert. AND = NOT(NOT a OR NOT b).
- **Default delay:** ~6 game ticks (3 torch inversions).

## Composition

Two ways to use a pattern:

**Standalone.** Build it directly to play with the logic:

```pwsh
node tools/forge.mjs build patterns/not-gate.json
```

or in-game:

```
/rsforge:build not-gate
```

**Composed.** Reference it from another spec via `includes` (Phase 6):

```jsonc
{
  "name": "two-input-or-with-led",
  "footprint": { "size": [10, 3, 5] },
  "anchor": "player-facing",
  "includes": [
    { "ref": "patterns/not-gate.json", "at": [0, 0, 0], "rename": { "a": "in_a", "out": "not_a" } },
    { "ref": "patterns/not-gate.json", "at": [0, 0, 3], "rename": { "a": "in_b", "out": "not_b" } },
    { "ref": "patterns/and-gate.json", "at": [4, 0, 1], "rename": { "a": "not_a", "b": "not_b" } }
    /* the and-gate's output is the OR of the two inputs (De Morgan) */
  ],
  "ports": {
    "inputs":  { "in_a": "passthrough", "in_b": "passthrough" },
    "outputs": { "out": "passthrough_from_and.out" }
  },
  "blocks": []
}
```

(That's the Phase 6 syntax sketch; for now compose by inlining the
patterns' blocks manually into a single spec.)

## When to pick which

Match the user's request against this decision tree:

| Request shape | Pattern |
| ------------- | ------- |
| "negate / invert / NOT this signal" | `not-gate` |
| "both inputs must be on" / "AND" | `and-gate` |
| "either input on" / "OR" | wire-OR'd output (no dedicated pattern — wire naturally ORs) |
| "exactly one input on" / "XOR" | compose: AND-NOT-OR — open issue, pattern not yet shipped |
| "toggle on each pulse" | `t-flip-flop` (not yet shipped) |
| "remember the last set/reset" | `rs-latch` (not yet shipped) |
| "delay this signal by N ticks" | repeater chain (no pattern needed) |
| "amplify a decaying signal" | repeater (no pattern needed) |
| "detect a block update" | observer (no pattern needed) |

## Heuristic

Before drafting a spec from scratch, ask in order:

1. Is the requested behavior a literal pattern (e.g. "AND gate")? →
   use it directly.
2. Is it a composition of 2-3 patterns? → compose; spec only the
   inter-pattern wiring.
3. Is it genuinely novel? → load `designing-contraptions` and design
   fresh, but check periodically as you draft whether sub-parts
   match patterns and could be substituted.

Reusing a vetted pattern eliminates a class of bugs (rotation,
timing, port placement) for free. It also produces shorter specs that
the user can read.

## Adding a new pattern

When you build something new that's clearly reusable:

1. Drop the spec at `patterns/<kebab-name>.json`.
2. Pick generic port names (`a`, `b`, `out`, `clk`, `q`, `qbar`) —
   avoid task-specific names like `lamp_pin`.
3. Make the spec self-supporting (include foundation blocks) so it
   builds correctly in mid-air.
4. Include a `tests` block that would FAIL if the pattern is wrong
   (truth table for combinational; sequence for sequential).
5. Add an entry to this skill's catalog above with ports, footprint,
   behavior, and pattern description.

The pattern is "vetted" once `npm run selftest` passes with it
included and a player has visually confirmed it works in-game.
