// Enable the Beta APIs (gametest) experiment on a Bedrock world by
// editing its level.dat.
//
// Why: @minecraft/server's beta channel — which is where the
// CustomCommandRegistry (and most current Script API surface area)
// lives — requires the "Beta APIs" experiment flag on the world.
// BDS does not expose this as a server.properties key, and the
// shipped world has it off. So we edit the NBT directly.
//
// Bedrock level.dat format:
//   bytes 0-3: file version (uint32 LE) — typically 10
//   bytes 4-7: NBT payload length (uint32 LE)
//   bytes 8.. : little-endian NBT
//
// Usage: node tools/enable-experiments.mjs <path-to-level.dat>

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import nbt from "prismarine-nbt";

const target = process.argv[2];
if (!target) {
  console.error("Usage: node tools/enable-experiments.mjs <path-to-level.dat>");
  process.exit(2);
}

const buf = await readFile(target);
if (buf.length < 8) throw new Error(`level.dat too small: ${buf.length} bytes`);

const version = buf.readUInt32LE(0);
const declaredLen = buf.readUInt32LE(4);
const body = buf.subarray(8);
if (body.length !== declaredLen) {
  console.warn(
    `note: header length ${declaredLen} != actual body length ${body.length}; using actual`,
  );
}

const { parsed } = await nbt.parse(body, "little");
if (parsed.type !== "compound") {
  throw new Error(`expected root compound, got ${parsed.type}`);
}

const root = parsed.value;
let exp = root.experiments;
if (!exp || exp.type !== "compound") {
  exp = { type: "compound", value: {} };
  root.experiments = exp;
}

// Keys to flip. `gametest` is the long-standing NBT key for the
// "Beta APIs" experiment that gates @minecraft/server beta channel.
// The two ..._used / saved_with_toggled flags must also be true or
// the runtime treats experiments as never-enabled and ignores the
// per-experiment booleans.
const wantOn = ["gametest", "experiments_ever_used", "saved_with_toggled_experiments"];

let changed = false;
for (const key of wantOn) {
  const before = exp.value[key]?.value;
  exp.value[key] = { type: "byte", value: 1 };
  if (before !== 1) {
    console.log(`  set experiments.${key} = 1 (was ${before ?? "absent"})`);
    changed = true;
  }
}

if (!changed) {
  console.log("experiments already enabled; no write needed.");
  process.exit(0);
}

const newBody = nbt.writeUncompressed(parsed, "little");
const newHeader = Buffer.alloc(8);
newHeader.writeUInt32LE(version, 0);
newHeader.writeUInt32LE(newBody.length, 4);

const backup = target + ".bak";
await writeFile(backup, buf);
await writeFile(target, Buffer.concat([newHeader, newBody]));
console.log(`wrote ${path.basename(target)} (backup at ${path.basename(backup)})`);
