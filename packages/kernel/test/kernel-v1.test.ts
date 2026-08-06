import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AionKernelV1,
  KernelRegistrationErrorV1,
  KernelStartErrorV1,
  KernelStopErrorV1,
  KernelTransitionErrorV1,
  type LifecycleContextV1,
  type LifecycleParticipantV1,
} from "../src/kernel/v1/index.js";

function participant(
  id: string,
  start: (context: LifecycleContextV1) => Promise<void> = async () => {},
  stop: (context: LifecycleContextV1) => Promise<void> = async () => {},
): LifecycleParticipantV1 {
  return { id, start, stop };
}

describe("AionKernelV1", () => {
  it("starts in created state with an immutable snapshot", () => {
    const kernel = new AionKernelV1();
    const snapshot = kernel.snapshot();

    assert.deepEqual(snapshot, {
      apiVersion: "1.0",
      state: "created",
      registeredParticipantIds: [],
      startedParticipantIds: [],
    });
    assert(Object.isFrozen(snapshot));
    assert(Object.isFrozen(snapshot.registeredParticipantIds));
    assert(Object.isFrozen(snapshot.startedParticipantIds));
  });

  it("rejects empty, padded, and duplicate participant ids", () => {
    const kernel = new AionKernelV1();

    assert.throws(() => kernel.register(participant("")), KernelRegistrationErrorV1);
    assert.throws(() => kernel.register(participant(" padded")), KernelRegistrationErrorV1);
    kernel.register(participant("unique"));
    assert.throws(
      () => kernel.register(participant("unique")),
      KernelRegistrationErrorV1,
    );
  });

  it("starts sequentially in registration order and stops in reverse order", async () => {
    const calls: string[] = [];
    const kernel = new AionKernelV1();

    for (const id of ["first", "second", "third"]) {
      kernel.register(
        participant(
          id,
          async () => { calls.push(`start:${id}`); },
          async () => { calls.push(`stop:${id}`); },
        ),
      );
    }

    await kernel.start();
    assert.equal(kernel.snapshot().state, "running");
    assert.deepEqual(kernel.snapshot().startedParticipantIds, ["first", "second", "third"]);

    await kernel.stop();
    assert.equal(kernel.snapshot().state, "stopped");
    assert.deepEqual(kernel.snapshot().startedParticipantIds, []);
    assert.deepEqual(calls, [
      "start:first",
      "start:second",
      "start:third",
      "stop:third",
      "stop:second",
      "stop:first",
    ]);
  });

  it("closes registration as soon as startup begins", async () => {
    const kernel = new AionKernelV1();
    let releaseStart: (() => void) | undefined;
    const startBarrier = new Promise<void>((resolve) => { releaseStart = resolve; });
    kernel.register(participant("slow", async () => startBarrier));

    const starting = kernel.start();
    assert.equal(kernel.snapshot().state, "starting");
    assert.throws(
      () => kernel.register(participant("late")),
      KernelRegistrationErrorV1,
    );
    releaseStart?.();
    await starting;
    await kernel.stop();
  });

  it("rolls back successful starts and preserves the startup cause", async () => {
    const calls: string[] = [];
    const startupCause = new Error("unavailable");
    const kernel = new AionKernelV1();
    kernel.register(participant("first", async () => { calls.push("start:first"); }, async () => { calls.push("stop:first"); }));
    kernel.register(participant("second", async () => { throw startupCause; }));

    await assert.rejects(kernel.start(), (error: unknown) => {
      assert(error instanceof KernelStartErrorV1);
      assert.equal(error.participantId, "second");
      assert.equal(error.cause, startupCause);
      assert.deepEqual(error.rollbackFailures, []);
      return true;
    });

    assert.deepEqual(calls, ["start:first", "stop:first"]);
    assert.equal(kernel.snapshot().state, "failed");
    assert.deepEqual(kernel.snapshot().startedParticipantIds, []);
  });

  it("attempts all rollback stops and reports rollback failures", async () => {
    const calls: string[] = [];
    const rollbackCause = new Error("cleanup failed");
    const kernel = new AionKernelV1();
    kernel.register(participant("first", async () => {}, async () => { calls.push("stop:first"); }));
    kernel.register(participant("second", async () => {}, async () => { calls.push("stop:second"); throw rollbackCause; }));
    kernel.register(participant("third", async () => { throw new Error("start failed"); }));

    await assert.rejects(kernel.start(), (error: unknown) => {
      assert(error instanceof KernelStartErrorV1);
      assert.equal(error.rollbackFailures.length, 1);
      assert.equal(error.rollbackFailures[0]?.participantId, "second");
      assert.equal(error.rollbackFailures[0]?.cause, rollbackCause);
      return true;
    });

    assert.deepEqual(calls, ["stop:second", "stop:first"]);
    assert.deepEqual(kernel.snapshot().startedParticipantIds, ["second"]);
  });

  it("attempts every shutdown and aggregates failures", async () => {
    const calls: string[] = [];
    const kernel = new AionKernelV1();
    kernel.register(participant("first", async () => {}, async () => { calls.push("first"); throw new Error("one"); }));
    kernel.register(participant("second", async () => {}, async () => { calls.push("second"); throw new Error("two"); }));
    await kernel.start();

    await assert.rejects(kernel.stop(), (error: unknown) => {
      assert(error instanceof KernelStopErrorV1);
      assert.deepEqual(error.failures.map(({ participantId }) => participantId), ["second", "first"]);
      return true;
    });

    assert.deepEqual(calls, ["second", "first"]);
    assert.equal(kernel.snapshot().state, "failed");
    assert.deepEqual(kernel.snapshot().startedParticipantIds, ["first", "second"]);
  });

  it("aborts the shared context before shutdown", async () => {
    const kernel = new AionKernelV1();
    let context: LifecycleContextV1 | undefined;
    kernel.register(participant("observer", async (value) => { context = value; }, async (value) => {
      assert.equal(value, context);
      assert(value.signal.aborted);
    }));

    await kernel.start();
    assert(context);
    assert.equal(context.signal.aborted, false);
    await kernel.stop();
  });

  it("rejects invalid lifecycle transitions", async () => {
    const kernel = new AionKernelV1();
    await assert.rejects(kernel.stop(), KernelTransitionErrorV1);
    await kernel.start();
    await assert.rejects(kernel.start(), KernelTransitionErrorV1);
    await kernel.stop();
    await assert.rejects(kernel.stop(), KernelTransitionErrorV1);
  });
});
