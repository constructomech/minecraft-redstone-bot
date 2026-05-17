---
name: debugging-contraptions
description: Use when one or more tests in POST /test failed and you need to figure out why. Covers reading observed-vs-expected diffs, fetching world snapshots via GET /world to inspect actual placement, common failure modes (repeater pointing the wrong way, wire path broken by a state change, timing too tight, missing block-update trigger, lever/lamp/piston Bedrock bugs), and the iteration budget before stopping to ask the user.
---

# debugging-contraptions

How to recover when `POST /test` reports failures.

## Step 1: Read the test result

Every failing test has a `failedStep`:

```jsonc
{
  "name": "AND truth table",
  "pass": false,
  "stepCount": 12,
  "failedStep": {
    "index": 5,
    "port": "out",
    "expected": "on",
    "observed": "off"
  }
}
```

`index` is the step number (0-based) where the assertion first failed.
Walk the spec's `tests[].steps` to that index. The most recent
preceding `set` and `wait_ticks` tell you the world state when the
`expect` ran.

If `error` is set instead of `failedStep`, the runner threw mid-step
(typically because a port's underlying block went missing — see "Bedrock
bugs" below).

## Step 2: Inspect the world

```pwsh
node tools/forge.mjs world <x1> <y1> <z1> <x2> <y2> <z2>
```

Use bounds that comfortably cover the build region + 1 block buffer in
each direction. The response shows every non-air block with its
typeId and states.

What to compare:

- Block IDs at each spec position match what you specified?
- Directional states (facing_direction, lever_direction, torch_facing_direction,
  minecraft:cardinal_direction) match? When `anchor: "player-facing"`
  these rotate via `pack/src/world/transform.ts` — verify the rotation
  produced what you expected.
- The right INPUT block exists at the input port (lever, redstone_block,
  button, pressure_plate)?
- The right OUTPUT block exists at the output port (lamp, wire,
  piston)?

For a single-position check:

```
/scriptevent rsforge:debug_blockat <x> <y> <z>
```

(works from BDS console; logs the block's typeId + states)

## Step 3: Match symptoms to failure modes

### Output reads "off" but you expected "on"

| Symptom | Likely cause | Fix |
| ------- | ------------ | --- |
| Wire output at signal=0 even though source is in place | Wire path is broken (a non-conductor in the path, signal decayed below 1, or wire's support block is non-solid) | Walk the path from source to output; add repeaters if you've gone >14 blocks |
| Wire signal correct but lamp is air | The lamp transition bug (see bugs/script-api-lamp-destroyed-on-transition.md) | Switch to `wire` output for tests |
| Wire signal correct but piston not extended | The piston activation bug (bugs/script-api-piston-no-power-response.md) | Piston extension isn't reliably automatable; reserve piston tests for player verification |
| Output flickers or partially works | Timing too tight — read happened before propagation settled | Increase `wait_ticks` (try +2 per repeater hop) |

### Output reads "on" but you expected "off"

| Symptom | Likely cause | Fix |
| ------- | ------------ | --- |
| Wire stays at signal > 0 after the input is cleared | A stray power source (forgotten redstone_block, torch on the wrong wall, redstone_torch's inversion logic backward) | Inspect adjacent blocks within 1-2 blocks of the wire path |
| Output stuck at "on" from previous test step | Test step order is wrong, or the runner ran `expect` before `set` | Re-read the test's step sequence; insert `wait_ticks` after each `set` |

### Lever / lamp / piston specific

- Lever placed by spec: drops within ~5 ticks in the headless harness
  (lever physics-drop bug). Works for a real player. If your spec
  has a lever and you're running tests through the harness, the
  test will fail spuriously. Move the lever-bearing tests to
  player-only verification.
- Lamp placed by spec: destroyed when adjacent wire first powers up
  (lamp transition bug). Use `wire` output instead, OR run tests
  with a real player active.
- Piston placed via Script API: doesn't extend in response to
  redstone_block placed adjacent via the same API. Use player verify
  only.

### Build failed entirely

If `POST /build` returns `ok: false`:

- **`spec validation failed`**: the `errors` array tells you which
  `$.path` is bad. Fix the spec.
- **`no anchor set`**: the player hasn't run `/rsforge:anchor` (or
  `/rsforge:build` which auto-anchors). Tell them.
- **`block X at Y: ... InvalidArgumentError`**: Bedrock rejected the
  state values you supplied. Re-run `tools/discover-states.mjs` for
  that block id and confirm the allowed values.

## Step 4: Hypothesize, change, retry

For each iteration:

1. State your hypothesis IN ONE SENTENCE before making the change.
   "The wire path stops at (3,1,0) because the lever's east face is
   missing a connecting wire."
2. Make the minimum change that would address that hypothesis.
3. `POST /build`, then `POST /test`. (Or `forge build`, then `forge
   test`.)
4. Read the new result. Confirm the OLD failed step now passes. If a
   NEW step fails, that's progress (one bug down, next bug exposed).
5. Repeat.

If two consecutive iterations fail for the SAME REASON, your model is
wrong — stop iterating and re-read the world state from scratch.

## Step 5: Iteration budget

Hard cap: **5 attempts** per request.

After 5 attempts, stop and report:

- The most recent observed-vs-expected from `/test`.
- The current spec (or the diff from the last "almost working" version).
- Your best guess at the root cause.
- A specific next action you'd suggest if continuing — usually:
  - "Can you flip the lever in-game and tell me whether the lamp
    lights up?" (player verification, since the harness has bugs)
  - "Should the contraption do X or Y? I keep getting confused
    because the request could mean either."
  - "I think we need a new component in `components.ts` — should I
    propose it?"

Don't grind past 5. The user's attention is finite; one focused
question is worth ten flailing attempts.

## Common bugs in the harness vs in player gameplay

The Bedrock Script API bugs documented in `bugs/` mean that some
tests legitimately can't pass in the headless harness even when the
contraption itself is correct. Specifically:

- Tests with `lever` inputs will fail because the lever drops.
- Tests with `lamp` outputs will fail because the lamp is destroyed
  on transition.
- Tests with `piston` outputs as the "is the door open" probe will
  fail because the redstone update doesn't trigger piston extension
  programmatically.

When a test fails for one of these reasons (not because the
contraption is wrong), report it as "test fails in harness due to
bugs/ entry X; please verify by triggering manually in-game."

The wire-signal output kind is bug-immune for binary signals.
