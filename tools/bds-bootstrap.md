# Bedrock Dedicated Server — bootstrap guide

Human-readable mirror of the [`bds-setup`](../.agents/skills/bds-setup/SKILL.md)
agent skill. If you're an LLM agent, prefer the skill; this file exists for
people clicking around the repo.

## TL;DR

```pwsh
pwsh tools/bds-install.ps1   # downloads + extracts latest BDS
pwsh tools/bds-run.ps1       # boots it
```

Connect from your Bedrock client to `127.0.0.1:19132`. The first launch
generates a flat creative world named `Bedrock level`.

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
- **Port 19132 in use.** Edit `server-port` in
  `<install-dir>/server.properties` or stop whatever else has it.
- **LevelDB lock error.** Two `bedrock_server.exe` processes opened the
  same world. Kill them all and try again.
- **Client can't see `127.0.0.1` in the LAN list.** Add it manually in
  the **Servers** tab in your Bedrock client (address `127.0.0.1`,
  port `19132`).

## Preview channel

```pwsh
pwsh tools/bds-install.ps1 -Channel preview
```

Pulls `serverBedrockPreviewWindows` from the same endpoint. Useful if
you need a Script API surface that hasn't reached stable yet.

## Uninstall

Delete `%LOCALAPPDATA%\RedstoneForge\bds`. Nothing is installed
system-wide; no registry keys, no services.
