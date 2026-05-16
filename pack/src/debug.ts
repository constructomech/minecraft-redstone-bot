/**
 * Debug scriptevent handlers — server-source commands that let the
 * agent's self-test harness drive the pack without needing a player.
 *
 * Activated only when `variables.debug_enabled === true`. Off-switch
 * exists for any future non-dev deployment.
 *
 * Driven from BDS console (or any /scriptevent invocation):
 *
 *   /scriptevent rsforge:debug_setanchor 0 64 0 north
 *   /scriptevent rsforge:debug_setanchor 0 64 0 north minecraft:nether
 *   /scriptevent rsforge:debug_clearanchor
 *   /scriptevent rsforge:debug_state
 *
 * `debug_state` writes the current anchor JSON to the BDS console so
 * the harness can match it from stdout if it needs to.
 */
import { system } from "@minecraft/server";
import { variables } from "@minecraft/server-admin";
import {
  clearAnchor,
  getAnchor,
  setAnchor,
  type Anchor,
  type Facing,
} from "./anchor.js";

const VALID_FACINGS: readonly string[] = ["north", "south", "east", "west"];

export function startDebug(): void {
  const enabled = variables.get("debug_enabled");
  if (enabled !== true) {
    console.log("[rsforge] debug: disabled (variables.debug_enabled !== true)");
    return;
  }
  console.log(
    "[rsforge] debug: scriptevent handlers active under namespace 'rsforge'",
  );

  system.afterEvents.scriptEventReceive.subscribe(
    (event) => handle(event.id, event.message ?? ""),
    { namespaces: ["rsforge"] },
  );
}

function handle(id: string, message: string): void {
  try {
    switch (id) {
      case "rsforge:debug_setanchor":
        debugSetAnchor(message);
        break;
      case "rsforge:debug_clearanchor":
        debugClearAnchor();
        break;
      case "rsforge:debug_state":
        debugState();
        break;
      default:
        // Other rsforge:* scriptevents are not ours; ignore.
        return;
    }
  } catch (err) {
    console.error(`[rsforge] debug ${id} failed: ${String(err)}`);
  }
}

function debugSetAnchor(message: string): void {
  const parts = message.trim().split(/\s+/);
  if (parts.length < 4) {
    console.error(
      `[rsforge] debug_setanchor: expected "<x> <y> <z> <facing> [dim]", got "${message}"`,
    );
    return;
  }
  const [xs, ys, zs, facingStr, dimStr] = parts as [string, string, string, string, string?];
  const x = Number.parseInt(xs, 10);
  const y = Number.parseInt(ys, 10);
  const z = Number.parseInt(zs, 10);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    console.error(`[rsforge] debug_setanchor: non-integer coords in "${message}"`);
    return;
  }
  if (!VALID_FACINGS.includes(facingStr)) {
    console.error(
      `[rsforge] debug_setanchor: invalid facing "${facingStr}" (want one of ${VALID_FACINGS.join("|")})`,
    );
    return;
  }
  const dimension = dimStr ?? "minecraft:overworld";

  const anchor: Anchor = {
    dimension,
    pos: { x, y, z },
    facing: facingStr as Facing,
    setBy: { name: "debug", id: "debug" },
    setAt: Date.now(),
  };

  setAnchor(anchor);
  console.log(
    `[rsforge] debug_setanchor: ${dimension} ${x} ${y} ${z} ${facingStr}`,
  );
}

function debugClearAnchor(): void {
  clearAnchor();
  console.log("[rsforge] debug_clearanchor: cleared");
}

function debugState(): void {
  const a = getAnchor();
  console.log(`[rsforge] debug_state: anchor=${JSON.stringify(a)}`);
}
