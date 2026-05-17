---
name: building-contraptions
description: Use as the end-to-end recipe whenever the user asks for a new contraption. The canonical operating loop — understand request, check pattern library, design, draft ContraptionSpec, validate locally, POST /build (with dryRun for large footprints), POST /test, iterate on failures up to the configured cap, persist spec to specs/. The workflow AGENTS.md references in detail.
---

# building-contraptions

The canonical operating loop. Follow these steps for every contraption
request, in order.

## The loop

### 1. Understand

Restate what you heard in one sentence. Identify in your head:

- **Inputs:** kind + count + intended trigger style
- **Outputs:** kind + count + visual or logical role
- **Behavior:** combinational, sequential, or timed
- (For sequential) **state count and reset behavior**

If any of those is ambiguous, ask ONE focused question before
proceeding. Don't ask all four. Don't ask none. Examples of good
clarifiers:

- "Is the button momentary or a toggle?"
- "Should the output stay lit, or just pulse when the inputs match?"
- "What resets it?"

### 2. Reuse

Before designing, load `pattern-library` and scan for matches. If a
single pattern matches → use it directly. If a composition of 2-3
patterns gets you 80%+ → compose via `includes` and spec only the
delta. Only design from scratch when no pattern is close.

### 3. Design

Load `designing-contraptions` for decomposition heuristics. Make
explicit decisions about:

- Topology (gate composition, latch family, clock type)
- Orientation (almost always `anchor: "player-facing"`)
- Per-block facing/direction states (defaults are sometimes wrong;
  see `redstone-components-reference` for the footguns)

### 4. Draft

Emit a `ContraptionSpec` JSON. Load `contraption-spec-format` for the
schema and `redstone-components-reference` for valid IDs and states.

Required at minimum: `name`, `footprint.size`, `blocks[]`. Plus
`anchor: "player-facing"` for almost every spec. Plus `ports` + `tests`
for anything that's not a trivial visual layout.

### 5. Validate

Save the spec to a temp file and either:

- `node tools/forge.mjs build <path>` — validates server-side AND
  builds, OR
- (Phase 5+) `node tools/forge.mjs validate <path>` — validates only

A spec that fails validation must NOT hit the world. The validator's
error messages reference specific `$.blocks[N].id` paths to the bad
field.

### 6. Build

```pwsh
node tools/forge.mjs build path/to/spec.json
```

For specs whose footprint exceeds 500 blocks, do a dry-run first by
inspecting the response without `placed` going through (Phase 5+
adds `dryRun: true`; for now, build small specs first).

Surface the returned `jobId` to the user. They can always
`/rsforge:undo` it in-game, or `node tools/forge.mjs undo` from
their terminal.

If the user is in-game and wants a one-step "build at my current
position":

```
(in-game)  /rsforge:build <spec-name>
```

That re-anchors at the player's current position+facing and builds
the named spec.

### 7. Test

```pwsh
node tools/forge.mjs test
```

For every failing test in the response:

- Load `debugging-contraptions`.
- Inspect the world: `node tools/forge.mjs world <x1> <y1> <z1> <x2> <y2> <z2>`.
- Diff observed vs intended placement.
- Identify root cause (wrong facing, missing repeater, timing too
  tight, missing block-update trigger, etc.).
- Refine the spec.
- Build again with a new jobId.

**Iteration cap: 5 attempts by default.** If still failing, stop and
report to the user with:

- The observed-vs-expected table from the failing test
- A hypothesis for why it's failing
- Suggested next step (often: ask for a player-side visual check, or
  ask the user to confirm the intended behaviour)

### 8. Persist

The final spec goes to `specs/<kebab-name>.json`. Report to the user:

- Footprint and bounds
- Port names and kinds
- Test results (passed/total)
- How they can build it themselves (`forge build specs/<name>.json`
  or `/rsforge:build <name>`)
- How they can undo it (`forge undo` or `/rsforge:undo`)

## What NOT to do

- Don't burn 5 iterations on the same identical-looking failure. If
  attempt 2 fails for the same reason as attempt 1, your model of the
  bug is wrong — STOP and re-read the world state.
- Don't invent block IDs not in `redstone-components-reference`. The
  validator rejects them and it's faster to ask the user to extend
  the table than to keep guessing.
- Don't skip `tests` on a non-trivial contraption. If you can't write
  a test that would fail when the circuit is broken, you don't fully
  understand the behaviour the user wants.
- Don't run `POST /build` on a 500+ block spec without inspecting it
  first. Big specs can lock the BDS tick budget; the daemon's `/build`
  call has a 30s timeout but the world's state could end up partially
  written if the pack runs out of tick budget mid-loop.
- Don't keep `lever` inputs or `lamp` outputs in tests you expect
  to pass in the headless harness. Those bugs are in `bugs/` — use
  `redstone_block` inputs and `wire` outputs for automated tests, and
  the lever/lamp forms only when a real player will run them.

## When to stop and ask

The user is the bottleneck only when you're stuck. Specifically:

- The request is fundamentally ambiguous (5+ interpretations, none
  clearly correct).
- 5 build-test iterations failed without converging.
- The contraption requires a component not yet in
  `redstone-components-reference`.
- The contraption requires a port kind not yet in the runner (e.g.
  analog comparator output, dispenser counter, etc.).

In every other case, iterate the spec yourself.
