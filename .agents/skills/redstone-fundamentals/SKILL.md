---
name: redstone-fundamentals
description: Use when reasoning about redstone signal behavior in Minecraft Bedrock — signal strength (0-15), 15-block wire decay, repeater locking, observer pulses, piston rules, BUD behavior, redstone block / torch / wire power sourcing, comparator subtract vs compare mode, tick timing, redstone-tick vs game-tick distinctions. Load before designing a non-trivial contraption or before guessing why an output is the wrong value.
---

# redstone-fundamentals

The physics of redstone, at a level the agent can reason from.

> Status: stub. Fills in during Phase 5.

## Intended scope

- Signal strength model: 0–15, sources, decay over wire (15 blocks), and
  what counts as a "strong" vs "weak" power source.
- Components, one section each, focused on Bedrock semantics
  (Bedrock differs from Java in tick ordering, observer behavior, and
  several edge cases — call those out):
  - redstone wire (turning into a cross / line, power-flow direction)
  - redstone torch (inversion, burnout, mounting)
  - redstone block (constant power source, mobile via piston/slime)
  - repeater (delay 1–4 ticks, locking, direction sensitivity)
  - comparator (subtract vs compare, container measuring, fade)
  - observer (front-face block-update detection, 1-tick pulse, BUD use)
  - levers / buttons / pressure plates / tripwire / detector rails
  - piston / sticky piston (push limit 12, slime/honey chains)
  - lamp / dispenser / dropper / hopper (as outputs and as state)
- Timing: redstone tick = 0.1s = 2 game ticks; ordering rules; pulse
  width; common race conditions.
- Bedrock vs Java caveats — list the differences that bite when porting
  Java tutorials.

## Authoritative references

- Minecraft Wiki: `https://minecraft.wiki/w/Redstone_circuit`
- Component-specific wiki pages.
- For Bedrock-specific quirks: `https://minecraft.wiki/w/Java_Edition_distinctions`.

## When in doubt

Write a tiny diagnostic spec, build it, observe via `GET /world`, and
update the model. Do not assert exact tick counts from memory — verify.
