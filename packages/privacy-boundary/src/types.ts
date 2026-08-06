export type LocalOperationV1 = "read-file" | "write-file" | "list-directory";

export interface ApprovedRootV1 {
  readonly version: "1";
  readonly reference: string;
  readonly absolutePath: string;
}

export interface ExplicitInputPathV1 {
  readonly version: "1";
  readonly absolutePath: string;
}

export interface PathAuthorizationRequestV1 {
  readonly version: "1";
  readonly operation: LocalOperationV1;
  readonly approvedRoot: ApprovedRootV1;
  readonly requestedPath: ExplicitInputPathV1;
  readonly allowApprovedRoot?: boolean;
}

export type PathBoundaryReasonV1 =
  | "approved-root-invalid"
  | "requested-path-invalid"
  | "relative-path-rejected"
  | "unc-path-rejected"
  | "device-path-rejected"
  | "cross-volume-rejected"
  | "approved-root-missing"
  | "approved-root-not-directory"
  | "approved-root-target-rejected"
  | "path-outside-approved-root"
  | "link-or-reparse-escape"
  | "target-not-file"
  | "unsupported-extension";

export interface PathBoundaryErrorV1 {
  readonly version: "1";
  readonly reason: PathBoundaryReasonV1;
  readonly operation: LocalOperationV1;
  readonly approvedRootReference: string;
  readonly remediation: string;
}

export type PathAuthorizationResultV1 =
  | {
      readonly version: "1";
      readonly authorized: true;
      readonly operation: LocalOperationV1;
      readonly approvedRootReference: string;
      readonly resolvedPath: string;
    }
  | {
      readonly version: "1";
      readonly authorized: false;
      readonly error: PathBoundaryErrorV1;
    };

export interface LocalOperationRecordV1 {
  readonly version: "1";
  readonly operationId: string;
  readonly operation: LocalOperationV1;
  readonly approvedRootReference: string;
  readonly explicitlySuppliedRelativePath: string;
  readonly requestedAt: string;
  readonly actorReference: string | null;
  readonly dryRun: boolean;
  readonly outcome: "authorized" | "rejected" | "completed" | "failed";
  readonly counts: {
    readonly considered: number;
    readonly accepted: number;
    readonly rejected: number;
  };
  readonly reasonCodes: readonly PathBoundaryReasonV1[];
  readonly policyVersion: "local-path-boundary-v1";
}
