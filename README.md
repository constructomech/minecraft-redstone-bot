# Redstone Forge

> LLM-driven Minecraft Bedrock redstone contraption builder.

Describe a redstone contraption in natural language, and an LLM agent
designs it, builds it in your Bedrock world, and validates it works — using
a generic behavior pack and a local Bedrock Dedicated Server.

```text
You:    "Build me a T flip-flop with a button input and a lamp output."
Agent:  → drafts a ContraptionSpec
        → POSTs it to the Redstone Forge pack running on your BDS
        → drives the input, watches the output, iterates if tests fail
        → leaves a working contraption at your in-game build anchor
```

## How it works

```
┌──────────────────────┐    HTTP     ┌──────────────────────────────┐
│ Agent (this repo)    │ ──────────► │ Bedrock Dedicated Server     │
│  AGENTS.md + skills  │             │   Redstone Forge BP          │
│  generates spec JSON │ ◄────────── │   @minecraft/server          │
└──────────────────────┘   results   │   @minecraft/server-net      │
                                     │   @minecraft/server-admin    │
                                     └──────────────────────────────┘
                                                   ▲
                                                   │ in-game: /rsforge:anchor
                                                   │ player marks build origin
                                                   ▼
                                          Bedrock client (player)
```

1. A small **behavior pack** runs on a local **Bedrock Dedicated Server**.
   It exposes a tiny HTTP API (`/build`, `/test`, `/undo`, `/world`, …).
2. You join the server from your Bedrock client, face an empty area, and
   run `/rsforge:anchor` to mark the build origin.
3. From a terminal in this repo, you ask an LLM agent — opencode, VSCode +
   Copilot, GitHub Copilot CLI, or any other coding agent that reads
   `AGENTS.md` and skills — to build something.
4. The agent emits a `ContraptionSpec` JSON, POSTs it, then runs the spec's
   declared tests. If they fail, it inspects the world and iterates.

## Status

Phase 1. The behavior pack scaffold and a `/rsforge:hello` sanity-check
custom command are working end-to-end. The HTTP transport, build/test
endpoints, and the LLM-driven loop land in subsequent phases. See
[PLAN.md](PLAN.md) for the full phased roadmap and exit criteria.

## Requirements

- Windows (PowerShell 7+). Linux/macOS support is on the roadmap.
- A Minecraft Bedrock client to actually see the builds.
- A coding agent that reads `AGENTS.md` and project-local skills:
  - **opencode** (`opencode.json` ships preconfigured to load
    `.agents/skills/`)
  - **VSCode + GitHub Copilot** or **GitHub Copilot CLI** (read
    `AGENTS.md` by convention).
- ~200 MB of disk for the BDS install.

You do **not** need a paid Realms subscription or a Microsoft account on
the server side — BDS runs locally.

## Quick start

```pwsh
# 1. Install the latest Bedrock Dedicated Server.
pwsh tools/bds-install.ps1

# 2. Boot once so BDS generates its default world, then stop with 'stop'
#    at the server prompt or Ctrl+C.
pwsh tools/bds-run.ps1

# 3. Install build deps and deploy the Redstone Forge behavior pack.
#    Bundles pack/src -> pack/scripts, copies into BDS, enables on the
#    world, and flips the Beta APIs experiment on level.dat.
npm install
npm run deploy

# 4. Boot again with the pack loaded.
pwsh tools/bds-run.ps1
```

Connect from your Bedrock client to `127.0.0.1:19132` and run
`/rsforge:hello` — a stone block should appear at your feet+1.

If the BDS download resolution fails (Mojang occasionally moves the
endpoint), the install script falls back through several sources — see
the [`bds-setup`](.agents/skills/bds-setup/SKILL.md) skill or
[`tools/bds-bootstrap.md`](tools/bds-bootstrap.md) for the full fallback
chain and a manual-URL escape hatch.

## Repo layout

```
AGENTS.md                  # operating manual the agent reads every session
PLAN.md                    # phased roadmap (decisions, deliverables, exits)
opencode.json              # registers .agents/skills with opencode
package.json               # build tooling (esbuild) + @minecraft/server types
.agents/skills/            # skill docs (auto-discovered by opencode and friends)
pack/                      # behavior pack source (Phase 1+)
  ├── manifest.json
  ├── src/                 # TypeScript source
  ├── scripts/             # bundled output (gitignored)
  └── tsconfig.json
tools/                     # PowerShell + Node helpers
  ├── bds-install.ps1      # download + install BDS
  ├── bds-run.ps1          # launch the installed BDS
  ├── enable-experiments.mjs   # NBT-edit level.dat to enable Beta APIs
  ├── pack-build.mjs       # esbuild bundle
  └── pack-deploy.ps1      # copy pack to BDS, enable on world
specs/                     # saved ContraptionSpec JSON (Phase 3+)
patterns/                  # reusable sub-contraptions (Phase 6)
test/                      # host-side unit tests (Node, no Minecraft)
```

## Cross-tool conventions

This repo follows the `AGENTS.md` + `.agents/skills/<name>/SKILL.md`
convention so it works with multiple coding agents without per-tool config.
The single `opencode.json` at the root only tells opencode to scan
`.agents/skills/` (its default would be `.opencode/skills/`).

## License

[MIT](LICENSE)

Minecraft and the Bedrock Dedicated Server are trademarks of Mojang Studios /
Microsoft. This project is not affiliated with or endorsed by Mojang or
Microsoft. Use of the Bedrock Dedicated Server is governed by the
[Minecraft EULA](https://www.minecraft.net/en-us/eula).
