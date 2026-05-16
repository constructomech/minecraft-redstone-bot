/**
 * Redstone Forge — pack entry point.
 *
 * Wires the slash commands at startup, then kicks off the outbound
 * heartbeat once the world is ready.
 */
import { system } from "@minecraft/server";
import { registerHelloCommand } from "./commands/hello.js";
import { registerAnchorCommands } from "./commands/anchor.js";
import { startHeartbeat } from "./transport.js";
import { startDebug } from "./debug.js";

system.beforeEvents.startup.subscribe((startup) => {
  registerHelloCommand(startup.customCommandRegistry);
  registerAnchorCommands(startup.customCommandRegistry);
  console.log("[rsforge] startup: commands registered");
});

// Defer transport + debug until first tick so admin config
// (variables/secrets) is loaded and accessible. The startup event runs
// in early-execution mode where some admin lookups can be restricted.
system.run(() => {
  startHeartbeat();
  startDebug();
});
