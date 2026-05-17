/**
 * ContraptionSpec types + a hand-rolled validator.
 *
 * Phase 3 surface: `anchor: "absolute"` only — block local coords are
 * added to the anchor position with no rotation. Player-facing
 * rotation lands in Phase 4 alongside the transform module.
 */

import { checkStateKeys, isAllowedComponent } from "./components.js";

export type SpecAnchorMode = "absolute" | "player-facing";

export type Vec3Tuple = readonly [number, number, number];

export type SpecBlock = {
  /** Block-local position [x, y, z] relative to the anchor. Must be integers. */
  readonly at: Vec3Tuple;
  /** Bedrock block id; must be in the components allowlist. */
  readonly id: string;
  /** Per-block state values (passed through to BlockPermutation.resolve). */
  readonly states?: Readonly<Record<string, string | number | boolean>>;
};

export type ContraptionSpec = {
  readonly name: string;
  readonly version?: number;
  readonly footprint: { readonly size: Vec3Tuple };
  /** "absolute" only in Phase 3. */
  readonly anchor?: SpecAnchorMode;
  readonly blocks: readonly SpecBlock[];
};

export type ValidationError = { readonly path: string; readonly message: string };

export type ValidationResult =
  | { readonly ok: true; readonly spec: ContraptionSpec }
  | { readonly ok: false; readonly errors: readonly ValidationError[] };

/** Pure-data validator. Never reads the world; safe in any context. */
export function validateSpec(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const e = (path: string, message: string) => errors.push({ path, message });

  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ path: "$", message: "spec must be a JSON object" }] };
  }
  const s = input as Record<string, unknown>;

  // name
  if (typeof s.name !== "string" || s.name.length === 0) {
    e("$.name", "required non-empty string");
  } else if (!/^[a-z0-9][a-z0-9\-_]*$/i.test(s.name)) {
    e("$.name", `'${s.name}' should be kebab-or-snake-cased identifier`);
  }

  // version (optional)
  if (s.version !== undefined && (typeof s.version !== "number" || !Number.isInteger(s.version) || s.version < 1)) {
    e("$.version", "must be a positive integer if provided");
  }

  // footprint
  if (!isPlainObject(s.footprint)) {
    e("$.footprint", "required object { size: [x,y,z] }");
  } else {
    const fp = s.footprint as Record<string, unknown>;
    if (!isVec3IntTuple(fp.size)) {
      e("$.footprint.size", "must be [x,y,z] of positive integers");
    } else {
      const [sx, sy, sz] = fp.size as Vec3Tuple;
      if (sx <= 0 || sy <= 0 || sz <= 0) e("$.footprint.size", "all dimensions must be > 0");
    }
  }

  // anchor (optional)
  let anchor: SpecAnchorMode = "absolute";
  if (s.anchor !== undefined) {
    if (s.anchor !== "absolute" && s.anchor !== "player-facing") {
      e("$.anchor", "must be 'absolute' or 'player-facing'");
    } else {
      anchor = s.anchor;
      if (anchor === "player-facing") {
        e("$.anchor", "'player-facing' rotation lands in Phase 4; use 'absolute' for now");
      }
    }
  }

  // blocks
  if (!Array.isArray(s.blocks)) {
    e("$.blocks", "required array");
  } else {
    if (s.blocks.length === 0) e("$.blocks", "must contain at least one block");
    s.blocks.forEach((b, i) => {
      const path = `$.blocks[${i}]`;
      if (!isPlainObject(b)) {
        e(path, "must be an object");
        return;
      }
      const blk = b as Record<string, unknown>;
      if (!isVec3IntTuple(blk.at)) {
        e(`${path}.at`, "must be [x,y,z] of integers");
      }
      if (typeof blk.id !== "string" || blk.id.length === 0) {
        e(`${path}.id`, "required non-empty string");
      } else if (!isAllowedComponent(blk.id)) {
        e(`${path}.id`, `'${blk.id}' is not in the components allowlist (see pack/src/spec/components.ts)`);
      } else if (blk.states !== undefined) {
        if (!isPlainObject(blk.states)) {
          e(`${path}.states`, "must be a plain object if provided");
        } else {
          const err = checkStateKeys(blk.id, blk.states as Record<string, unknown>);
          if (err) e(`${path}.states`, err);
          // Also validate state value types are primitives.
          for (const [k, v] of Object.entries(blk.states as Record<string, unknown>)) {
            const t = typeof v;
            if (t !== "string" && t !== "number" && t !== "boolean") {
              e(`${path}.states.${k}`, `value must be string|number|boolean, got ${t}`);
            }
          }
        }
      }
    });

    // Footprint coverage: every block must lie within [0..size).
    if (isPlainObject(s.footprint) && isVec3IntTuple((s.footprint as Record<string, unknown>).size)) {
      const [sx, sy, sz] = (s.footprint as Record<string, unknown>).size as Vec3Tuple;
      s.blocks.forEach((b, i) => {
        if (!isPlainObject(b)) return;
        const at = (b as Record<string, unknown>).at;
        if (!isVec3IntTuple(at)) return;
        const [x, y, z] = at as Vec3Tuple;
        if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) {
          e(`$.blocks[${i}].at`, `position [${x},${y},${z}] outside footprint [0..${sx}, 0..${sy}, 0..${sz})`);
        }
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // Construct the typed spec from the validated input. We know all
  // fields are well-formed at this point.
  const spec: ContraptionSpec = {
    name: s.name as string,
    ...(s.version !== undefined ? { version: s.version as number } : {}),
    footprint: { size: ((s.footprint as Record<string, unknown>).size) as Vec3Tuple },
    anchor,
    blocks: (s.blocks as unknown[]).map((b) => {
      const bb = b as Record<string, unknown>;
      const out: SpecBlock = {
        at: bb.at as Vec3Tuple,
        id: bb.id as string,
        ...(bb.states ? { states: bb.states as Record<string, string | number | boolean> } : {}),
      };
      return out;
    }),
  };
  return { ok: true, spec };
}

// ---------- helpers ----------

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isVec3IntTuple(x: unknown): x is Vec3Tuple {
  return (
    Array.isArray(x) &&
    x.length === 3 &&
    x.every((n) => typeof n === "number" && Number.isInteger(n))
  );
}
