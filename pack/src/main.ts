/**
 * Redstone Forge — main entry point.
 *
 * Phase 1: registers `/rsforge:hello` as a sanity-check end-to-end command.
 * Later phases will wire the HTTP server, anchor, builder, and test runner.
 */
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
      name: "rsforge:hello",
      description:
        "Phase 1 sanity check. Places a stone block at the caller's feet+1.",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
    },
    helloCommand,
  );
  console.log("[rsforge] startup: registered /rsforge:hello");
});

function helloCommand(origin: CustomCommandOrigin): CustomCommandResult {
  if (origin.sourceType !== CustomCommandSource.Entity || !origin.sourceEntity) {
    return {
      status: CustomCommandStatus.Failure,
      message: "rsforge:hello must be invoked by a player.",
    };
  }

  const entity = origin.sourceEntity;
  const dim = entity.dimension;
  const loc = entity.location;
  const target = {
    x: Math.floor(loc.x),
    y: Math.floor(loc.y) + 1,
    z: Math.floor(loc.z),
  };

  // Command callbacks run in a read-only execution context. Defer the
  // world mutation to the next tick so the engine accepts the write.
  system.run(() => {
    try {
      dim.setBlockType(target, "minecraft:stone");
    } catch (err) {
      console.error(`rsforge:hello: setBlockType failed: ${String(err)}`);
    }
  });

  return {
    status: CustomCommandStatus.Success,
    message: `Placed minecraft:stone at ${target.x} ${target.y} ${target.z}.`,
  };
}
