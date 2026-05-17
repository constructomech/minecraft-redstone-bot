---
name: redstone-fundamentals
description: Use when reasoning about redstone signal behavior in Minecraft Bedrock — signal strength (0-15), 15-block wire decay, repeater locking/delay, observer pulses, piston rules (push limit, sticky vs normal), BUD behavior, redstone block / torch / wire power sourcing, comparator subtract vs compare mode, tick timing (game tick vs redstone tick), and Bedrock vs Java quirks. Load before designing or debugging any non-trivial contraption.
---

# redstone-fundamentals

The physics you need to reason about contraptions in Bedrock. This is
the model the agent uses when drafting a spec or diagnosing why an
expected output didn't materialize.

## Signal strength

- Range 0 (no power) to 15 (full power).
- A redstone wire's signal **decays by 1 per block** along the wire.
  At source: 15. One block away: 14. … 15 blocks away: 1. 16 blocks
  away: 0 (signal dies).
- A non-wire block that's "strongly powered" by a power source emits
  power to adjacent wires/components at the source's strength.

## Power sources

| Block | What powers what |
| --- | --- |
| `minecraft:lever` | When `open_bit=true`: powers its support block (the one it's mounted to) strongly, and emits 15 to adjacent wires/blocks. |
| `minecraft:wooden_button` / `stone_button` | Pulse: pressed for ~10 ticks (wood) / ~20 ticks (stone), then auto-releases. Powers like a lever during the pulse. |
| `minecraft:wooden_pressure_plate` / `stone_pressure_plate` | Pulse while an entity stands on them. Stone = mobs+players only; wood = any entity. Output level 15 binary. |
| `minecraft:redstone_block` | Constant 15 in all 6 directions. Notably **movable by piston** — can be relocated by sticky pistons to make moving power sources. |
| `minecraft:redstone_torch` | Constant 15 when its support block is NOT powered; off when support is powered (so torches **invert** the signal on the block they're attached to). Also powers the block ABOVE it strongly. Limited "burnout" if power-cycled too rapidly. |
| `minecraft:observer` | Front face emits a **1-tick pulse** every time the block directly in front of it changes (placed, removed, state-changed). Useful for detecting block updates without long wires. |
| Comparator + container | Compares container fullness (chest, hopper, brewing stand, etc.) to compute analog 0-15. |

## Inversion: redstone torches

Torches are the cheapest logical NOT gate.

```
[lever]→[stone]                  [stone]→[torch on side]→ powers adjacent
        ↑
        torch on the side of this block
```

When lever is off → stone unpowered → torch on → torch's neighbors get
power. When lever is on → stone powered → torch turns off → no power
flows out.

A NOT-NOT chain (two torches) is identity (with a 2-tick delay each).

## Wire

- `minecraft:redstone_wire` is the conductor. Must sit on a solid block
  with a non-transparent top surface.
- Auto-connects to adjacent wires, repeaters, comparators, levers,
  pressure plates, observers, redstone blocks, and the FRONT of
  buttons. Does NOT power blocks above it diagonally.
- Carries signal with 1-strength-per-block decay.

## Repeaters

- `minecraft:unpowered_repeater` / `minecraft:powered_repeater` (the
  two id forms — use unpowered in specs; engine swaps).
- States: `direction` (0-3 int; 0=south 1=west 2=north 3=east), or
  `minecraft:cardinal_direction` (string), and `repeater_delay`
  (0-3 = 1 to 4 redstone ticks of delay).
- Adds delay to a signal, also **boosts** it back to 15 (so you can
  daisy-chain wires beyond 15 blocks).
- A powered repeater pointing into the side of another repeater
  **locks** the target (it cannot change state until the lock releases).
  Useful for latches.

## Comparators

- `minecraft:unpowered_comparator` / `minecraft:powered_comparator`.
- States: `direction` / `minecraft:cardinal_direction`,
  `output_subtract_bit` (false = compare mode, true = subtract mode),
  `output_lit_bit` (engine-driven).
- **Compare mode** (default): output = back input if back ≥ side
  inputs, else 0.
- **Subtract mode**: output = max(0, back − strongest side input).
- Reads container fullness from a container behind it as analog 0-15.

## Observers

- `minecraft:observer`. States: `facing_direction` (0-5 int) or
  `minecraft:facing_direction` (string).
- Watches the block its FRONT is touching. Any block change there
  (placement, removal, block-state change) fires a 1-tick pulse out
  the BACK.
- Crucial for BUD circuits (block-update-detector) and for
  edge-triggered logic.

## Pistons

- `minecraft:piston` and `minecraft:sticky_piston`.
- State: `facing_direction` (0-5 int).
- When powered from any side EXCEPT the front, extends. Head appears
  at front-offset position as `minecraft:piston_arm_collision`.
- Push limit: **12 blocks** maximum at once. Past that, the piston
  refuses to extend.
- Cannot push: bedrock, obsidian (still pushable in Bedrock actually,
  depends on version), command blocks, chests, hoppers, beds, doors,
  and blocks attached to other blocks (levers, torches, etc.).
- Sticky pistons PULL the front-adjacent block back when retracting.
  Regular pistons just retract.
- A redstone_block can be pushed by a piston — useful for "block
  swappers" that relocate the power source.

## Tick timing

- One **game tick** = 50ms = 1/20 second.
- One **redstone tick** = 2 game ticks = 100ms.
- Repeater delay 0 = 1 redstone tick (2 game ticks).
- Repeater delay 3 = 4 redstone ticks (8 game ticks).
- Observer pulse = 1 game tick wide (just barely registers on a
  repeater set to delay 0).
- Wait this many `wait_ticks` in tests when a signal needs to settle:

  | Path | wait_ticks |
  | --- | --- |
  | Single wire (lever next to wire) | 2-4 |
  | Wire chain (up to 15 blocks) | 4 |
  | Per repeater hop (delay 1) | +2 |
  | Wire + 1 torch inverter | 4-6 |
  | Observer-triggered chain | 4-8 |

  When in doubt, **err larger**; undercounting ticks is the single
  most common false failure.

## Bedrock vs Java quirks

A few places where copying tutorials from Java will mislead you:

- **`facing_direction` integer convention** (Bedrock): 0=down, 1=up,
  2=north, 3=south, 4=west, 5=east. Java is different. Memorize this
  or look it up from `redstone-components-reference`.
- Bedrock has both a string state (`minecraft:cardinal_direction`,
  `minecraft:facing_direction`) AND legacy int state (`direction`,
  `facing_direction`) on most directional blocks. Spec the string
  form; the engine syncs the int.
- Observer pulse width: Bedrock fires a 1-game-tick pulse (sometimes
  reported as "instant"). A repeater set to delay 0 (= 2 game ticks)
  can catch it; less reliable beyond that.
- Tile-tick ordering for simultaneous redstone updates can produce
  different end-states in Bedrock vs Java for "race" circuits. Don't
  depend on order of evaluation.
- Pistons honour "redstone block-update" notification differently:
  programmatic placement via Script API doesn't always trigger
  extension. See `bugs/script-api-piston-no-power-response.md`.

## "BUD" — block update detection

A BUD circuit uses observers (or, classically in Java, sticky pistons
holding redstone blocks) to detect that ANY change happened to a
particular block. Useful for:

- Latching on first activation.
- Triggering off the END of a piston extension (observer behind the
  piston detects the head block updating).
- Cascading events ("when X changed, fire Y, which fires Z").

In Bedrock, prefer observers — they're cleaner than the historical
BUD-via-piston tricks.

## When in doubt

Write a tiny diagnostic spec, build it, observe via `GET /world` or
`debug_blockat`, and update your model. Do not assert exact tick
counts from memory for high-stakes claims — verify against the
engine.
