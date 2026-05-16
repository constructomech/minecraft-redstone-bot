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

Phase 0. The plan, skills scaffolding, and BDS install automation are
landing; the behavior pack itself does not exist yet. See [PLAN.md](PLAN.md)
for the full phased roadmap and exit criteria.

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

> Until the behavior pack ships in Phase 1, this gets you a running
> Bedrock Dedicated Server. The rest of the loop lands phase-by-phase.

```pwsh
# Install the latest Bedrock Dedicated Server to %LOCALAPPDATA%\RedstoneForge\bds\
pwsh tools/bds-install.ps1

# Boot it
pwsh tools/bds-run.ps1
```

Then in your Bedrock client, add a "Server" with address `127.0.0.1` and
port `19132` and connect.

If the download resolution fails (Mojang occasionally moves the endpoint),
the script falls back through several sources — see the
[`bds-setup`](.agents/skills/bds-setup/SKILL.md) skill or
[`tools/bds-bootstrap.md`](tools/bds-bootstrap.md) for the full fallback
chain and a manual-URL escape hatch.

## Repo layout

```
AGENTS.md                  # operating manual the agent reads every session
PLAN.md                    # phased roadmap (decisions, deliverables, exits)
opencode.json              # registers .agents/skills with opencode
.agents/skills/            # skill docs (auto-discovered by opencode and friends)
pack/                      # (Phase 1+) behavior pack source — TypeScript
tools/                     # PowerShell + Node helpers; BDS install + CLI
specs/                     # saved ContraptionSpec JSON
patterns/                  # (Phase 6) reusable sub-contraptions
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
