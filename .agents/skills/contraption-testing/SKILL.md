---
name: contraption-testing
description: Use when designing the tests array of a ContraptionSpec or writing tests for an existing build. Covers the test step grammar (set, wait_ticks, expect), the supported input kinds (lever, redstone_block) and output kinds (lamp, wire), how to choose wait_ticks for signal propagation, the test runner's pass/fail model, the ./tools/forge.mjs CLI ('forge test [jobId] [testName]'), and the four Bedrock bugs that bite the test runner in mid-air contexts (see bugs/).
---

# contraption-testing

How to write the `tests` array of a `ContraptionSpec` so that "all green"
actually means "the contraption works."

## Test step grammar

A test is `{ name, steps: TestStep[] }`. Each step is one of:

```jsonc
{ "set":    { "<input_port>": "on" | "off", ... } }
{ "wait_ticks": <non-negative integer> }
{ "expect": { "<output_port>": "on" | "off", ... } }
```

The runner walks steps in order. `set` and `expect` both refer to ports
by their declared `name`. The first failed `expect` aborts the test
with a `failedStep` record:

```jsonc
{
  "name": "lever passthrough",
  "pass": false,
  "stepCount": 9,
  "failedStep": {
    "index": 5,
    "port": "out",
    "expected": "on",
    "observed": "off"
  }
}
```

`set` must only reference declared INPUT ports; `expect` must only
reference declared OUTPUT ports. The validator rejects spec violations
before the test ever runs.

## Ports

```jsonc
{
  "ports": {
    "inputs":  { "<name>": { "at": [x,y,z], "kind": "<input-kind>" } },
    "outputs": { "<name>": { "at": [x,y,z], "kind": "<output-kind>" } }
  }
}
```

| Side | Kind | What it does in `set` / `expect` |
| ---- | ---- | -------------------------------- |
| input | `lever` | toggles a `minecraft:lever` at the port position by flipping `open_bit`. *Caveat: see Bedrock bugs below.* |
| input | `redstone_block` | "on" places a `minecraft:redstone_block` at the port position; "off" replaces with air. Most reliable input under current Bedrock bugs. |
| output | `lamp` | reads block type at the port position: `lit_redstone_lamp` → on, `redstone_lamp` (or any other id) → off. *Caveat: see Bedrock bugs below.* |
| output | `wire` | reads `redstone_signal` of the wire at the port position: signal > 0 → on, signal == 0 → off. *Most reliable output under current Bedrock bugs.* |

The list grows as we add support. Future Phase 4c will likely add
`button` / `pressure_plate` inputs and `piston` / `comparator` / `observer`
outputs.

## Choosing `wait_ticks`

After a `set`, give the signal time to settle before the next `expect`.

| Scenario | Recommended wait_ticks |
| -------- | ---------------------- |
| Single wire (input directly powers wire next to output) | 2–4 |
| Wire chain (up to 15 blocks) | 4 |
| One repeater hop (delay 1) | 4 |
| Per additional repeater hop with delay 1 | +2 |
| Wire + torch inverter | 4–6 |
| One observer detecting an upstream block update | 4 |

Use the largest value that's still fast — undercounting ticks is the
single most common cause of false negatives. Tests run at the pack's
tick rate, so `wait_ticks: 4` adds ~200ms of real time per step.

`wait_ticks: 0` is valid and means "advance no ticks." Useful when you
want to verify steady-state without changing inputs.

## Running tests

From the agent / CLI:

```pwsh
node tools/forge.mjs build path/to/spec.json   # POST /build
node tools/forge.mjs test                       # POST /test (default: latest job, all tests)
node tools/forge.mjs test <jobId>               # specific job
node tools/forge.mjs test <jobId> "<test name>" # specific test in a job
```

`POST /test` body shapes:

```jsonc
{}                                       // latest job, all tests
{ "jobId": "..." }                       // specific job, all tests
{ "testName": "AND truth table" }        // latest job, named test
{ "jobId": "...", "testName": "..." }    // specific job + test
```

Response shape:

```jsonc
{
  "ok": true | false,
  "data": {
    "jobId": "...",
    "name": "<spec name>",
    "passed": <int>,
    "failed": <int>,
    "results": [ TestRunResult, ... ]
  },
  "error": "<set if failed > 0>"
}
```

## Designing tests well

Truth-table for combinational circuits:

```jsonc
"tests": [
  {
    "name": "AND truth table",
    "steps": [
      { "set": { "a": "off", "b": "off" } }, { "wait_ticks": 4 }, { "expect": { "out": "off" } },
      { "set": { "a": "off", "b": "on"  } }, { "wait_ticks": 4 }, { "expect": { "out": "off" } },
      { "set": { "a": "on",  "b": "off" } }, { "wait_ticks": 4 }, { "expect": { "out": "off" } },
      { "set": { "a": "on",  "b": "on"  } }, { "wait_ticks": 4 }, { "expect": { "out": "on"  } }
    ]
  }
]
```

Sequence test for stateful circuits (flip-flop, latch):

```jsonc
"tests": [
  {
    "name": "T flip-flop toggles on each pulse",
    "steps": [
      { "set": { "clk": "off" } },               { "expect": { "q": "off" } },
      { "set": { "clk": "on"  } }, { "wait_ticks": 2 },
      { "set": { "clk": "off" } }, { "wait_ticks": 2 }, { "expect": { "q": "on"  } },
      { "set": { "clk": "on"  } }, { "wait_ticks": 2 },
      { "set": { "clk": "off" } }, { "wait_ticks": 2 }, { "expect": { "q": "off" } }
    ]
  }
]
```

Reset, then transition, then return, then transition — the cycle should
return to the initial state if the circuit's internal state is correct.

## Bedrock bugs the test runner works around (or doesn't)

There are four open Bedrock 1.26.21 Script API bugs filed under `bugs/`
that affect what works automatically vs what needs the user in-game.
The relevant summary:

| Bug | Affects | Workaround |
| --- | ------- | ---------- |
| `script-api-setblock-no-neighbor-redstone-update.md` | Both `setBlockType` and `setBlockPermutation` fail to fire neighbor block updates for redstone. | The test runner drives inputs via `runCommand("setblock ...")` which goes through the vanilla code path. The builder mostly uses `setBlockPermutation` for performance but follows up with `runCommand` for redstone-responsive blocks (lamp/wire/repeater/comparator/observer/piston). |
| `script-api-lever-state-mutation-no-update.md` | `block.permutation.withState("open_bit", true)` flips the value but doesn't propagate. | The test runner now drives levers via `runCommand("setblock ... lever [\"lever_direction\"=...,\"open_bit\"=...]")`. Even with the workaround, programmatic levers still hit the next bug. |
| `script-api-lever-physics-drop-after-setblock.md` | Levers placed by the script API drop within ~5 ticks because the attached-to-block pointer isn't established. | None. **Don't use `lever` inputs in automated tests run by the headless harness.** Levers work fine for real players in-game. |
| `script-api-lamp-destroyed-on-transition.md` | `redstone_lamp` placed by the script API is destroyed instead of transitioning to `lit_redstone_lamp` when adjacent wire powers up. | None. **Don't use `lamp` outputs in automated tests run by the headless harness.** Use `wire` outputs instead — `redstone_signal` reads are unaffected. |

### Patterns that work reliably (use for automated tests)

- Input: `redstone_block` placed/removed by `runCommand`.
- Output: `wire` directly adjacent, read via `redstone_signal`.

### Patterns that fail in the harness (but work for a real player)

- Input: `lever` (drops within ~5 ticks).
- Output: `lamp` (destroyed on transition).

The on-disk `specs/examples/lever-wire-lamp.json` keeps the
human-friendly lever+lamp form. Its declared `tests` block runs fine
when the user invokes `forge test` from chat while standing nearby
(the lever doesn't drop because the player's presence + grass support
establishes the missing attached-to-block pointer; the lamp
transition works for reasons we don't fully understand but presumably
related to the player being a chunk-loader). It fails in the headless
harness — see `bugs/`.

## Adding a new input or output kind

When you need a new port kind:

1. Add it to `InputKind` or `OutputKind` in `pack/src/spec/schema.ts`
   and to the corresponding `ALLOWED_*_KINDS` array.
2. Add a case to `driveInput` in `pack/src/world/inputs.ts` (for an
   input) or `readOutput` in `pack/src/world/probes.ts` (for an output).
3. Decide whether the new kind is bug-immune or bug-prone. If it
   involves a block that transitions IDs (like the lamp) or has
   attachment-pointer state (like the lever), expect to hit the bugs
   above. Use vanilla command machinery (`runCommand("setblock ...")`)
   to write through; use direct state reads (`getState(...)`) to read.
4. Update this skill's table.
