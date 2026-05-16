/**
 * /rsforge:anchor — set the build anchor at the player's current block.
 * /rsforge:anchor_clear — clear it.
 * /rsforge:anchor_show — spawn a brief particle marker showing where it is.
 *
 * Three separate commands rather than one with an enum subcommand to
 * avoid the (currently still beta) custom-command-enum registration
 * complexity. We can switch to a single command with a subcommand enum
 * in a later phase if the API stabilises.
 */
import {
  CommandPermissionLevel,
  CustomCommandSource,
  CustomCommandStatus,
  system,
  type CustomCommandOrigin,
  type CustomCommandRegistry,
  type CustomCommandResult,
  type Player,
} from "@minecraft/server";
import { clearAnchor, getAnchor, setAnchor, yawToFacing, type Anchor } from "../anchor.js";

export function registerAnchorCommands(registry: CustomCommandRegistry): void {
  registry.registerCommand(
    {
      name: "rsforge:anchor",
      description:
        "Set the Redstone Forge build anchor at your current block (facing direction taken from your yaw).",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
    },
    anchorSet,
  );

  registry.registerCommand(
    {
      name: "rsforge:anchor_clear",
      description: "Clear the Redstone Forge build anchor.",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
    },
    anchorClear,
  );

  registry.registerCommand(
    {
      name: "rsforge:anchor_show",
      description: "Briefly show the current anchor with a particle marker.",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
    },
    anchorShow,
  );
}

function requirePlayer(origin: CustomCommandOrigin): Player | CustomCommandResult {
  if (origin.sourceType !== CustomCommandSource.Entity || !origin.sourceEntity) {
    return {
      status: CustomCommandStatus.Failure,
      message: "Must be invoked by a player.",
    };
  }
  return origin.sourceEntity as Player;
}

function anchorSet(origin: CustomCommandOrigin): CustomCommandResult {
  const playerOrErr = requirePlayer(origin);
  if (!("location" in playerOrErr)) return playerOrErr;
  const player = playerOrErr;

  const loc = player.location;
  const rot = player.getRotation();
  const anchor: Anchor = {
    dimension: player.dimension.id,
    pos: {
      x: Math.floor(loc.x),
      y: Math.floor(loc.y),
      z: Math.floor(loc.z),
    },
    facing: yawToFacing(rot.y),
    setBy: { name: player.name, id: player.id },
    setAt: Date.now(),
  };

  // setDynamicProperty must run outside a read-only context.
  system.run(() => {
    try {
      setAnchor(anchor);
      console.log(
        `[rsforge] anchor set by ${anchor.setBy.name} at ${anchor.pos.x} ${anchor.pos.y} ${anchor.pos.z} (${anchor.facing}, ${anchor.dimension})`,
      );
    } catch (err) {
      console.error(`[rsforge] anchor set failed: ${String(err)}`);
    }
  });

  return {
    status: CustomCommandStatus.Success,
    message: `Anchor set at ${anchor.pos.x} ${anchor.pos.y} ${anchor.pos.z} facing ${anchor.facing}.`,
  };
}

function anchorClear(origin: CustomCommandOrigin): CustomCommandResult {
  const playerOrErr = requirePlayer(origin);
  if (!("location" in playerOrErr)) return playerOrErr;

  system.run(() => {
    clearAnchor();
    console.log(`[rsforge] anchor cleared`);
  });

  return {
    status: CustomCommandStatus.Success,
    message: "Anchor cleared.",
  };
}

function anchorShow(origin: CustomCommandOrigin): CustomCommandResult {
  const playerOrErr = requirePlayer(origin);
  if (!("location" in playerOrErr)) return playerOrErr;
  const player = playerOrErr;

  const a = getAnchor();
  if (!a) {
    return { status: CustomCommandStatus.Failure, message: "No anchor set." };
  }

  // Spawn a column of "happy villager" particles for ~3 seconds at the
  // anchor block + 5 above so it's visible from a distance. This is a
  // single tick of work; for a longer-running marker we'd schedule it.
  system.run(() => {
    try {
      const dim = player.dimension;
      for (let dy = 0; dy < 6; dy++) {
        dim.spawnParticle("minecraft:villager_happy", {
          x: a.pos.x + 0.5,
          y: a.pos.y + dy + 0.5,
          z: a.pos.z + 0.5,
        });
      }
    } catch (err) {
      console.error(`[rsforge] anchor_show particle spawn failed: ${String(err)}`);
    }
  });

  return {
    status: CustomCommandStatus.Success,
    message: `Anchor at ${a.pos.x} ${a.pos.y} ${a.pos.z} (${a.facing}, ${a.dimension}). Set by ${a.setBy.name}.`,
  };
}
