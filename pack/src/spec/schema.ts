/**
 * ContraptionSpec types + a hand-rolled validator.
 *
 * Phase 3: anchor "absolute" and "player-facing" both supported (the
 * latter rotates positions + directional state values around Y).
 * Phase 4b: optional `ports` (named inputs/outputs) and `tests`
 * (named declarative test sequences).
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

// ---------- ports ----------

/** Kinds of ports the test runner can drive (inputs) or read (outputs). */
export type InputKind  = "lever" | "redstone_block" | "button" | "pressure_plate";
export type OutputKind = "lamp" | "wire" | "piston";

export const ALLOWED_INPUT_KINDS:  readonly InputKind[]  = ["lever", "redstone_block", "button", "pressure_plate"];
export const ALLOWED_OUTPUT_KINDS: readonly OutputKind[] = ["lamp", "wire", "piston"];

export type InputPort  = { readonly at: Vec3Tuple; readonly kind: InputKind  };
export type OutputPort = { readonly at: Vec3Tuple; readonly kind: OutputKind };

export type Ports = {
  readonly inputs?:  Readonly<Record<string, InputPort>>;
  readonly outputs?: Readonly<Record<string, OutputPort>>;
};

// ---------- tests ----------

/** Binary value used for both lever/redstone_block inputs and lamp outputs. */
export type Binary = "on" | "off";

export type TestStepSet    = { readonly set:    Readonly<Record<string, Binary>> };
export type TestStepWait   = { readonly wait_ticks: number };
export type TestStepExpect = { readonly expect: Readonly<Record<string, Binary>> };
export type TestStep = TestStepSet | TestStepWait | TestStepExpect;

export type ContraptionTest = {
  readonly name: string;
  readonly steps: readonly TestStep[];
};

// ---------- spec ----------

export type ContraptionSpec = {
  readonly name: string;
  readonly version?: number;
  readonly footprint: { readonly size: Vec3Tuple };
  readonly anchor?: SpecAnchorMode;
  readonly blocks: readonly SpecBlock[];
  readonly ports?: Ports;
  readonly tests?: readonly ContraptionTest[];
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
  let footprintSize: Vec3Tuple | null = null;
  if (!isPlainObject(s.footprint)) {
    e("$.footprint", "required object { size: [x,y,z] }");
  } else {
    const fp = s.footprint as Record<string, unknown>;
    if (!isVec3IntTuple(fp.size)) {
      e("$.footprint.size", "must be [x,y,z] of positive integers");
    } else {
      footprintSize = fp.size as Vec3Tuple;
      const [sx, sy, sz] = footprintSize;
      if (sx <= 0 || sy <= 0 || sz <= 0) {
        e("$.footprint.size", "all dimensions must be > 0");
        footprintSize = null;
      }
    }
  }

  // anchor (optional)
  let anchor: SpecAnchorMode = "absolute";
  if (s.anchor !== undefined) {
    if (s.anchor !== "absolute" && s.anchor !== "player-facing") {
      e("$.anchor", "must be 'absolute' or 'player-facing'");
    } else {
      anchor = s.anchor;
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
          for (const [k, v] of Object.entries(blk.states as Record<string, unknown>)) {
            const t = typeof v;
            if (t !== "string" && t !== "number" && t !== "boolean") {
              e(`${path}.states.${k}`, `value must be string|number|boolean, got ${t}`);
            }
          }
        }
      }
      // Footprint coverage
      if (footprintSize && isVec3IntTuple(blk.at)) {
        const [x, y, z] = blk.at as Vec3Tuple;
        const [sx, sy, sz] = footprintSize;
        if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) {
          e(`${path}.at`, `position [${x},${y},${z}] outside footprint [0..${sx}, 0..${sy}, 0..${sz})`);
        }
      }
    });
  }

  // ports (optional)
  const inputPortNames  = new Set<string>();
  const outputPortNames = new Set<string>();
  const inputPortKinds  = new Map<string, InputKind>();
  const outputPortKinds = new Map<string, OutputKind>();

  if (s.ports !== undefined) {
    if (!isPlainObject(s.ports)) {
      e("$.ports", "must be a plain object");
    } else {
      const ports = s.ports as Record<string, unknown>;
      validatePortMap(
        ports.inputs, "inputs", footprintSize, ALLOWED_INPUT_KINDS as readonly string[],
        inputPortNames, inputPortKinds as Map<string, string>, e,
      );
      validatePortMap(
        ports.outputs, "outputs", footprintSize, ALLOWED_OUTPUT_KINDS as readonly string[],
        outputPortNames, outputPortKinds as Map<string, string>, e,
      );

      // input and output names must be disjoint (otherwise set/expect ambiguous)
      for (const name of inputPortNames) {
        if (outputPortNames.has(name)) {
          e(`$.ports`, `port name '${name}' appears in both inputs and outputs`);
        }
      }
    }
  }

  // tests (optional)
  if (s.tests !== undefined) {
    if (!Array.isArray(s.tests)) {
      e("$.tests", "must be an array if provided");
    } else {
      s.tests.forEach((t, i) => {
        const path = `$.tests[${i}]`;
        if (!isPlainObject(t)) {
          e(path, "must be an object");
          return;
        }
        const test = t as Record<string, unknown>;
        if (typeof test.name !== "string" || !test.name) {
          e(`${path}.name`, "required non-empty string");
        }
        if (!Array.isArray(test.steps) || test.steps.length === 0) {
          e(`${path}.steps`, "required non-empty array");
        } else {
          test.steps.forEach((step, j) => {
            validateTestStep(
              step, `${path}.steps[${j}]`,
              inputPortKinds, outputPortNames, e,
            );
          });
        }
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // Construct the typed spec from the validated input.
  const spec: ContraptionSpec = {
    name: s.name as string,
    ...(s.version !== undefined ? { version: s.version as number } : {}),
    footprint: { size: footprintSize! },
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
    ...(s.ports !== undefined ? { ports: s.ports as Ports } : {}),
    ...(s.tests !== undefined ? { tests: s.tests as readonly ContraptionTest[] } : {}),
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

function isBinaryValue(v: unknown): v is Binary {
  return v === "on" || v === "off";
}

function validatePortMap(
  raw: unknown,
  category: "inputs" | "outputs",
  footprintSize: Vec3Tuple | null,
  allowedKinds: readonly string[],
  namesOut: Set<string>,
  kindsOut: Map<string, string>,
  e: (path: string, message: string) => void,
): void {
  if (raw === undefined) return;
  if (!isPlainObject(raw)) {
    e(`$.ports.${category}`, "must be a plain object if provided");
    return;
  }
  for (const [name, value] of Object.entries(raw)) {
    const path = `$.ports.${category}.${name}`;
    if (!/^[a-z0-9][a-z0-9_]*$/i.test(name)) {
      e(path, `port name '${name}' should be alphanumeric/underscore`);
    }
    if (!isPlainObject(value)) {
      e(path, "must be an object { at: [x,y,z], kind: string }");
      continue;
    }
    const port = value as Record<string, unknown>;
    if (!isVec3IntTuple(port.at)) {
      e(`${path}.at`, "must be [x,y,z] of integers");
    } else if (footprintSize) {
      const [x, y, z] = port.at as Vec3Tuple;
      const [sx, sy, sz] = footprintSize;
      if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) {
        e(`${path}.at`, `position outside footprint [0..${sx}, 0..${sy}, 0..${sz})`);
      }
    }
    if (typeof port.kind !== "string" || !allowedKinds.includes(port.kind)) {
      e(`${path}.kind`, `must be one of: ${allowedKinds.join(" | ")}`);
    } else {
      namesOut.add(name);
      kindsOut.set(name, port.kind);
    }
  }
}

function validateTestStep(
  step: unknown,
  path: string,
  inputPortKinds: Map<string, InputKind>,
  outputPortNames: Set<string>,
  e: (p: string, m: string) => void,
): void {
  if (!isPlainObject(step)) {
    e(path, "step must be an object");
    return;
  }
  const s = step as Record<string, unknown>;

  if ("set" in s) {
    if (!isPlainObject(s.set)) {
      e(`${path}.set`, "must be a plain object");
      return;
    }
    for (const [portName, value] of Object.entries(s.set as Record<string, unknown>)) {
      if (!inputPortKinds.has(portName)) {
        e(`${path}.set.${portName}`, `unknown input port (defined ports: ${Array.from(inputPortKinds.keys()).join(", ") || "<none>"})`);
        continue;
      }
      if (!isBinaryValue(value)) {
        e(`${path}.set.${portName}`, `value must be "on" or "off"`);
      }
    }
    return;
  }
  if ("wait_ticks" in s) {
    if (typeof s.wait_ticks !== "number" || !Number.isInteger(s.wait_ticks) || s.wait_ticks < 0) {
      e(`${path}.wait_ticks`, "must be a non-negative integer");
    }
    return;
  }
  if ("expect" in s) {
    if (!isPlainObject(s.expect)) {
      e(`${path}.expect`, "must be a plain object");
      return;
    }
    for (const [portName, value] of Object.entries(s.expect as Record<string, unknown>)) {
      if (!outputPortNames.has(portName)) {
        e(`${path}.expect.${portName}`, `unknown output port (defined ports: ${Array.from(outputPortNames).join(", ") || "<none>"})`);
        continue;
      }
      if (!isBinaryValue(value)) {
        e(`${path}.expect.${portName}`, `value must be "on" or "off"`);
      }
    }
    return;
  }

  e(path, `step must have exactly one of: set | wait_ticks | expect`);
}
