/**
 * Test runner: executes a ContraptionTest's steps against a built
 * contraption (identified by a Job), driving inputs, waiting ticks,
 * and reading outputs. Reports the first failure with observed-vs-
 * expected, or pass:true if all expects succeed.
 */
import { system, world, type Vector3 } from "@minecraft/server";
import type { Anchor } from "../anchor.js";
import type { Job } from "../jobs.js";
import type {
  Binary,
  ContraptionTest,
  InputPort,
  OutputPort,
  TestStep,
} from "../spec/schema.js";
import { rotatePosition, type RotationStep } from "../world/transform.js";
import { driveInput } from "../world/inputs.js";
import { readOutput } from "../world/probes.js";

export type FailedStep = {
  readonly index: number;
  readonly port: string;
  readonly expected: Binary;
  readonly observed: Binary;
};

export type TestRunResult = {
  readonly name: string;
  readonly pass: boolean;
  readonly stepCount: number;
  readonly failedStep?: FailedStep;
  readonly error?: string;
};

/** Run a single test against a previously-built job. */
export async function runTest(
  test: ContraptionTest,
  job: Job,
): Promise<TestRunResult> {
  const dim = world.getDimension(job.anchor.dimension);
  const inputs  = job.spec.ports?.inputs  ?? {};
  const outputs = job.spec.ports?.outputs ?? {};

  try {
    for (let i = 0; i < test.steps.length; i++) {
      const step = test.steps[i]!;

      if ("set" in step) {
        for (const [portName, value] of Object.entries(step.set)) {
          const port = inputs[portName];
          if (!port) {
            return failBecause(test, i, `set: unknown input port '${portName}'`);
          }
          driveInput(dim, resolvePortPos(port, job.anchor, job.rotationSteps), port.kind, value);
        }
      } else if ("wait_ticks" in step) {
        if (step.wait_ticks > 0) await waitTicks(step.wait_ticks);
      } else if ("expect" in step) {
        for (const [portName, expected] of Object.entries(step.expect)) {
          const port = outputs[portName];
          if (!port) {
            return failBecause(test, i, `expect: unknown output port '${portName}'`);
          }
          const observed = readOutput(dim, resolvePortPos(port, job.anchor, job.rotationSteps), port.kind);
          if (observed !== expected) {
            return {
              name: test.name,
              pass: false,
              stepCount: test.steps.length,
              failedStep: { index: i, port: portName, expected, observed },
            };
          }
        }
      }
    }
    return { name: test.name, pass: true, stepCount: test.steps.length };
  } catch (err) {
    return {
      name: test.name,
      pass: false,
      stepCount: test.steps.length,
      error: `step threw: ${String(err)}`,
    };
  }
}

/** Run every test on a job in order. Stops at the first error in a test;
 * separate tests are independent. */
export async function runAllTests(job: Job): Promise<TestRunResult[]> {
  const tests = job.spec.tests ?? [];
  const out: TestRunResult[] = [];
  for (const t of tests) {
    out.push(await runTest(t, job));
  }
  return out;
}

function resolvePortPos(
  port: InputPort | OutputPort,
  anchor: Anchor,
  steps: RotationStep,
): Vector3 {
  const rotated = rotatePosition(port.at, steps);
  return {
    x: anchor.pos.x + rotated[0],
    y: anchor.pos.y + rotated[1],
    z: anchor.pos.z + rotated[2],
  };
}

function waitTicks(n: number): Promise<void> {
  return new Promise((resolve) => system.runTimeout(() => resolve(), n));
}

function failBecause(test: ContraptionTest, stepIndex: number, msg: string): TestRunResult {
  return {
    name: test.name,
    pass: false,
    stepCount: test.steps.length,
    error: `step ${stepIndex}: ${msg}`,
  };
}
