/**
 * /rsforge:hello — Phase 1 sanity check.
 * Places a stone block at the caller's feet+1.
 */
import {
  CommandPermissionLevel,
  CustomCommandSource,
  CustomCommandStatus,
  system,
  type CustomCommandOrigin,
  type CustomCommandRegistry,
  type CustomCommandResult,
} from "@minecraft/server";

export function registerHelloCommand(registry: CustomCommandRegistry): void {
  registry.registerCommand(
    {
      name: "rsforge:hello",
      description:
        "Sanity check. Places a stone block at the caller's feet+1.",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
    },
    helloCommand,
  );
}

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
