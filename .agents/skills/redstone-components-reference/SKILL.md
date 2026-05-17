---
name: redstone-components-reference
description: Use when you need the exact Minecraft Bedrock block ID, allowed state keys, and default state values for a redstone component you intend to put in a ContraptionSpec. Covers every component currently in the allow-list (wire, repeater, comparator, lever, button, pressure plate, observer, piston, sticky piston, redstone block, redstone torch, redstone lamp, plus stone/glass filler), the actual Bedrock state schemas captured via tools/discover-states.mjs, the powered/unpowered ID pairs, and the rotation-state conventions. The authoritative table is pack/src/spec/components.ts.
---

# redstone-components-reference

The components Redstone Forge supports today, their Bedrock IDs, and
the state keys you may set in a ContraptionSpec. State values listed
here come from live BDS 1.26.21.1 introspection via
`tools/discover-states.mjs` — they are what the engine actually
exposes, not what wiki articles say.

The authoritative runtime table is
[`pack/src/spec/components.ts`](../../pack/src/spec/components.ts).
This skill explains the entries.

## Quick rules

- **Use the `unpowered_*` IDs in specs.** Bedrock keeps repeaters and
  comparators as paired blocks (`unpowered_repeater` ↔ `powered_repeater`,
  same for comparator). Always write the `unpowered_*` form in specs;
  the engine auto-switches to the powered form when the block sees
  power. (`minecraft:repeater` and `minecraft:comparator` are NOT valid
  block IDs.)
- **Use the off form for lamps.** Spec uses `minecraft:redstone_lamp`;
  Bedrock swaps to `lit_redstone_lamp` automatically when powered.
- **Cardinal-directional blocks expose both `direction` (int 0–3) and
  `minecraft:cardinal_direction` (string).** Prefer the string in
  specs; the engine syncs the int.
- **6-axis blocks expose both `facing_direction` (int 0–5) and
  `minecraft:facing_direction` (string).** Same — prefer the string.

## Catalog

### Filler

| ID | state keys | notes |
| -- | ---------- | ----- |
| `minecraft:stone` | `stone_type` | values: `stone` (default), `granite`, `diorite`, `andesite`, ... |
| `minecraft:glass` | — | transparent; useful as a visible boundary marker |

### Wire & power source

| ID | state keys | notes |
| -- | ---------- | ----- |
| `minecraft:redstone_wire` | (none — `redstone_signal` is read-only) | Bedrock auto-computes signal strength from neighbours |
| `minecraft:redstone_block` | — | always emits power level 15; movable by piston |

### Output

| ID | state keys | notes |
| -- | ---------- | ----- |
| `minecraft:redstone_lamp` | — | off when placed; engine auto-swaps to `minecraft:lit_redstone_lamp` when powered |

### Inputs

| ID | state keys | notes |
| -- | ---------- | ----- |
| `minecraft:lever` | `lever_direction`, `open_bit` | `lever_direction` enum: `north \| south \| east \| west` (wall), `up_north_south \| up_east_west` (ceiling), `down_north_south \| down_east_west` (floor; default). `open_bit` true = pulled (powered). |
| `minecraft:wooden_button` | `facing_direction`, `button_pressed_bit` | `facing_direction` int 0–5: 0=down, 1=up, 2=north, 3=south, 4=west, 5=east. `button_pressed_bit` false by default. |
| `minecraft:stone_button` | `facing_direction`, `button_pressed_bit` | same as wooden; stone version takes longer to depress |
| `minecraft:wooden_pressure_plate` | (none — `redstone_signal` is read-only) | binary trigger (any entity → 15) |
| `minecraft:stone_pressure_plate` | (none — `redstone_signal` is read-only) | binary trigger (players + mobs only) |

### Inversion / signal shaping

| ID | state keys | notes |
| -- | ---------- | ----- |
| `minecraft:redstone_torch` | `torch_facing_direction` | enum: `north \| south \| east \| west \| top`. **Default is `unknown` when placed in air** — you must set a valid value or attach to a wall/floor. |

### Timing / logic

| ID | state keys | notes |
| -- | ---------- | ----- |
| `minecraft:unpowered_repeater` | `direction`, `repeater_delay`, `minecraft:cardinal_direction` | delay int 0–3 = 1–4 redstone ticks. Direction: prefer the string `minecraft:cardinal_direction: north \| south \| east \| west`. |
| `minecraft:unpowered_comparator` | `direction`, `minecraft:cardinal_direction`, `output_lit_bit`, `output_subtract_bit` | `output_subtract_bit: true` = subtract mode; false = compare mode. `output_lit_bit` is engine-driven. |
| `minecraft:observer` | `facing_direction`, `minecraft:facing_direction`, `powered_bit` | front face fires a 1-tick pulse on adjacent block updates. `facing_direction` 0–5; `minecraft:facing_direction` is the string equivalent. |

### Motion

| ID | state keys | notes |
| -- | ---------- | ----- |
| `minecraft:piston` | `facing_direction` | head extends in the +facing direction when powered. Push limit: 12 blocks. |
| `minecraft:sticky_piston` | `facing_direction` | also pulls the block in front when retracting |

## Rotation under `anchor: "player-facing"`

When a spec uses `anchor: "player-facing"`, the builder rotates both
positions and certain state values around the world Y axis so the
spec's local `+X` ends up "in front of the player" (the direction
`anchor.facing` recorded). The rotation step is:

| `anchor.facing` | Steps (CW 90°) |
| --------------- | -------------- |
| `east`          | 0 (identity)   |
| `south`         | 1              |
| `west`          | 2              |
| `north`         | 3              |

State values rotate according to a per-component tag in
`pack/src/spec/components.ts`. The rotation kinds are:

| Tag             | Behaviour |
| --------------- | --------- |
| `cardinal`      | string `north|south|east|west`; cycles 1 step CW per rotation step |
| `axis6`         | string with `up|down` invariant; cardinals cycle |
| `torch_mount`   | string with `top` invariant; cardinals cycle |
| `lever_mount`   | wall cardinals cycle as cardinals; `up_*` / `down_*` axis values swap NS↔EW on 90°/270° and are invariant on 180° |
| `facing_int`    | int 0–5 (0=down, 1=up invariant); 2/5/3/4 cycle (north→east→south→west) |
| `direction_int` | int 0–3; `(n + steps) % 4` |

Which state keys carry which tag (live, from
`pack/src/spec/components.ts`):

| Block | State key | Rotation tag |
| ----- | --------- | ------------ |
| `lever` | `lever_direction` | `lever_mount` |
| `wooden_button` / `stone_button` | `facing_direction` | `facing_int` |
| `redstone_torch` | `torch_facing_direction` | `torch_mount` |
| `unpowered_repeater` | `direction` | `direction_int` |
| `unpowered_repeater` | `minecraft:cardinal_direction` | `cardinal` |
| `unpowered_comparator` | `direction` | `direction_int` |
| `unpowered_comparator` | `minecraft:cardinal_direction` | `cardinal` |
| `observer` | `facing_direction` | `facing_int` |
| `observer` | `minecraft:facing_direction` | `axis6` |
| `piston` / `sticky_piston` | `facing_direction` | `facing_int` |

State keys NOT in this table (e.g. `open_bit`, `repeater_delay`,
`output_subtract_bit`, `redstone_signal`) pass through unchanged
regardless of rotation step.

Math is unit-tested host-side in `test/transform.test.ts`
(`npm test` — 35 truth-table assertions, finishes in ~10ms).

## Direction conventions

`facing_direction` integer mapping (Bedrock convention; differs from
Java!):

| Value | Direction | World offset |
| ----- | --------- | ------------ |
| 0 | down  | (0, -1, 0) |
| 1 | up    | (0, +1, 0) |
| 2 | north | (0, 0, -1) |
| 3 | south | (0, 0, +1) |
| 4 | west  | (-1, 0, 0) |
| 5 | east  | (+1, 0, 0) |

`minecraft:cardinal_direction` string values (south is `+Z`, north is
`-Z`, east is `+X`, west is `-X`).

`repeater.direction` integer 0–3:
| Value | Direction |
| ----- | --------- |
| 0 | south |
| 1 | west |
| 2 | north |
| 3 | east |

## Hard rules for spec authors

1. **Never use a block id not in this list.** The validator rejects
   unknown IDs with a clear error. To add one, run
   `tools/discover-states.mjs` to confirm the state schema, then edit
   `pack/src/spec/components.ts` and ask the user to review before
   committing.
2. **Never use a state key not in this list for a given block.** Same
   reason — the schema is locked. Adding one is a deliberate code
   change.
3. **Don't set `redstone_signal` directly** on wire/pressure plates
   even though they have the state — Bedrock computes it and a manual
   value gets overwritten on the next tick.
4. **Don't use `minecraft:repeater` or `minecraft:comparator` as IDs.**
   They aren't registered block types; use the `unpowered_*` form.

## Discovery script

To verify or extend the table:

```pwsh
node tools/discover-states.mjs
```

Spawns BDS, places each candidate block in a ticking area chunk near
spawn, dumps its `typeId` and `getAllStates()`. Output is suitable for
direct copy into the components table.
