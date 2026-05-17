// One-off block-state discovery: spawn BDS, place each candidate block
// at a far-away location, dump its actual typeId + state map, print
// the results. Use the output to populate pack/src/spec/components.ts.

import { BdsProcess } from "./bds-control.mjs";

const BLOCKS = [
  "minecraft:stone",
  "minecraft:glass",
  "minecraft:redstone_wire",
  "minecraft:redstone_block",
  "minecraft:redstone_lamp",
  "minecraft:lit_redstone_lamp",
  "minecraft:lever",
  "minecraft:redstone_torch",
  "minecraft:unlit_redstone_torch",
  "minecraft:repeater",
  "minecraft:unpowered_repeater",
  "minecraft:powered_repeater",
  "minecraft:comparator",
  "minecraft:unpowered_comparator",
  "minecraft:powered_comparator",
  "minecraft:observer",
  "minecraft:piston",
  "minecraft:sticky_piston",
  "minecraft:wooden_button",
  "minecraft:stone_button",
  "minecraft:wooden_pressure_plate",
  "minecraft:stone_pressure_plate",
];

const bds = new BdsProcess({ onLog: (l) => { if (/ticking|Player|debug_/.test(l)) console.log(`  [bds] ${l}`); } });
await bds.start({ readyTimeoutMs: 30000 });

// Add a permanent ticking area so the scratch chunk is loaded even
// without a player. tickingarea uses block coords.
bds.send("tickingarea add 0 0 0 31 255 31 rsforge_scratch");
await new Promise((r) => setTimeout(r, 1500));

console.log("BDS up + ticking area requested. Discovering states...\n");

const SCRATCH_X = 4;
const SCRATCH_Y = 70;
const SCRATCH_Z = 4;

for (const id of BLOCKS) {
  const cursor = bds.log.length;
  bds.send(`scriptevent rsforge:debug_place_and_dump ${SCRATCH_X} ${SCRATCH_Y} ${SCRATCH_Z} ${id}`);
  try {
    const m = await bds.waitForLog(
      /debug_place_and_dump: typeId=(\S+) states=({[^}]*})|debug_place_and_dump failed: (.+?)$/m,
      { timeoutMs: 5000, fromIndex: cursor },
    );
    if (m[1]) {
      console.log(`  ${id.padEnd(38)}  ->  ${m[1]}  states=${m[2]}`);
    } else if (m[3]) {
      console.log(`  ${id.padEnd(38)}  ->  ERR  ${m[3]}`);
    }
  } catch (err) {
    console.log(`  ${id.padEnd(38)}  ->  timeout`);
  }
  await new Promise((r) => setTimeout(r, 150));
}

await bds.stop();
console.log("\ndone.");
