---
name: pattern-library
description: Use before designing any contraption to check whether a vetted pattern already exists under patterns/ — index of all available sub-specs (T flip-flop, RS latch, D latch, 1-tick clock, slow clock, edge detector, half/full adder, 4-bit adder, decoder, memory cells), their ports, footprints, and composition rules via the spec's includes field. Composing patterns is almost always better than designing from scratch.
---

# pattern-library

What patterns exist, when to pick each, and how to compose them.

> Status: stub. Populates during Phase 6 as patterns/ fills in.

## Intended scope

- Index table: one row per pattern, with name, footprint (`[x,y,z]`),
  inputs (kind + count), outputs (kind + count), brief description.
- For each pattern, a one-page entry with:
  - Behavior contract (truth table or sequence diagram).
  - Default port placements relative to the pattern's local origin.
  - Variants and their trade-offs (e.g. fast vs compact T flip-flop).
  - Known tile-tick or pulse-width quirks.
- Composition rules: how to use `includes` in a ContraptionSpec to
  embed a pattern at a local offset, with rotation, and how to wire
  one pattern's output to another's input.
- "Combinational glue" patterns: NOT, AND, OR, XOR, MUX in a
  consistent style so that ad-hoc gate composition is mechanical.

## Heuristic

Before drafting a spec from scratch, ask:

1. Is the requested behavior a literal pattern (e.g. "T flip-flop",
   "edge detector", "4-bit adder")? → use it directly.
2. Is it a composition of 2–3 patterns (e.g. "counter on button
   press" = edge-detector → 4-bit adder + memory)? → compose via
   `includes`.
3. Is it genuinely novel? Load `designing-contraptions`.

Reusing a vetted pattern eliminates a class of bugs (rotation,
timing, port placement) for free.
