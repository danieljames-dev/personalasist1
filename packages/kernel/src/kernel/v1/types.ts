export const KERNEL_API_VERSION_V1 = "1.0" as const;

export type KernelStateV1 =
  | "created"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";

export interface LifecycleContextV1 {
  readonly signal: AbortSignal;
}

export interface LifecycleParticipantV1 {
  readonly id: string;
  start(context: LifecycleContextV1): Promise<void>;
  stop(context: LifecycleContextV1): Promise<void>;
}

export interface KernelSnapshotV1 {
  readonly apiVersion: typeof KERNEL_API_VERSION_V1;
  readonly state: KernelStateV1;
  readonly registeredParticipantIds: readonly string[];
  readonly startedParticipantIds: readonly string[];
}

export interface KernelV1 {
  register(participant: LifecycleParticipantV1): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  snapshot(): KernelSnapshotV1;
}

export interface ParticipantFailureV1 {
  readonly participantId: string;
  readonly cause: unknown;
}
