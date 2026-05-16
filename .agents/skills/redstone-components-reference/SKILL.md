---
name: redstone-components-reference
description: Use when you need the exact Minecraft Bedrock block ID, allowed block-state keys, and allowed state values for a redstone component you intend to place in a ContraptionSpec. Covers the components Redstone Forge supports (wire, repeater, comparator, lever, button, pressure plate, observer, piston, sticky piston, redstone block, redstone torch, redstone lamp, plus filler blocks) with their facing/orientation semantics and rotation transforms. The authoritative table is pack/src/spec/components.ts; this skill explains it.
---

# redstone-components-reference

What blocks Redstone Forge supports, how to address them in a spec, and
what their state keys mean.

> Status: stub. Fills in during Phase 3 alongside
> `pack/src/spec/components.ts`, which is the runtime authority.

## Intended scope

For each supported block: the Bedrock ID, the allowed block-state
keys + values, the facing semantics (which way "forward" points), the
rotation transform under each cardinal rotation, and any "gotchas" the
agent has been burned by.

Planned coverage:

- `minecraft:redstone_wire`
- `minecraft:repeater` / `minecraft:unpowered_repeater` /
  `minecraft:powered_repeater`
- `minecraft:comparator` / `minecraft:unpowered_comparator` /
  `minecraft:powered_comparator`
- `minecraft:lever`
- Buttons: `minecraft:wooden_button`, `minecraft:stone_button`
- Pressure plates: `minecraft:wooden_pressure_plate`,
  `minecraft:stone_pressure_plate`, `..._weighted_pressure_plate_*`
- `minecraft:observer`
- `minecraft:piston`, `minecraft:sticky_piston`
- `minecraft:redstone_block`
- `minecraft:redstone_torch` / `minecraft:unlit_redstone_torch`
- `minecraft:redstone_lamp` / `minecraft:lit_redstone_lamp`
- Solid filler blocks the spec is allowed to assume: planned starter
  set TBD (likely `minecraft:stone`, `minecraft:smooth_stone`,
  `minecraft:glass`).

## Rule of thumb

The agent MUST NOT emit a block ID or state key not listed in
`pack/src/spec/components.ts`. The runtime validator rejects unknowns;
emitting them wastes round-trips. When a component you want isn't in
the table, ask the user — adding to the table is a deliberate decision,
not an agent inference.
