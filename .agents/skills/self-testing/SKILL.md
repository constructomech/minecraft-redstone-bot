---
name: self-testing
description: Use whenever you need to verify pack behavior end-to-end without asking the user to join the world. Covers tools/selftest.mjs (the orchestrator), tools/bds-control.mjs (the BdsProcess wrapper), the rsforge:debug_* scriptevents used to drive the pack from BDS stdin, the preflight requirements (no daemon, no bedrock_server.exe running), what's covered vs what still needs a player, and how to add new scenarios.
---

# self-testing

How to verify Redstone Forge end-to-end **without a player in the
world**. Use this every iteration of Phase 3+ so you don't burn user
turns on routine verification.

## The one command

```pwsh
npm run selftest
```

(or `node tools/selftest.mjs --verbose` to stream daemon + BDS logs)

Exits 0 on all checks green, non-zero on any failure. Takes ~8s on a
warm install.

What it does:

1. Preflights: port `33000` is free, no `bedrock_server.exe` is already
   running. Bails with a clear message if either is wrong (so you
   don't fight a leftover process).
2. Spawns the forge daemon (`node tools/forge.mjs daemon`) and waits
   for `listening on http://…`.
3. Spawns BDS via `BdsProcess` (stdin/stdout piped) and waits for
   `Server started.`
4. Verifies the pack registered commands, bootstrapped transport, and
   activated debug handlers.
5. Verifies a heartbeat reaches the daemon.
6. Resets the world's persisted anchor to `null` via
   `/scriptevent rsforge:debug_clearanchor`.
7. Sets an anchor via
   `/scriptevent rsforge:debug_setanchor <x> <y> <z> <facing> [dim]`
   and verifies it propagates through the heartbeat and shows up on
   the daemon's `/health` and `/anchor` endpoints within ~2 ticks.
8. Overrides with an explicit non-overworld dimension and verifies.
9. Clears the anchor and verifies.
10. Echo round-trip via the CLI.
11. Bad-token round-trip (expects 401).
12. Stops BDS via the `stop` console command (clean LevelDB shutdown).

## What's NOT covered (still needs a real player)

- Chat-issued custom commands (`/rsforge:hello`, `/rsforge:anchor`,
  `/rsforge:anchor_show`). These require `CustomCommandSource.Entity`
  with `sourceEntity`, which server-source can't supply. The
  scriptevent path is the workaround for testing the same underlying
  logic.
- Visible particles (the green column from `/rsforge:anchor_show`).
- Actual block placement at a player's location (Phase 3+ builds use
  the saved anchor so this becomes server-driven).

If you need any of these, ask the user. Everything else, use the
harness.

## Driving the pack from BDS console: the `rsforge:debug_*` scriptevents

Activated only when `variables.get("debug_enabled") === true`
(`pack-deploy.ps1` sets this in the per-pack `variables.json`):

| scriptevent                        | payload                          | effect                                            |
| ---------------------------------- | -------------------------------- | ------------------------------------------------- |
| `rsforge:debug_setanchor`          | `<x> <y> <z> <facing> [dim]`     | set anchor at explicit coords                     |
| `rsforge:debug_clearanchor`        | (none)                           | clear anchor                                       |
| `rsforge:debug_state`              | (none)                           | log current anchor JSON to BDS console            |

`facing` is one of `north | south | east | west`. `dim` defaults to
`minecraft:overworld`.

Server-source scriptevents from the BDS console run **with no
`sourceEntity`**. The handlers in `pack/src/debug.ts` therefore do
**not** rely on player location and take all coords from the payload.

To add a new debug scriptevent:

1. Add a handler branch to `handle()` in `pack/src/debug.ts`.
2. Use it from the harness via `bds.send("scriptevent rsforge:<your_id> <payload>")`.
3. Wait for an acknowledgement log line (or for the state change to
   land in the heartbeat).
4. Assert.

## Ad-hoc tests: using `BdsProcess` directly

`tools/bds-control.mjs` exports a `BdsProcess` class with the
minimum surface needed for one-off scripts:

```js
import { BdsProcess } from "./tools/bds-control.mjs";

const bds = new BdsProcess({ onLog: (line) => console.log(`[bds] ${line}`) });
await bds.start();                                  // waits for "Server started."
bds.send("scriptevent rsforge:debug_setanchor 10 65 -2 north");
await bds.waitForLog(/debug_setanchor: minecraft:overworld 10 65 -2 north/);
// ... assert ...
await bds.stop();                                   // clean LevelDB shutdown
```

`waitForLog(regex, { timeoutMs })` resolves on first match. The
process exits with `code=3221225477` (Windows access violation) if you
SIGKILL it mid-run — always prefer `stop()`.

## Common failure modes

| Symptom                                              | Cause / Fix                                                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `port 33000 is already in use`                       | A previous daemon is still running. `Stop-Process -Name node` or kill by PID.                            |
| `bedrock_server.exe is already running (PID …)`      | A previous BDS session is still up. Kill it; LevelDB lock would block the harness anyway.                |
| `BDS exited (code=3221225477) before log matched …`  | Windows access violation. Usually means a previous BDS was force-killed and the world LevelDB is in repair; check the log for `LevelDB worlds/.../db status NOT OK`. Try again — BDS usually auto-repairs on next boot. |
| `pre-existing anchor` differs from expected          | The world has a persisted anchor from an earlier session. The harness now resets to `null` first, so just re-run.|
| `port [25565] may be in use`                         | The Bedrock client is open and reserved 25565 (see `bds-setup` for the client's port-grab story). Quit the client or change `server-port` in `server.properties`. |
| Tests hang at "BDS booted"                           | BDS started but the pack didn't load. Usually a permissions.json mistake or a missing config file; check the BDS log under `--verbose` for `[Scripting]` errors. |

## When to use this skill

Trigger this skill (and run the harness) when:

- You've made changes to `pack/src/` and want to verify they didn't
  break anything before asking the user.
- You're debugging why an anchor isn't propagating, why a heartbeat
  is missing, or why the daemon is returning unexpected state.
- You're about to ship a Phase 3+ build/test endpoint and want to
  catch regressions early.

Skip this skill (and just ask the user) when:

- The change is purely visual (particles, chat messages a player would
  see) or requires a player in the world (chat-issued custom commands).
- The pack code didn't change and you only modified host-side tools.
