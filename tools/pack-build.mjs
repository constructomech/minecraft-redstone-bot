// Bundle pack/src/main.ts -> pack/scripts/main.js via esbuild.
//
// Run from the repo root via `npm run build` or directly with
// `node tools/pack-build.mjs`. All Script API modules are marked
// external — Bedrock provides them at runtime; we ship only our code.

import { build } from "esbuild";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const packDir = path.join(repoRoot, "pack");
const entry = path.join(packDir, "src", "main.ts");
const outDir = path.join(packDir, "scripts");
const outfile = path.join(outDir, "main.js");

// Modules Bedrock provides at runtime. Never bundle these.
const minecraftExternals = [
  "@minecraft/server",
  "@minecraft/server-net",
  "@minecraft/server-admin",
  "@minecraft/server-ui",
  "@minecraft/server-gametest",
  "@minecraft/server-editor",
  "@minecraft/debug-utilities",
];

await rm(outDir, { recursive: true, force: true });

const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  outfile,
  external: minecraftExternals,
  sourcemap: false,
  minify: false,
  logLevel: "info",
  banner: {
    js: "// Redstone Forge — bundled by esbuild. Do not edit; edit pack/src/ instead.",
  },
});

if (result.errors.length > 0) {
  console.error(result.errors);
  process.exit(1);
}

console.log(`built ${path.relative(repoRoot, outfile)}`);
