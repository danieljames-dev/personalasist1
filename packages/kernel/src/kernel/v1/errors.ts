import type { KernelStateV1, ParticipantFailureV1 } from "./types.js";

export class KernelRegistrationErrorV1 extends Error {
  readonly code = "KERNEL_REGISTRATION_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "KernelRegistrationErrorV1";
  }
}

export class KernelTransitionErrorV1 extends Error {
  readonly code = "KERNEL_TRANSITION_ERROR" as const;
  readonly operation: "start" | "stop";
  readonly state: KernelStateV1;

  constructor(operation: "start" | "stop", state: KernelStateV1) {
    super(`Cannot ${operation} Kernel while it is in state '${state}'.`);
    this.name = "KernelTransitionErrorV1";
    this.operation = operation;
    this.state = state;
  }
}

export class KernelStartErrorV1 extends Error {
  readonly code = "KERNEL_START_ERROR" as const;
  readonly participantId: string;
  readonly rollbackFailures: readonly ParticipantFailureV1[];

  constructor(
    participantId: string,
    cause: unknown,
    rollbackFailures: readonly ParticipantFailureV1[],
  ) {
    super(`Kernel startup failed in participant '${participantId}'.`, { cause });
    this.name = "KernelStartErrorV1";
    this.participantId = participantId;
    this.rollbackFailures = Object.freeze([...rollbackFailures]);
  }
}

export class KernelStopErrorV1 extends Error {
  readonly code = "KERNEL_STOP_ERROR" as const;
  readonly failures: readonly ParticipantFailureV1[];

  constructor(failures: readonly ParticipantFailureV1[]) {
    super(`Kernel shutdown failed for ${failures.length} participant(s).`, {
      cause: failures[0]?.cause,
    });
    this.name = "KernelStopErrorV1";
    this.failures = Object.freeze([...failures]);
  }
}
