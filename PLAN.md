# Redstone Forge — Plan

A tool that turns natural-language descriptions of Minecraft Bedrock redstone
contraptions into working in-world builds, driven by an LLM coding agent.

## Architectural decision: HTTP + Bedrock Dedicated Server

We will run a Bedrock Dedicated Server (BDS) locally with a generic
"Redstone Forge" behavior pack. The agent talks to the pack over HTTP.

Why:

- **`@minecraft/server-net` only works on a Bedrock Dedicated Server.** Any
  HTTP at all forces dedicated, so the real choice is "HTTP+BDS" vs
  "no HTTP, addon embeds everything."
- **The agent needs a tight feedback loop.** Build → test → read world →
  adjust. Without HTTP the agent must regenerate and re-ship a behavior pack
  every iteration (write `.mcpack`, reload world, re-run): ~30s per loop.
  Over HTTP it's ~50ms.
- **The pack stays generic and reusable.** One pack, many contraptions.
  Players never repack anything.
- **Deterministic validation.** The agent can drive inputs and read outputs
  over HTTP with timeouts, instead of bundling one-shot Script API tests.

Costs we accept:

- The user must install Bedrock Dedicated Server (Windows binary from Mojang)
  once.
- `@minecraft/server-net` requires allowlisting in `permissions.json` plus a
  small admin-config file — boilerplate, but documented.
- BDS only runs one world; the agent and the player operate on the same world.

A future embedded-spec fallback pack (no HTTP) could reuse the same
`ContraptionSpec` format, but we are not building that now.

## High-level architecture

```
┌─────────────────┐    HTTP    ┌────────────────────┐    HTTP    ┌─────────────────┐
│ Agent / CLI     │ ─────────► │ forge daemon       │ ◄────────  │ pack (BDS)      │
│ tools/forge.mjs │            │ tools/forge.mjs    │  outbound  │ heartbeats /    │
└─────────────────┘            │ 127.0.0.1:33000    │  only      │ command poll    │
                               └────────────────────┘            └─────────────────┘
```

`@minecraft/server-net` in current Bedrock supports **only outbound**
HTTP/WebSocket — there is no `HttpServer` / `listen` / `onRequest`
surface (verified by reading the d.ts of
`@minecraft/server-net@1.0.0-beta.1.26.21-stable`). So the pack cannot
be the HTTP server directly. Instead:

- A small **forge daemon** (Node, `tools/forge.mjs`) runs on the host,
  exposes the HTTP API on `127.0.0.1:33000` for the agent and the CLI,
  and brokers between agent requests and pack state.
- The **pack** acts as an outbound HTTP client. It heartbeats its state
  (anchor, version, etc.) to the daemon and (Phase 3+) long-polls for
  queued commands.
- The **agent / CLI** talks to the daemon over HTTP with bearer auth.

The bearer token and daemon endpoint are stored on the pack side via
`@minecraft/server-admin` (`config/<pack-uuid>/variables.json` and
`secrets.json`); on the host side they live in `.env`. `pack-deploy.ps1`
generates the token if missing and writes it to both locations so they
stay in sync.

Runtime flow:

1. Player joins the BDS world, faces an empty area, runs
   `/rsforge:anchor` (or hits a marker with a custom item). Pack stores
   anchor `{dimension, pos, facing}` in a world dynamic property and
   includes it in the next heartbeat to the forge daemon.
2. User opens the agent in this directory and says
   *"build me a 4-bit binary adder."*
3. Agent (driven by `AGENTS.md` + skills) produces a `ContraptionSpec`
   JSON.
4. Agent `POST /build` to the forge daemon. The daemon queues the
   command; the pack picks it up on its next long-poll, snapshots the
   region (for undo), places blocks relative to the anchor with rotation
   applied, and POSTs the result back.
5. Agent `POST /test` for each declared test case. Daemon ↔ pack
   round-trip drives input blocks, runs ticks, reads output blocks,
   returns pass/fail with observed values.
6. On failure, agent reads `GET /world?bounds=...` (cached snapshot
   collected by pack heartbeat), diffs against intent, edits the spec,
   redeploys. Loops up to a configured iteration cap.
7. User sees a working contraption and can `/rsforge:undo` in-game.

## Cross-tool convention: `AGENTS.md` + `.agents/skills/`

To stay compatible with opencode, VSCode, and GitHub Copilot CLI without
per-tool config tweaks, instructions live at the conventional paths:

- `AGENTS.md` at the repo root — top-level operating manual.
- `.agents/skills/<skill-name>/SKILL.md` — discrete skill documents.

opencode does not auto-scan project-local `.agents/skills/` (it auto-scans
`.opencode/skills/` and `~/.agents/skills/`). We bridge that with a one-line
`opencode.json` in this repo that registers `.agents/skills` as a skill path.
The file lives in the repo, so it still counts as "zero edits" for any
collaborator who clones it.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "skills": { "paths": [".agents/skills"] }
}
```

## Repo layout (target)

```
.
├── AGENTS.md                              # top-level operating manual for the agent
├── PLAN.md                                # this file
├── README.md                              # user-facing setup + usage
├── opencode.json                          # registers .agents/skills
├── .agents/skills/
│   ├── bds-setup/SKILL.md                 # acquire + install + run Bedrock Dedicated Server
│   ├── redstone-fundamentals/SKILL.md
│   ├── bedrock-script-api/SKILL.md
│   ├── contraption-spec-format/SKILL.md
│   ├── redstone-components-reference/SKILL.md
│   ├── designing-contraptions/SKILL.md
│   ├── building-contraptions/SKILL.md     # the end-to-end workflow
│   ├── debugging-contraptions/SKILL.md
│   ├── contraption-testing/SKILL.md
│   └── pattern-library/SKILL.md
├── pack/                                  # the behavior pack source (TypeScript)
│   ├── manifest.json
│   ├── pack_icon.png
│   ├── config/                            # @minecraft/server-admin variables (Phase 2)
│   │   ├── default/variables.json
│   │   └── default/permissions.json
│   ├── scripts/                           # compiled JS lands here
│   ├── src/
│   │   ├── main.ts                        # entrypoint, wires modules
│   │   ├── http/server.ts                 # HTTP listener + routes
│   │   ├── http/routes/*.ts               # /build, /test, /world, /clear, /anchor
│   │   ├── world/anchor.ts                # anchor state, custom commands
│   │   ├── world/builder.ts               # spec → block placements
│   │   ├── world/transform.ts             # rotation/mirror math
│   │   ├── world/snapshot.ts              # undo support
│   │   ├── spec/schema.ts                 # ContraptionSpec types + validator
│   │   ├── spec/components.ts             # redstone component metadata
│   │   ├── test/runner.ts                 # input/wait/output engine
│   │   ├── test/probes.ts                 # readers for lamps/pistons/comparators/observers
│   │   └── util/log.ts
│   ├── package.json
│   └── tsconfig.json
├── tools/
│   ├── pack-build.mjs                     # bundles pack/src/ → pack/scripts/ via esbuild
│   ├── pack-deploy.ps1                    # copies pack to BDS, enables on world, ensures experiments
│   ├── bds-install.ps1                    # downloads + extracts latest BDS, scaffolds a world
│   ├── bds-run.ps1                        # starts the installed BDS
│   ├── enable-experiments.mjs             # flips the gametest (Beta APIs) experiment in level.dat
│   ├── forge.ts                           # host-side CLI: health, anchor, build, test (Phase 2+)
│   └── bds-bootstrap.md                   # one-page "install BDS, install pack" guide
├── specs/                                 # saved ContraptionSpec JSON examples
│   └── examples/...
├── patterns/                              # reusable sub-specs (T flip-flop, clock, etc.)
│   └── ...
└── test/                                  # host-side unit tests (Node, no Minecraft)
    ├── transform.test.ts
    └── spec-validator.test.ts
```

## The `ContraptionSpec` data model (core contract)

This is the single most important artifact — it is what the agent emits and
what the pack consumes. Sketch:

```jsonc
{
  "name": "t-flip-flop",
  "version": 1,
  "footprint": { "size": [5, 3, 7] },      // local bounding box (x,y,z)
  "anchor": "player-facing",                // or "absolute"
  "blocks": [
    { "at": [0,0,0], "id": "minecraft:lever",     "states": { "lever_direction": "north" } },
    { "at": [1,0,0], "id": "minecraft:redstone_wire" },
    { "at": [2,0,0], "id": "minecraft:repeater",  "states": { "direction": 1, "repeater_delay": 0 } }
    // ...
  ],
  "ports": {
    "inputs":  { "toggle": { "at": [0,0,0], "kind": "lever" } },
    "outputs": { "q":      { "at": [4,0,0], "kind": "lamp"  } }
  },
  "tests": [
    { "name": "toggle flips q",
      "steps": [
        { "set": "toggle", "to": "on"  },
        { "wait_ticks": 4 },
        { "expect": { "q": "on"  } },
        { "set": "toggle", "to": "off" },
        { "wait_ticks": 4 },
        { "expect": { "q": "on"  } },     // stays
        { "set": "toggle", "to": "on"  },
        { "wait_ticks": 4 },
        { "expect": { "q": "off" } }
      ]
    }
  ]
}
```

Rotation: with `anchor: "player-facing"` the pack rotates the layout so
`+x local` maps to whatever direction the player was facing when they set
the anchor. Block states with directionality (repeaters, observers, pistons,
levers, buttons) get rotated too. This is where `world/transform.ts` earns
its keep, and where most of our host-side unit tests live.

## Phased plan

### Phase 0 — Decisions & scaffolding (small)

Deliverables:

- This `PLAN.md` committed (done).
- `README.md` with one-paragraph project summary and a pointer to
  `tools/bds-bootstrap.md`.
- `AGENTS.md` with the project's north star and hard rules
  (e.g. "do not invent block IDs; emit only IDs listed in
  `pack/src/spec/components.ts`").
- `opencode.json` registering `.agents/skills`.
- `.agents/skills/<name>/SKILL.md` stubs (frontmatter only) for every skill
  named in the layout above.
- **BDS acquisition + install automation.** The agent should be able to set
  up a working server from scratch without the user fishing around on
  minecraft.net:
  - `tools/bds-install.ps1` resolves the latest BDS download. The preferred
    path is the JSON endpoint
    `https://net-secondary.web.minecraft-services.net/api/v1.0/download/links`
    (the same one the official download page calls): pick the
    `serverBedrockWindows` (or `serverBedrockLinux`) entry and grab its
    `downloadUrl`. The User-Agent header must look like a real browser or
    the endpoint 403s.

    Because that endpoint isn't a contractual public API and Mojang has
    moved it before, the script implements a **fallback chain** and the
    `bds-setup` skill documents the same chain so the agent can recover
    when the script fails:

    1. JSON endpoint above.
    2. Scrape `https://www.minecraft.net/en-us/download/server/bedrock`
       for the first `https://www.minecraft.net/bedrockdedicatedserver/...zip`
       link.
    3. Try the `minecraft-wiki`-tracked archive list
       (`https://minecraft.wiki/w/Bedrock_Dedicated_Server`) which usually
       lists the current version and direct link.
    4. As a last resort, the script and the skill both prompt the user to
       paste a download URL manually. The agent should ask the user before
       guessing.

    Each step records *which* source succeeded so we can tell when the
    primary path breaks.
  - Script downloads the ZIP to a cache dir, verifies the size, extracts to
    a user-chosen install dir (default
    `%LOCALAPPDATA%\RedstoneForge\bds\<version>\`), and writes a small
    `version.txt` so subsequent runs can detect upgrades.
  - It then patches `server.properties` for a creative-mode dev
    experience (`gamemode=creative`, `difficulty=peaceful`,
    `allow-cheats=true`, `online-mode=false`, `max-players=4`,
    `server-name=Redstone Forge Dev`). Note: Bedrock has no
    `level-type` / generator key in `server.properties` (that's
    Java-only), so we don't try to set one — the world generator is
    fixed at world-creation time. BDS-level `permissions.json` is
    edited in Phase 1 once we have a pack UUID.
  - `tools/bds-run.ps1` launches the installed server, attached so logs go
    to the terminal.
  - First-run UX: the user runs one command
    (`pwsh tools/bds-install.ps1`) and then `pwsh tools/bds-run.ps1`. The
    agent can perform both itself when asked to "set up the server".
- Skill: `bds-setup/SKILL.md` — how the agent acquires the latest BDS, the
  download-URL endpoint above, license/EULA acknowledgment requirements,
  required `permissions.json` entries, how to detect an existing install
  and upgrade it, troubleshooting (Windows Defender / SmartScreen, port
  conflicts, the `LevelDB` lock when two servers race for the same world).
- `tools/bds-bootstrap.md` becomes a human-readable mirror of the
  `bds-setup` skill: same content, written for a person reading it without
  the agent.

Exit criteria: opencode starts in this directory, lists the new skills, and
`AGENTS.md` loads. Running `pwsh tools/bds-install.ps1` produces a working
BDS install in the chosen directory; `pwsh tools/bds-run.ps1` boots it.
No in-game behavior from our pack yet.

### Phase 1 — Behavior pack skeleton ("hello block")

Deliverables:

- `pack/manifest.json` declaring `script` plus a `header` UUID and module
  UUIDs, with dependencies on `@minecraft/server` and `@minecraft/server-net`.
- TypeScript + esbuild build: `tools/pack-build.ts` bundles `src/main.ts` to
  `scripts/main.js`.
- `tools/pack-deploy.ps1`: copies `pack/` to
  `%LOCALAPPDATA%\RedstoneForge\bds\<version>\development_behavior_packs\redstone-forge\`
  and enables it on the world by appending the pack's header UUID to
  `worlds/<level-name>/world_behavior_packs.json`.
- `main.ts` registers a custom command `/rsforge:hello` via
  `system.beforeEvents.startup` → `customCommandRegistry.registerCommand`
  that places a single stone block at the player's feet+1, proving the
  toolchain end-to-end. (Custom commands require Script API beta
  channel; stable 2.7.0 does not include them.)
- Skill: `bedrock-script-api/SKILL.md` — Script API basics, coordinate
  system, block placement, custom command registration, common pitfalls
  (read-only callback contexts, tick budget, beta-vs-stable channel).

Phase 1 does **not** touch the BDS-root `permissions.json`.
`@minecraft/server` is in the default allowed-modules list. The
pack-level `permissions.json` we originally planned does not exist in
current Bedrock spec — modules are declared in `manifest.json`
`dependencies` and gated by the BDS-root `permissions.json` per pack.
We grant `@minecraft/server-net` and `@minecraft/server-admin` to our
pack UUID in Phase 2.

Phase 1 **does** require the Beta APIs (`gametest`) experiment on the
world, because `CustomCommandRegistry` only exists on the beta channel
of `@minecraft/server`. `tools/enable-experiments.mjs` flips the NBT
flag and `pack-deploy.ps1` calls it automatically. See the
`bds-setup` and `bedrock-script-api` skills for the why.

Exit criteria: user joins the BDS world, runs `/rsforge:hello`, and
sees a stone block appear at their feet+1. BDS startup log shows
`[Scripting] [rsforge] startup: registered /rsforge:hello` and
`Experiment(s) active: gtst`.

### Phase 2 — Anchor + outbound HTTP + forge daemon

Architecture note: `@minecraft/server-net` is outbound-only, so the
pack cannot serve HTTP directly. We split this phase between a
host-side daemon (the new HTTP API) and the pack's outbound client.

Deliverables:

**Pack side:**

- `/rsforge:anchor` command: stores `{dimension, pos, facing}` in
  memory and as a world dynamic property so it survives reloads.
  Sub-commands `clear` and `show` (the latter spawns a particle
  marker for N seconds).
- `manifest.json` adds `@minecraft/server-net` and
  `@minecraft/server-admin` to `dependencies`.
- `pack/config/<script-module-uuid>/variables.json` (deployed by
  `pack-deploy.ps1`): the daemon endpoint URL.
- `pack/config/<script-module-uuid>/secrets.json` (also deployed):
  the bearer token.
- Outbound HTTP client (`pack/src/transport.ts`) that POSTs a
  heartbeat to the daemon every ~2s carrying current anchor +
  pack version, with the bearer token in an `Authorization` header.
- Reconnect/retry logic: heartbeat failures are logged and retried;
  the pack never crashes if the daemon is down.

**Host side:**

- `tools/forge.mjs` daemon mode: HTTP server on `127.0.0.1:33000`
  (port + token from `.env`). Caches the latest pack heartbeat.
- Routes:
  - `POST /heartbeat` (from pack, bearer-protected): update cache.
  - `GET  /health` (from agent, bearer-protected): `{ ok, anchor, lastHeartbeat, packVersion }`.
  - `GET  /anchor` (from agent): current anchor or `null`.
  - `POST /echo` (from agent): round-trip the body.
- `tools/forge.mjs` CLI mode: `forge health`, `forge anchor`,
  `forge echo <message>` — reads `.env` for token + URL, prints the
  daemon response.

**Plumbing:**

- `pack-deploy.ps1` now also:
  - Generates a token (random hex) on first deploy, writes it to
    `.env` (host side) AND `pack/config/<script-uuid>/secrets.json`
    (pack side), so the same secret is on both ends.
  - Writes `pack/config/<script-uuid>/variables.json` with the
    daemon URL (`http://127.0.0.1:33000`).
  - Patches the BDS-root `permissions.json` to grant our pack's
    script-module UUID access to `@minecraft/server-net` and
    `@minecraft/server-admin`.
- Skill: `contraption-spec-format/SKILL.md` — transport + auth
  contract (the request/response shape we use). Full spec format
  comes in Phase 3.

Exit criteria: from this directory,
`node tools/forge.mjs health` reports
`{ ok: true, anchor: {...} | null, lastHeartbeat: <iso> }` while BDS
is running with the pack. Setting/clearing the anchor in-game shows
up in the next heartbeat within ~2 seconds.

### Phase 2.5 — Autonomous self-test harness

Out-of-band phase inserted between Phase 2 and Phase 3. Goal: let the
agent verify end-to-end flows without needing the user to join the
world and run commands. The agent's iteration loop in Phase 3+ would
otherwise be gated on human turnaround for every test cycle.

Approach: server-source `/scriptevent` commands invoked over BDS's
stdin. `scriptevent` runs as `Server` source (no player required) and
the BDS console accepts commands typed to stdin, so we can drive the
pack from a parent Node process. Player-required flows (chat-issued
custom commands, visible particles, etc.) still need the user; this
covers everything else.

Deliverables:

- `pack/src/debug.ts`: scriptevent handlers, only active when
  `variables.get("debug_enabled") === true`:
  - `rsforge:debug_setanchor` payload `"<x> <y> <z> <facing> [dim]"`
    — sets the anchor at explicit coords (server source has no
    player position to use).
  - `rsforge:debug_clearanchor`.
  - `rsforge:debug_state` — logs the current anchor JSON to BDS
    console so the harness can read it back from stdout if needed.
- `pack-deploy.ps1`: emit `debug_enabled: true` in the per-pack
  `variables.json` so debug is on by default in development.
- `tools/bds-control.mjs`: a `BdsProcess` class wrapping
  `spawn(bedrock_server.exe, …)` with stdin + stdout pipes and:
  - `start()` — spawn and wait for `Server started.`
  - `send(cmd)` — write a command to stdin
  - `waitForLog(regex, opts)` — resolve when matching line appears
  - `stop()` — send `stop\n` to stdin, wait for clean exit
  - `getLog()` — captured stdout so far, for diff on failure
- `tools/selftest.mjs`: end-to-end orchestrator. Spawns daemon and
  BDS, waits for pack registration, fires test scriptevents, queries
  the forge CLI/API, asserts state matches expectations, tears
  everything down. Prints `[PASS] / [FAIL]` lines and exits non-zero
  if anything failed. Designed to be run repeatedly by the agent
  during Phase 3+ iteration.
- New skill: `self-testing/SKILL.md` (or merged into a related
  skill) so future agent sessions know to use the harness instead of
  asking the user to join the world for every test.

Exit criteria: `node tools/selftest.mjs` completes with all checks
green from a clean repo state, without any human interaction beyond
starting the script.

### Phase 3 — Spec schema + builder

Status: **landed** as a tight MVP. Rotation, ports, tests, in-game
undo/redo, and `/redo`/`/history` HTTP routes are deferred to Phase 4
(see below) so this phase could ship behind a working selftest in one
working session.

Deliverables (Phase 3 scope, as built):

- `pack/src/spec/components.ts`: allow-list of 17 block IDs and their
  state keys, captured empirically via `tools/discover-states.mjs`.
- `pack/src/spec/schema.ts`: `ContraptionSpec` types + hand-rolled
  validator. Pure data, safe in any context. Phase 3 supports
  `anchor: "absolute"` only and rejects `"player-facing"` with a
  clear "lands in Phase 4" message.
- `pack/src/world/snapshot.ts`: capture/restore for a list of block
  positions. In-memory snapshots; restart-loss is acceptable (Phase 7
  polish for persistence).
- `pack/src/world/builder.ts`: `planPlacements`, `executeBuild`.
  Anchor-absolute coords only; snapshots the pre-build state before
  any `setBlockPermutation` call.
- `pack/src/jobs.ts`: in-memory job store for `/undo` lookup.
- `pack/src/dispatcher.ts`: routes `build` and `undo` commands from
  the pack's poll loop to the right handler; returns structured
  results.
- `pack/src/transport.ts`: extended with a 5-tick (250ms) poll loop
  (`runTimeout` chain — no overlapping iterations) that fetches
  pending commands from the daemon, runs them through the dispatcher,
  and POSTs results back.
- `tools/forge.mjs` daemon: command queue + `POST /build`,
  `POST /undo`, `POST /poll`, `POST /result`. Agent requests block
  up to 30s waiting for the pack to return a result; `awaitingResults`
  Map keyed by jobId. Status code is `200` on success, `422` on
  pack-reported failure (validation, no anchor), `504` on timeout.
- `tools/forge.mjs` CLI: `forge build <spec.json>` and `forge undo
  [jobId]`.
- `pack/src/debug.ts`: extended with
  `rsforge:debug_place_and_dump`, `rsforge:debug_blockat` scriptevents
  for verifying builds without a player.
- `tools/discover-states.mjs`: dev-time tool that places each
  candidate block in a ticking-area chunk and dumps actual states for
  copying into the components table.
- `specs/examples/lever-wire-lamp.json`: the canonical Phase 3
  worked example.
- Skills `redstone-components-reference` and
  `contraption-spec-format` populated with the actual schema as built.

Exit criteria: agent posts a 3-block spec (lever → wire → lamp) via
`POST /build`, blocks appear at the anchor location, `POST /undo`
restores the prior block state exactly (verified via
`rsforge:debug_blockat`).

**Verified end-to-end in `npm run selftest`** — 31 of 31 checks PASS
including pre-build clean state, build with the correct blocks,
snapshot-precise undo, validation rejection, and "no anchor set"
rejection.

### Phase 4a — Rotation (player-facing anchor)

Status: **landed**. The orientation pain from Phase 3 is resolved.
A spec with `anchor: "player-facing"` now lands "in front of the
player" regardless of which cardinal direction they were facing
when they set the anchor.

Deliverables (as built):

- `pack/src/world/transform.ts`: pure rotation math, no imports.
  Functions: `rotationForFacing`, `rotatePosition`, `rotateCardinal`,
  `rotateAxis6`, `rotateTorchMount`, `rotateLeverMount`,
  `rotateFacingInt`, `rotateDirectionInt`, `rotateStateValue` (kind
  dispatcher), `rotateStates` (batch). `-0` normalized to `+0` so
  deepEqual is well-behaved.
- `pack/src/spec/components.ts`: each directional state key tagged
  with a `RotationKind` (`cardinal | axis6 | torch_mount |
  lever_mount | facing_int | direction_int`) on a new
  `stateRotations` map per component.
- `pack/src/world/builder.ts`: `planPlacements` picks the rotation
  step from `rotationForFacing(anchor.facing)` when the spec uses
  `"player-facing"`, then rotates positions and per-block state
  values before calling `BlockPermutation.resolve`. `BuildResult`
  surfaces `rotationSteps` so the agent can log/verify.
- `pack/src/spec/schema.ts`: stops rejecting `"player-facing"`.
- `test/transform.test.ts`: 35 host-side `node:test` truth-table
  assertions covering every rotation function and a full
  lever→wire→lamp position round-trip. `npm test` (~10ms).
- `tools/selftest.mjs` extension: builds the example spec at all
  four cardinal facings and asserts every block lands at the
  expected absolute coordinate.
- `specs/examples/lever-wire-lamp.json`: switched to
  `anchor: "player-facing"` so the canonical example does the
  right thing by default.

Exit criteria: same 3-block lever→wire→lamp spec, built at all 4
cardinal facings, places its blocks in front of the player every
time. **Verified via `npm run selftest`** — 47 of 47 checks pass.

### Phase 4b — Ports + tests + operational polish

What was originally bundled into Phase 4 alongside rotation. Pushed
to its own phase to keep 4a tight.

Deliverables:

- `pack/src/spec/ports.ts` (or schema.ts extension): named
  `ports.inputs` (lever, button, pressure_plate, redstone_block)
  and `ports.outputs` (lamp, piston, comparator, observer) with
  their positions. Required for any `tests` to address them.
- `pack/src/world/probes.ts`: readers for each output kind — lamp
  on/off (`redstone_lamp` vs `lit_redstone_lamp`), piston extension
  (check head block at facing offset), comparator `output_signal`
  analog, observer pulse (sample over a window).
- `pack/src/test/runner.ts`: executes a test's steps using
  `system.runTimeout` for `wait_ticks`. For `set` actions: lever
  toggles via state mutation; button "press" via brief
  redstone-block placement; redstone-block toggles for analog inputs.
- Daemon: `POST /test` body = `{ specRef | spec, testName?: string }`
  → `{ results: [{ name, pass, observed, expected, error? }] }`.
- Daemon: `POST /redo` body = `{ jobId? }` → replays the most recently
  undone build.
- Daemon: `GET /world?bounds=[x1,y1,z1,x2,y2,z2]` → compact dump of
  block IDs and key states for debugging.
- In-game slash commands wired to the pack-side job store (which the
  daemon's `/undo` already drives):
  - `/rsforge:undo [jobId]`
  - `/rsforge:redo [jobId]`
  - `/rsforge:history`
- Skill: `contraption-testing/SKILL.md` — how to phrase `tests`, why
  we wait N ticks, how to detect race conditions.
- Selftest extension: build an AND-gate spec with a `tests` block,
  run `POST /test`, assert all named cases PASS.

Exit criteria: a saved spec for "AND gate" with `anchor:
"player-facing"` and a `tests` block passes via `POST /test`, and a
deliberately broken spec fails with the right `observed` values.

### Phase 5 — Agent operating loop

Deliverables:

- `AGENTS.md` fully populated, with the canonical loop:
  1. Read the user request.
  2. Check the pattern library (`patterns/`) for a match or near-match.
  3. Draft a `ContraptionSpec` using only IDs from
     `pack/src/spec/components.ts`.
  4. Validate the spec locally
     (`node tools/forge.ts validate <spec>.json`).
  5. `POST /build` with `dryRun: true` first if the footprint exceeds
     a configured block-count threshold.
  6. `POST /test`. If all pass: stop. If not: read diff via
     `GET /world`, refine, redeploy, capped at K iterations.
  7. Report to the user with the final spec saved under `specs/`.
- Skill: `designing-contraptions/SKILL.md` — decomposition heuristics:
  inputs, outputs, logic; pick a topology (combinational vs sequential vs
  timed); choose orientation.
- Skill: `building-contraptions/SKILL.md` — the operating loop, self-prompts,
  when to give up and ask the user.
- Skill: `debugging-contraptions/SKILL.md` — how to read a failing test,
  common failure modes (wire crossings, repeater direction wrong, timing too
  tight), what to ask the player.
- Skill: `redstone-fundamentals/SKILL.md` — the actual redstone knowledge:
  signal strength, 15-block decay, repeater locking, observer behavior,
  piston rules, BUD, tile-tick ordering at a level the agent can reason from.

Exit criteria: from a clean session, the prompt *"build a 2-input XOR with
two lever inputs on the south face and a lamp output on the north face"*
produces a working contraption with passing tests in ≤3 build iterations.

### Phase 6 — Pattern library

Deliverables:

- `patterns/` populated with vetted sub-specs: T flip-flop, RS latch,
  D latch, 1-tick clock, slow clock, edge detector, half/full adder, 4-bit
  adder, decoder, 7-seg driver, basic memory cell.
- Spec format supports `"includes": ["patterns/t-flip-flop.json"]` with a
  local origin offset, so the agent can compose patterns into larger builds.
- Skill: `pattern-library/SKILL.md` — index of patterns, ports/footprints,
  when to pick which.

Exit criteria: agent answers *"build a counter that increments on a button
press"* by composing `edge-detector` + `4-bit-adder` + memory cells from the
library.

### Phase 7 — UX polish

Deliverables:

- `/rsforge:remove <name>` (named-build removal, beyond the
  `/rsforge:undo` / `/rsforge:redo` / `/rsforge:history` trio that shipped
  in Phase 3).
- Per-build job IDs surfaced more prominently to the player
  ("Built `t-flip-flop` (job 7), `/rsforge:undo 7` to remove").
- Footprint preview: glass or structure-void outline drawn for N seconds
  before placement.
- Optional: a custom "anchor wand" item registered via the pack so the
  player can right-click to set the anchor instead of typing the command.
- `README.md` and `tools/bds-bootstrap.md` finalized; optional 60-second
  screen-recording walkthrough referenced from the README.

Exit criteria: a new user can go from "I have Minecraft Bedrock installed"
to "I built a working contraption from an LLM prompt" in under 15 minutes by
following the README.

## Open questions before we start

1. **Pack tooling:** esbuild bundling, or Mojang's recommended Webpack
   template? Default: esbuild for speed and simplicity.
2. **Scope of supported blocks:** start with the core 12 (wire, repeater,
   comparator, lever, button, pressure plate, observer, piston, sticky
   piston, redstone block, redstone torch, redstone lamp) plus solid filler
   blocks? Or aim wider day-one? Default: core 12 + filler.
3. **Validation strictness:** should `/build` reject a spec containing block
   IDs not in our components table, or warn? Default: reject.
4. **Multi-player:** assume single-player BDS for now (one anchor) or
   namespace anchors per player from day one? Default: one anchor.

If these defaults are acceptable, Phase 0 kicks off next.
