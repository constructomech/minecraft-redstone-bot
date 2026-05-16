---
name: bedrock-script-api
description: Use when implementing or modifying Redstone Forge behavior-pack code that targets Minecraft Bedrock's Script API — @minecraft/server, @minecraft/server-net, @minecraft/server-admin, manifest.json modules/UUIDs/dependencies, beta-vs-stable channel choice (and the gametest experiment that gates beta), custom slash commands via system.beforeEvents.startup → customCommandRegistry, Dimension.setBlock/setBlockType/setBlockPermutation, BlockPermutation, system.runTimeout, world dynamic properties, the bundler pipeline (esbuild → scripts/main.js), and console.log gating via content-log-console-output-enabled.
---

# bedrock-script-api

How to use Minecraft Bedrock's Script API correctly in the Redstone
Forge behavior pack.

## Channel choice: beta vs stable

The npm `@minecraft/server` package publishes three relevant dist-tags:

| Tag      | Use when                                            |
| -------- | --------------------------------------------------- |
| `latest` | Pinned stable API. No `CustomCommandRegistry`. No beta-only features. |
| `rc`     | Release candidate for a future Minecraft preview build. |
| `beta`   | Current beta API matching the current stable BDS. Versioned `2.X.0-beta.<bds-version>-stable`. |

Redstone Forge targets **beta**. We declare it in `pack/manifest.json`
with `"version": "beta"` and install the matching npm tarball in
`devDependencies` for types (e.g.
`@minecraft/server@2.8.0-beta.1.26.21-stable` for BDS 1.26.21.1).

**Beta requires the "Beta APIs" experiment on the world.** Without it
BDS logs an error like *"Plugin … requesting dependency on beta APIs
[@minecraft/server - 2.8.0-beta], but the Beta APIs experiment is not
enabled"* and refuses to load the pack. The experiment is flipped via
`tools/enable-experiments.mjs` (the `gametest` NBT key in `level.dat`).
See `bds-setup` for that mechanism. `tools/pack-deploy.ps1` calls it
automatically.

If you ever want to drop beta and lock to stable, expect to lose
custom slash commands and reach for `system.afterEvents.scriptEventReceive`
+ the built-in `/scriptevent <id> [data]` command as the substitute.

## manifest.json shape

```jsonc
{
  "format_version": 2,
  "header": {
    "name": "Redstone Forge",
    "description": "…",
    "uuid": "<header-uuid>",      // stable identity, used by worlds
    "version": [0, 1, 0],         // bumped on each release
    "min_engine_version": [1, 26, 21]
  },
  "modules": [
    { "type": "script", "uuid": "<script-module-uuid>",
      "version": [0, 1, 0], "language": "javascript",
      "entry": "scripts/main.js" }
  ],
  "dependencies": [
    { "module_name": "@minecraft/server", "version": "beta" }
  ]
}
```

- Header UUID and module UUID must be distinct.
- `entry` is relative to the pack root.
- A pack with `dependencies` on a restricted module
  (`@minecraft/server-net`, `@minecraft/server-admin`) won't load until
  the **per-pack** `config/<pack-uuid>/permissions.json` lists those
  modules in its `allowed_modules` array. See `bds-setup`. Note that
  writing to BDS-root `permissions.json` is **wrong** — that file is
  for player op/member permissions by XUID and has a completely
  different schema; writing pack grants there causes
  `"xuid or permission missing"` errors and denies even
  `@minecraft/server`.

## Custom slash commands

Registered once per world load via the startup event:

```ts
import {
  CommandPermissionLevel,
  CustomCommandSource,
  CustomCommandStatus,
  system,
  type CustomCommandOrigin,
  type CustomCommandResult,
} from "@minecraft/server";

system.beforeEvents.startup.subscribe((startup) => {
  startup.customCommandRegistry.registerCommand(
    {
      name: "rsforge:hello",            // namespace required
      description: "…",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
    },
    (origin: CustomCommandOrigin): CustomCommandResult => { … },
  );
});
```

The callback **runs in a read-only execution context**. Any block /
entity / world mutation MUST be deferred:

```ts
system.run(() => {
  dim.setBlockType(target, "minecraft:stone");
});
```

If you mutate inside the callback directly, you'll see a `Failure` or
the engine throws an exception that's swallowed and logged.

Return shape: `{ status: CustomCommandStatus.Success | Failure, message?: string }`.
The message is displayed in the player's chat colorized by status.

`CustomCommandOrigin.sourceType` is one of `Entity | Server | Block | NPCDialogue`.
For player commands, `sourceType === CustomCommandSource.Entity` and
`origin.sourceEntity` is the calling player. Validate both — server-
initiated commands won't have `sourceEntity`.

## Block placement

```ts
dimension.setBlockType(loc, "minecraft:stone");
// or with state:
dimension.setBlockPermutation(loc, BlockPermutation.resolve("minecraft:repeater", { direction: 1 }));
```

`Block.permutation.withState("repeater_delay", 2)` is the right way
to derive a modified permutation; never construct one from raw
string IDs without going through `BlockPermutation.resolve`.

## Logging

`console.log / console.warn / console.error` from a script print to the
BDS console **only if `content-log-console-output-enabled=true`** in
`server.properties`. Our `tools/bds-install.ps1` sets it; if you boot
into a server without the flag, your logs silently disappear.

`console` isn't in the `ES2022` TypeScript lib. We declare it ambiently
in `pack/src/globals.d.ts`.

## Tick budget and watchdogs

BDS runs a script watchdog that kills long synchronous work. Defaults
visible in `server.properties` comments:

- Slow threshold: warns if scripts spend > 10ms / tick on average.
- Hang threshold: kills if a single tick exceeds 10 000ms.
- Memory limit: 250 MB by default; world saves and shuts down past it.

For Redstone Forge: never loop over thousands of blocks synchronously
inside an event handler. Chunk work across ticks with `system.run` or
`system.runInterval`.

## Build pipeline

```
pack/src/*.ts  ──(esbuild)──>  pack/scripts/main.js
```

`tools/pack-build.mjs` invokes esbuild with:

- `bundle: true`
- `format: "esm"`
- `platform: "neutral"`
- `target: "es2022"`
- `external: ["@minecraft/server", "@minecraft/server-net", …]`

All `@minecraft/*` modules are external — Bedrock provides them at
runtime. If you ever see one of them inlined into `main.js`, that's
a bug in `pack-build.mjs`.

## Authoritative reference

`https://learn.microsoft.com/minecraft/creator/scriptapi/` — fetch
when implementing or debugging. The Script API churns; trust the docs
over memory. The npm tarball's `index.d.ts` is the runtime contract;
when in doubt, `npm pack @minecraft/server@<version>` and read the
types directly.
