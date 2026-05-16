---
name: bds-setup
description: Use ONLY when installing, upgrading, configuring, or troubleshooting the Bedrock Dedicated Server (BDS) install used by Redstone Forge. Covers tools/bds-install.ps1, tools/bds-run.ps1, the minecraft-services.net download-links endpoint, the URL fallback chain, server.properties, BDS-level permissions.json, and common install failures (403 on download, Windows SmartScreen, port 19132 conflicts, LevelDB world lock).
---

# bds-setup

How the agent acquires, installs, upgrades, runs, and troubleshoots the
**Bedrock Dedicated Server (BDS)** that the Redstone Forge behavior pack
runs on. This is BDS itself — not the behavior pack. Pack install is a
separate concern (Phase 1).

## The two scripts

| Script                          | Purpose                                                          |
| ------------------------------- | ---------------------------------------------------------------- |
| `tools/bds-install.ps1`         | Resolve latest BDS URL, download, extract, patch server.properties |
| `tools/bds-run.ps1`             | Launch the most-recently-installed BDS                           |
| `tools/enable-experiments.mjs`  | Enable the Beta APIs (gametest) experiment in a world's level.dat |

Default install root: `%LOCALAPPDATA%\RedstoneForge\bds\<version>\`. Each
BDS version lives in its own subfolder; the ZIP is cached under
`%LOCALAPPDATA%\RedstoneForge\bds\.cache\`.

The install script is idempotent: re-running it after a version has been
released will install the new version side-by-side without touching the
old one. Pass `-Force` to redownload and reinstall the same version.

## Resolving the latest BDS URL — the fallback chain

Mojang has no contractual public API for BDS downloads. The install
script tries four sources in order; if it falls through all of them it
stops and asks for a manual URL rather than guessing.

### 1. JSON endpoint (primary)

```
GET https://net-secondary.web.minecraft-services.net/api/v1.0/download/links
```

Requirements:

- A browser-like `User-Agent` header. With curl's default UA the endpoint
  returns 403.
- An `Accept-Language` header (e.g. `en-US,en;q=0.9`).

Response shape (confirmed live):

```json
{
  "result": {
    "links": [
      { "downloadType": "serverBedrockWindows",        "downloadUrl": "https://www.minecraft.net/bedrockdedicatedserver/bin-win/bedrock-server-1.26.21.1.zip" },
      { "downloadType": "serverBedrockLinux",          "downloadUrl": "https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-1.26.21.1.zip" },
      { "downloadType": "serverBedrockPreviewWindows", "downloadUrl": "..." },
      { "downloadType": "serverBedrockPreviewLinux",   "downloadUrl": "..." },
      { "downloadType": "serverJar",                   "downloadUrl": "..." }
    ]
  }
}
```

Pick by `downloadType`. For Redstone Forge default to
`serverBedrockWindows`; use the `Preview` variant only when the user
explicitly asks (`-Channel preview`).

### 2. Page scrape (fallback)

Fetch `https://www.minecraft.net/en-us/download/server/bedrock` with the
same browser UA and regex-match the first link of the form

```
https://www\.minecraft\.net/bedrockdedicatedserver/bin-win(-preview)?/bedrock-server-[\d.]+\.zip
```

### 3. Community-tracked wiki (fallback)

`https://minecraft.wiki/w/Bedrock_Dedicated_Server` usually lists the
current version with a direct link in the same `bedrockdedicatedserver`
URL pattern. The version may lag the official site by a few hours, which
is acceptable.

### 4. Ask the user

If steps 1–3 all fail, **stop and prompt the user** to visit
`https://www.minecraft.net/en-us/download/server/bedrock`, copy the ZIP
URL, and re-run with `-ManualUrl '<url>'`. Do not invent a URL pattern
even if you "know" what the version probably is.

The script records which source succeeded in
`<install-dir>/redstone-forge.source`, so you can tell when the primary
path silently regressed.

## License acknowledgment

Downloading and running BDS implies acceptance of:

- [Minecraft End User License Agreement](https://www.minecraft.net/en-us/eula)
- [Minecraft Terms of Service](https://www.minecraft.net/en-us/terms)

The install script prints both URLs before downloading. The agent must
not suppress that output.

## What gets patched in server.properties

The install script overrides the following keys for a clean dev
experience and leaves everything else as-shipped:

| Key            | Value         | Why                                                        |
| -------------- | ------------- | ---------------------------------------------------------- |
| `server-name`  | `Redstone Forge Dev` | So it's recognizable in the LAN list                   |
| `gamemode`     | `creative`    | Free flight, no breaking, instant block changes            |
| `difficulty`   | `peaceful`    | No mobs interfering with builds                            |
| `allow-cheats` | `true`        | Custom commands and `/give` require it                     |
| `online-mode`  | `false`       | Local-only; skips Xbox Live auth check on the server side  |
| `max-players`  | `4`           | Local dev sizing                                           |

The script only *replaces* existing lines; it does not append new keys.
If a future BDS release renames or removes one of these, the script
warns ("override '<key>' did not match any existing line") rather than
silently no-op-ing. Adjust the override list when you see that.

If the user wants different values, they edit `server.properties` after
install. The script does not re-patch on subsequent runs unless `-Force`
is passed.

### Why no `level-type` override

`level-type` is a **Java Edition** server.properties key. Bedrock's
`server.properties` has no equivalent — world generator type (default
vs flat vs old) is fixed at world-creation time, not configurable from
the server config file. The shipped BDS world (`worlds/Bedrock level/`)
uses the default generator.

To get a flat world: create a flat world in your Bedrock client first,
copy it into `<install>/worlds/`, and point `level-name` at it. Or set
`gamemode=creative` (we do) and fly around the default world — for
redstone work that's usually enough.

## The Beta APIs experiment

Phase 1+ uses the **beta** channel of `@minecraft/server` because the
`CustomCommandRegistry` (and most of the current Script API surface)
lives there. Beta is gated by the **Beta APIs** experiment on the
world. BDS does **not** expose this as a `server.properties` key — it
is a flag inside `worlds/<level-name>/level.dat` (NBT-encoded).

Mechanism: the NBT compound `experiments` inside the root compound
holds the per-experiment booleans. The Beta APIs experiment uses the
key `gametest` (legacy name; BDS logs it as `gtst` in the
`Experiment(s) active` line at boot). Two adjacent flags must also be
true or the runtime treats experiments as never-enabled:
`experiments_ever_used` and `saved_with_toggled_experiments`.

`tools/enable-experiments.mjs` does this safely:

```
node tools/enable-experiments.mjs <path-to-level.dat>
```

It parses level.dat (`prismarine-nbt`, little-endian format), sets the
three keys to `1`, rewrites the NBT, and updates the 8-byte file
header (version + payload length). A `.bak` of the original is left
alongside. The script is idempotent — re-running on an already-enabled
world prints "experiments already enabled" and exits cleanly.

`tools/pack-deploy.ps1` calls this automatically as part of every
deploy, so an agent never needs to invoke it directly unless
diagnosing a problem.

If you see this in the BDS log:

```
[Scripting] Plugin [Redstone Forge - 0.1.0] - requesting dependency on
beta APIs [@minecraft/server - 2.8.0-beta], but the Beta APIs
experiment is not enabled.
```

It means the experiment isn't on for that world. Fix by running
`enable-experiments.mjs` against the world's `level.dat` and restart
BDS.

## Server-side `permissions.json`

This is BDS's own permissions file at the install root. It is the
mechanism that grants packs (by UUID) access to **restricted Script API
modules** beyond the default allow-list.

There is **no pack-level `permissions.json`** in current Bedrock. Packs
declare what modules they import in their `manifest.json` `dependencies`
array, and the BDS-root file is what actually gates the restricted ones.

Default allow-list (from `config/default/permissions.json`):

- `@minecraft/server`
- `@minecraft/server-ui`
- `@minecraft/server-admin`
- `@minecraft/server-gametest`
- `@minecraft/server-editor`
- `@minecraft/debug-utilities`

**`@minecraft/server-net` is NOT in the default allow-list.** Any pack
using it must be granted explicitly in the root `permissions.json`.

Phase-by-phase status:

- **Phase 1** (pack skeleton with the `/rsforge:hello` command): uses
  only `@minecraft/server`. No edits to `permissions.json` needed.
- **Phase 2** (HTTP transport): pack adds `@minecraft/server-net` (and
  `@minecraft/server-admin` for secrets/variables). The deploy script
  must inject a grant for our pack's UUID into the root
  `permissions.json`. Expected entry shape:

  ```json
  [
    {
      "uuid": "<our pack's data/script module UUID>",
      "allowed_modules": [
        "@minecraft/server-net",
        "@minecraft/server-admin"
      ]
    }
  ]
  ```

  Whether the UUID needs to be the data module's or the script module's
  is something to verify on first integration — Mojang has been
  inconsistent in docs. Start with the script module UUID; if BDS logs
  reject the pack, switch.

## Running the server

```pwsh
pwsh tools/bds-run.ps1
```

The script picks the highest-numbered version directory under the install
root and launches `bedrock_server.exe` with its cwd set to that
directory (BDS resolves `resource_packs/`, `behavior_packs/`,
`development_*_packs/`, and `worlds/` relative to its cwd).

Stop the server with `stop` at its prompt for a clean shutdown. Ctrl+C
also works but can leave the world's LevelDB in a recovery state.

## Common failures

| Symptom                                              | Cause / Fix                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `403 Forbidden` from the JSON endpoint               | Missing browser UA. The script always sends one — if you see this, the endpoint changed; advance to step 2. |
| `Windows protected your PC` SmartScreen popup        | First-time run of `bedrock_server.exe`. Click "More info" → "Run anyway." Unsigned-binary warning.            |
| `Cannot bind to 0.0.0.0:19132`                       | Port in use (often by another BDS instance, the Bedrock client's LAN advertise, or Hyper-V). Change `server-port` in `server.properties` or stop the conflicting process. |
| `LevelDB error: lock`                                | Two BDS processes opened the same world. Stop all `bedrock_server.exe` instances and try again.              |
| Client can't see "127.0.0.1" in the Servers list     | Add it manually as a "Server" in the Servers tab with port `19132`. The LAN list only shows in-network ads.  |
| Behavior pack doesn't load                           | Pack added to the world's enabled packs in `worlds/<level-name>/world_behavior_packs.json`? UUIDs match between that file and `pack/manifest.json` (header UUID, not module UUID)? Pack uses restricted modules but missing from BDS-root `permissions.json`? (Phase 1+ territory.) |

## When the user asks "install the server"

1. Read this skill end-to-end.
2. Run `pwsh tools/bds-install.ps1` and stream its output.
3. On failure, report which fallback step was reached and what the
   underlying error was. Suggest the next step (often `-ManualUrl`).
4. On success, tell the user the install path and how to start the
   server.

Do **not** download from arbitrary mirrors, fork the install script to
"try a URL pattern," or skip the license-acknowledgment output.
