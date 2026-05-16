---
name: building-contraptions
description: Use as the end-to-end recipe whenever the user asks for a new contraption. Covers the full operating loop — understand request, check pattern library, design, draft ContraptionSpec, validate locally, POST /build (with dryRun for large footprints), POST /test, iterate on failures up to the configured cap, persist spec to specs/. This is the workflow the canonical loop in AGENTS.md references in detail.
---

# building-contraptions

The canonical workflow for "user describes a contraption, agent
delivers a working build."

> Status: stub. Fills in during Phase 5.

## Intended scope

The expanded version of the operating loop sketched in `AGENTS.md`,
with concrete commands, decision points, and failure modes for each
step.

Planned sections:

1. **Understand.** Restating the request; what to ask when something
   is ambiguous (cross-reference `designing-contraptions`).
2. **Reuse.** How to search `patterns/`; what counts as a match;
   when "close enough" requires adaptation vs starting fresh.
3. **Design + draft.** Producing the spec JSON; cross-reference
   `contraption-spec-format` and `redstone-components-reference`.
4. **Validate locally.** Running
   `node tools/forge.ts validate <spec>.json`. Common validation
   errors and their fixes.
5. **Build.** `POST /build`. When to set `dryRun: true` (footprint >
   500 blocks, by default). Reading the response. Surfacing the
   `jobId` so the user can `/rsforge:undo` it.
6. **Test.** `POST /test`. Reading the result table.
7. **Iterate.** On failure, fetch `GET /world?bounds=...`, diff
   against intent, refine, re-deploy. Cross-reference
   `debugging-contraptions`. Hard cap: 5 iterations by default.
8. **Persist.** Save to `specs/<kebab-name>.json`. Final report to the
   user: footprint, ports, test results, jobId.
9. **Stopping conditions.** When to give up and ask the user
   (capability gap, ambiguous behavior, repeated failure on the same
   test).
