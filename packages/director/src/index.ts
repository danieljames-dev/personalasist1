/**
 * AION Director — mission orchestration for engineering work.
 *
 * The Director runs long jobs that outlive any one conversation: hand work to an executor, verify
 * what came back against the repository rather than against its own report, stop at the points a
 * person must decide, and survive a reboot with enough state that a later process knows what to do.
 *
 * It does not touch the Owner's business records. That boundary is the reason the two halves can
 * share a machine safely, and it is asserted rather than assumed.
 */
export * from "./contracts.js";
export { isResolvedHostPath } from "./host-path.js";
export * from "./mission.js";
export * from "./mission-creation.js";
export * from "./gates.js";
export * from "./git-truth.js";
export * from "./handoff.js";
export * from "./leases.js";
export * from "./executors.js";
export * from "./executor-discovery.js";
export * from "./executor-adapters.js";
export * from "./run-intent.js";
export * from "./process-identity.js";
export * from "./bounded-log.js";
export {
  RUN_RESULT_SCHEMA_V1,
  CANCEL_SOFT_MS,
  CANCEL_HARD_MS,
  launchRun,
  directorExecuteJobWithFailover,
  createInProcessCapacityGate,
  recoverAbandonedRun,
  proveWriterExit,
  writerReleaseEvidence,
  isWriterExitProof,
  evaluateSuccessConjunction,
  writerSightingNotProvenAbsent,
  createNodeRunFileSystem,
  statErrorMeansAbsent,
  createNodeSpawner,
  wrapChildProcess,
  createNodeWait,
  killProcessTreeStandIn,
  taskkillConfirmedStopped,
} from "./run-manager.js";
export type {
  SuccessConjunctNameV1,
  ConjunctFindingV1,
  SuccessConjunctionV1,
  CancelStageV1,
  CancelReportV1,
  SpawnOptionsV1,
  SpawnExitV1,
  SpawnHandleV1,
  SpawnFnV1,
  RunFileSystemV1,
  CapacityGateV1,
  LeaseStoreV1,
  OrphanSightingV1,
  WriterLivenessQuestionV1,
  RunManagerDepsV1,
  LaunchRunDepsV1,
  ExecuteRunRequestV1,
  LaunchRunRequestV1,
  RunResultV1,
  RecoverOutcomeV1,
  ResultPersistedV1,
  WriterOrphanScanV1,
  WriterExitProofV1,
  WriterExitProofInputV1,
  OwnedHandleExitV1,
} from "./run-manager.js";
export * from "./lease-store.js";
export * from "./work-items.js";
export * from "./store-contract.js";
export * from "./src-reachability.js";
export * from "./provider-bridge.js";
