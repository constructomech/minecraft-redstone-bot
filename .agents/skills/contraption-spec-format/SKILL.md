---
name: contraption-spec-format
description: Use when authoring, editing, or validating a ContraptionSpec JSON — the canonical format for describing a Redstone Forge contraption (blocks, ports, tests, rotation). Covers schema fields (name, footprint, anchor, blocks, ports, tests, includes), local-vs-absolute coordinates, the player-facing rotation semantics, block-state shape, validation rules, and how the spec is consumed by POST /build and POST /test.
---

# contraption-spec-format

The schema for `ContraptionSpec` JSON — the durable artifact that drives
every build.

> Status: stub. Fills in during Phase 3.

## Intended scope

- The full JSON schema: every field, type, default, and validation rule.
- Coordinate system: local (spec-relative, `[x,y,z]`) vs absolute
  (world coordinates). When to use each.
- Anchor modes:
  - `"player-facing"` (default) — `+x local` aligns with the direction
    the player faced when they set the anchor; rotated about Y.
  - `"absolute"` — explicit world coordinates; only when the user
    explicitly says so.
  - `"named"` — reference a stored anchor by name (future).
- Block-state shape: state-key → value. Reference
  `redstone-components-reference` for the allowed keys per block.
- Rotation of directional block states: how `repeater.direction`,
  `observer.facing_direction`, `lever.lever_direction`, etc. transform
  under the four cardinal rotations. The pack's `world/transform.ts`
  is the source of truth.
- `ports`: named `inputs` and `outputs` with positions and kinds.
  Ports are how tests address inputs to drive and outputs to read.
- `tests`: an array of named test cases, each a sequence of `set`,
  `wait_ticks`, and `expect` steps.
- `includes`: composing patterns. A spec can include sub-specs from
  `patterns/` at an offset (Phase 6).
- Validation: what `node tools/forge.ts validate <spec>` enforces.
  Includes block-ID allowlisting against
  `pack/src/spec/components.ts`, port-kind/output-kind consistency,
  footprint coverage of every block, and well-formed test steps.

## Worked example

(Filled in during Phase 3 with a real T flip-flop spec.)

## Hard rules

- Block IDs in `blocks[].id` MUST appear in
  `pack/src/spec/components.ts`. Validation rejects unknown IDs.
- Block-state keys MUST be ones the components table exposes for that
  block. No invented states.
- Footprint must enclose every block's position. The pack uses the
  footprint for snapshot/undo bounds.
