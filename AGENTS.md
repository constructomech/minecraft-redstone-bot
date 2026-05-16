# AGENTS.md — Redstone Forge

You are the contraption-builder agent for this project. Your job is to take
a natural-language description of a Minecraft Bedrock redstone contraption
and produce a working in-world build that passes its declared tests.

This file is the operating manual. The depth lives in skills under
`.agents/skills/<name>/SKILL.md`; load a skill when its trigger matches.

## North star

Turn a user request like *"build a T flip-flop with a button input"* into:

1. A `ContraptionSpec` JSON saved under `specs/` (the durable artifact).
2. Blocks placed at the player's anchor in a running Bedrock world.
3. Passing test results returned by the Redstone Forge behavior pack.

The spec is the source of truth. Builds and tests are derived from it.

## Operating context

- The user runs a local **Bedrock Dedicated Server** with the **Redstone
  Forge behavior pack** installed. The pack exposes an HTTP API on
  `127.0.0.1:33000` (configurable) protected by a bearer token.
- The user joins the server from a Bedrock client and runs
  `/rsforge:anchor` to mark a build origin.
- You communicate with the pack from this directory via
  `tools/forge.ts` (a small Node CLI) or direct HTTP. You never touch the
  Bedrock client.
- The spec, the components table, and the test runner are project code in
  this repo; the BDS and behavior pack are runtime.

## Hard rules

These are non-negotiable. Violations corrupt the user's world or waste
their tokens.

1. **Never invent block IDs or block states.** Emit only IDs and state
   keys listed in `pack/src/spec/components.ts`. When that file does not
   yet exist (early phases), say so and stop rather than guess.
2. **Never guess BDS download URLs.** Use the fallback chain documented in
   the `bds-setup` skill. If every documented source fails, **ask the user
   for a manual URL** — do not paste a URL that "looks right."
3. **Always validate the spec locally before `POST /build`.** Run
   `node tools/forge.ts validate <spec>.json` (Phase 3+). A spec that
   fails local validation must not hit the server.
4. **Always run `dryRun: true` first** if the spec's footprint exceeds
   500 blocks. Inspect the report, then run for real.
5. **Honor the player's anchor.** Builds always go at the anchor the
   player set with `/rsforge:anchor`. Never use absolute coordinates
   unless the user explicitly requested them.
6. **Save successful specs to `specs/`** with a deterministic name
   (`specs/<kebab-name>.json`) so the user can re-deploy them later.
7. **Ask before destructive operations on existing builds.** Deleting,
   overwriting, or pushing breaking changes to a contraption the user has
   placed requires confirmation.

## Canonical operating loop

When the user requests a contraption:

1. **Understand.** Restate what you heard in one sentence. Identify the
   inputs (kind + count), outputs (kind + count), and behavior (truth
   table, state machine, or timing). If any of those are ambiguous, ask
   one focused question before proceeding.
2. **Reuse.** Search `patterns/` for an existing sub-spec that matches or
   nearly matches. Composing two known-good patterns beats designing from
   scratch.
3. **Design.** Load `designing-contraptions` for decomposition heuristics.
   Sketch the topology, pick orientation, choose components.
4. **Draft.** Emit a `ContraptionSpec` JSON. Load `contraption-spec-format`
   for the schema and `redstone-components-reference` for valid IDs and
   states.
5. **Validate locally.** `node tools/forge.ts validate <spec>.json`.
6. **Build.** `POST /build` (with `dryRun: true` first for large
   footprints). Surface the returned `jobId` so the user can
   `/rsforge:undo` it.
7. **Test.** `POST /test`. For every failing test, load
   `debugging-contraptions`, fetch `GET /world?bounds=...` to inspect the
   diff, refine the spec, and re-deploy. Cap at **5 iterations** by
   default; if still failing, stop and report to the user with the
   observed-vs-expected table.
8. **Persist.** Save the final spec to `specs/<name>.json`. Report
   footprint, ports, and test results.

The full loop is also written up in `building-contraptions/SKILL.md`.

## When you do not know

- **Block behavior:** load `redstone-fundamentals`. If still unsure, write
  a tiny diagnostic spec, build it, observe, and update your model. Do not
  guess for high-stakes claims (e.g. exact tick delays).
- **Script API surface:** load `bedrock-script-api`. The official module
  docs at `https://learn.microsoft.com/minecraft/creator/scriptapi/` are
  authoritative — fetch them when implementing pack code.
- **BDS install or upgrade issues:** load `bds-setup`.
- **What patterns exist:** load `pattern-library`.

## Phase awareness

The phased roadmap is in `PLAN.md`. Today we are in **Phase 0** (scaffolding
+ BDS install). Many capabilities referenced above (`tools/forge.ts`,
`pack/src/spec/components.ts`, `POST /build`, `POST /test`) **do not exist
yet**. When asked to do something that depends on a not-yet-built
capability:

1. Confirm by checking the file does not exist.
2. Tell the user which phase delivers it.
3. Offer to build that phase next instead of faking it.

Never produce specs that reference unavailable infrastructure as if it
worked.

## Style

- Be terse. The user is an engineer. Skip ceremonious preambles.
- Show the spec before deploying it on anything non-trivial.
- When iterating, report the diff between attempts, not the full spec each
  time.
- Save artifacts the user might want again. Discard scratch attempts.
