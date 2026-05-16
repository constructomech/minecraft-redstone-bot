---
name: debugging-contraptions
description: Use when one or more tests in POST /test failed and you need to figure out why. Covers reading observed-vs-expected diffs, fetching world snapshots via GET /world to inspect actual placement, common failure modes (repeater pointing the wrong way, wire path broken by a state change, timing too tight, missing block-update trigger), and the iteration budget before stopping to ask the user.
---

# debugging-contraptions

How to recover when `POST /test` reports failures.

> Status: stub. Fills in during Phase 5.

## Intended scope

- Reading the `/test` result table: `observed` vs `expected`, which
  step failed, the timing of the failure.
- Inspecting the world: `GET /world?bounds=[x1,y1,z1,x2,y2,z2]`
  returns a compact dump of block IDs and key states. Cross-reference
  against the spec's intended placement.
- Common failure modes and their fixes:
  - Repeater pointing the wrong way (rotation transform off).
  - Wire dead because an adjacent block is consuming the signal.
  - Observer not firing because the triggering block didn't actually
    change state.
  - Timing race: output sampled before the signal propagated; bump
    `wait_ticks`.
  - Piston pushed an immovable block (obsidian, bedrock, large
    structure) and silently failed.
  - Power source missing (forgot the redstone block / torch / lever
    initial state).
- The iteration budget: by default 5 attempts. After that, stop and
  report observed-vs-expected to the user. Do not loop forever —
  burning tokens on a broken design is worse than asking.
- When to widen the bounds of `/world`: the bug may be just outside
  the footprint (e.g. a redstone wire's power source one block off).
