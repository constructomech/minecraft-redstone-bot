---
name: bedrock-script-api
description: Use when implementing or modifying Redstone Forge behavior-pack code that targets Minecraft Bedrock's Script API — @minecraft/server, @minecraft/server-net, @minecraft/server-admin, manifest.json modules and UUIDs, custom slash commands registered via the startup event, Dimension.setBlock/getBlock, BlockPermutation, system.runTimeout, world dynamic properties, the dedicated-server permissions.json grants. Load before writing or reviewing anything under pack/src/.
---

# bedrock-script-api

How to use Minecraft Bedrock's Script API correctly in the Redstone Forge
behavior pack.

> Status: stub. Fills in during Phase 1.

## Intended scope

- `manifest.json` shape: `format_version`, `header` + module UUIDs,
  `dependencies` on `@minecraft/server` (with version) and on
  `@minecraft/server-net`. Why each UUID matters and which ones must be
  stable (header) vs regenerable (modules).
- Pack-level `permissions.json` (inside our pack) vs BDS-level
  `permissions.json` (inside the BDS install) — they're different files
  with different schemas. Pack-level declares required modules;
  BDS-level grants the pack permission to load privileged ones.
- Custom slash commands: register via `system.beforeEvents.startup` →
  `event.customCommandRegistry.registerCommand`. Required vs optional
  args, namespacing (`rsforge:anchor`), permission level.
- World mutation: `dimension.setBlock`, `setBlockPermutation`,
  `BlockPermutation.resolve`, why `Block.permutation.withState` is the
  right way to derive a new permutation.
- Reading: `dimension.getBlock`, `Block.typeId`, `Block.permutation`,
  `Block.getState`, `dimension.getEntities`.
- Scheduling: `system.runTimeout(callback, ticksFromNow)`,
  `system.runInterval`, `system.run`, the tick budget (~5ms watchdog;
  long synchronous loops crash the script host).
- Dynamic properties: `world.setDynamicProperty` /
  `getDynamicProperty` for persisting anchor and job state across
  reloads.
- HTTP via `@minecraft/server-net`: `http.request`, `HttpRequest`,
  `HttpResponse`. Inbound vs outbound (the module supports both but
  inbound listening is the path we use for `/build`, `/test`).
- Secrets via `@minecraft/server-admin`: bearer token and port read
  from `config/default/variables.json`.

## Authoritative reference

`https://learn.microsoft.com/minecraft/creator/scriptapi/` — fetch when
implementing or debugging. The Script API churns; trust the docs over
memory.

## Common pitfalls

(Filled in during Phase 1 as we hit them.)
