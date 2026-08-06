import {
  KernelRegistrationErrorV1,
  KernelStartErrorV1,
  KernelStopErrorV1,
  KernelTransitionErrorV1,
} from "./errors.js";
import {
  KERNEL_API_VERSION_V1,
  type KernelSnapshotV1,
  type KernelStateV1,
  type KernelV1,
  type LifecycleContextV1,
  type LifecycleParticipantV1,
  type ParticipantFailureV1,
} from "./types.js";

export class AionKernelV1 implements KernelV1 {
  readonly #participants: LifecycleParticipantV1[] = [];
  readonly #participantIds = new Set<string>();
  readonly #startedParticipantIds = new Set<string>();
  readonly #abortController = new AbortController();
  readonly #context: LifecycleContextV1;
  #state: KernelStateV1 = "created";

  constructor() {
    this.#context = Object.freeze({ signal: this.#abortController.signal });
  }

  register(participant: LifecycleParticipantV1): void {
    if (this.#state !== "created") {
      throw new KernelRegistrationErrorV1(
        `Cannot register participants while Kernel is in state '${this.#state}'.`,
      );
    }

    if (participant.id.length === 0 || participant.id.trim() !== participant.id) {
      throw new KernelRegistrationErrorV1(
        "Participant id must be non-empty and contain no leading or trailing whitespace.",
      );
    }

    if (this.#participantIds.has(participant.id)) {
      throw new KernelRegistrationErrorV1(
        `Participant id '${participant.id}' is already registered.`,
      );
    }

    this.#participantIds.add(participant.id);
    this.#participants.push(participant);
  }

  async start(): Promise<void> {
    if (this.#state !== "created") {
      throw new KernelTransitionErrorV1("start", this.#state);
    }

    this.#state = "starting";

    for (const participant of this.#participants) {
      try {
        await participant.start(this.#context);
        this.#startedParticipantIds.add(participant.id);
      } catch (cause: unknown) {
        this.#abortController.abort(cause);
        const rollbackFailures = await this.#stopStartedParticipants();
        this.#state = "failed";
        throw new KernelStartErrorV1(
          participant.id,
          cause,
          rollbackFailures,
        );
      }
    }

    this.#state = "running";
  }

  async stop(): Promise<void> {
    if (this.#state !== "running") {
      throw new KernelTransitionErrorV1("stop", this.#state);
    }

    this.#state = "stopping";
    this.#abortController.abort();
    const failures = await this.#stopStartedParticipants();

    if (failures.length > 0) {
      this.#state = "failed";
      throw new KernelStopErrorV1(failures);
    }

    this.#state = "stopped";
  }

  snapshot(): KernelSnapshotV1 {
    return Object.freeze({
      apiVersion: KERNEL_API_VERSION_V1,
      state: this.#state,
      registeredParticipantIds: Object.freeze(
        this.#participants.map(({ id }) => id),
      ),
      startedParticipantIds: Object.freeze(
        this.#participants
          .filter(({ id }) => this.#startedParticipantIds.has(id))
          .map(({ id }) => id),
      ),
    });
  }

  async #stopStartedParticipants(): Promise<ParticipantFailureV1[]> {
    const failures: ParticipantFailureV1[] = [];

    for (const participant of [...this.#participants].reverse()) {
      if (!this.#startedParticipantIds.has(participant.id)) {
        continue;
      }

      try {
        await participant.stop(this.#context);
        this.#startedParticipantIds.delete(participant.id);
      } catch (cause: unknown) {
        failures.push(Object.freeze({ participantId: participant.id, cause }));
      }
    }

    return failures;
  }
}
