# Bedrock Dedicated Server — bootstrap guide

Human-readable mirror of the [`bds-setup`](../.agents/skills/bds-setup/SKILL.md)
agent skill. If you're an LLM agent, prefer the skill; this file exists for
people clicking around the repo.

## TL;DR

```pwsh
pwsh tools/bds-install.ps1   # downloads + extracts latest BDS
pwsh tools/bds-run.ps1       # boots it
```

Connect from your Bedrock client to `127.0.0.1:25565`. The first launch
generates a flat creative world named `Bedrock level`.

> The default BDS port is normally 19132, but the Bedrock client itself
> reserves UDP 19132–19500 for LAN discovery when it's open, blocking
> BDS from binding any of them. The install script patches
> `server-port=25565` / `server-portv6=25566` to sidestep this.

## What the install script does

1. Resolves the latest BDS ZIP URL through a four-step fallback chain
   (JSON endpoint → minecraft.net page scrape → minecraft.wiki → ask
   you for a manual URL). Records which source succeeded so we can
   notice when the primary breaks.
2. Downloads the ZIP to `%LOCALAPPDATA%\RedstoneForge\bds\.cache\`.
3. Extracts to `%LOCALAPPDATA%\RedstoneForge\bds\<version>\`.
4. Patches `server.properties` for a creative-mode dev experience
   (`gamemode=creative`, `difficulty=peaceful`, `allow-cheats=true`,
   `online-mode=false`, …). The script only replaces existing lines
   and warns if a key it expected to find is missing — so you'll know
   if a future BDS release renames something.

Note: Bedrock has no `level-type` / generator key in
`server.properties` (that's a Java-edition thing). The world type is
fixed when the world is created; the shipped BDS world uses the
default generator. If you specifically want a flat world, build one in
your Bedrock client and copy it into `<install>/worlds/`.

Versions install side-by-side. There is currently no automatic
world-migration on upgrade — your old world stays inside the old
version's folder under `worlds/`.

## License

By downloading and running BDS you agree to:

- [Minecraft EULA](https://www.minecraft.net/en-us/eula)
- [Minecraft Terms of Service](https://www.minecraft.net/en-us/terms)

The install script prints both before it downloads anything.

## When the download fails

The script prints which fallback step it reached and what the
underlying error was. The most likely remedy is to grab the ZIP URL
yourself from
[minecraft.net/en-us/download/server/bedrock](https://www.minecraft.net/en-us/download/server/bedrock)
and re-run:

```pwsh
pwsh tools/bds-install.ps1 -ManualUrl 'https://www.minecraft.net/bedrockdedicatedserver/bin-win/bedrock-server-<version>.zip'
```

## Common issues

- **SmartScreen says "Windows protected your PC"** on first launch of
  `bedrock_server.exe`. Click "More info" → "Run anyway." The binary
  is unsigned but it's the real Mojang BDS.
- **Port 19132 (or any 191xx) "in use"** even though netstat shows
  nothing. The Bedrock client reserves UDP 19132–~19500 for itself
  whenever it's open. Use a port well outside that range (our default
  is 25565); don't fight it.
- **Client shows "Multiplayer Connection Failed" / mentions NetherNet.**
  Recent Bedrock clients route Servers-tab connections through
  Mojang's NetherNet signalling layer, so "server unreachable" errors
  (BDS not running, wrong port, firewall) surface as a NetherNet
  message. Check that BDS is actually running and bound to the port
  the client is dialling.
- **LevelDB lock error.** Two `bedrock_server.exe` processes opened
  the same world. Kill them all and try again.
- **Client can't see the server in the LAN list.** LAN discovery uses
  19132 and our BDS is on 25565, so it won't show up automatically.
  Add it manually in the **Servers** tab: address `127.0.0.1`,
  port `25565`.

## Preview channel

```pwsh
pwsh tools/bds-install.ps1 -Channel preview
```

Pulls `serverBedrockPreviewWindows` from the same endpoint. Useful if
you need a Script API surface that hasn't reached stable yet.

## Uninstall

Delete `%LOCALAPPDATA%\RedstoneForge\bds`. Nothing is installed
system-wide; no registry keys, no services.
