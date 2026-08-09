/**
 * @aion/delegated-operator — R6.5 administrative control plane.
 *
 * INACTIVE by default for real approval roots. Founder authorization remains
 * authoritative until a later explicit activation milestone.
 *
 * This package must not be invoked from normal AION chat or provider-runtime
 * paths as shell authority.
 */

export * from "./contracts.js";
export * from "./canonical.js";
export * from "./roles.js";
export * from "./lifecycle.js";
export * from "./envelope.js";
export * from "./authorization.js";
export * from "./owner-presence.js";
export * from "./store.js";
export * from "./audit-log.js";
export * from "./session.js";
export * from "./reboot.js";
export * from "./nested-gates.js";
export * from "./host.js";
export * from "./owner-ui.js";
export * from "./factory.js";
export * from "./elevated-broker.js";
export * from "./facts-ports.js";
export * from "./replay-store.js";
export * from "./pipe-server.js";
export * from "./installed-runtime.js";
export * from "./owner-approval-inbox.js";

/** Package-level library defaults (pre-install). Installed runtime overrides via protected roots. */
export const R65_PRODUCTION_DEFAULTS = {
  realApprovalRootActivated: false,
  founderAuthoritative: true,
  activationMode: "inactive" as const,
  readyForRealAuthority: false,
  readyForRealMigration: false,
  desktopRemainsNonPrimary: true,
  elevatedBrokerInstalled: false,
  elevatedBrokerActivated: false,
  unattendedRoutineElevationAfterFutureActivation: true,
  uacDisabled: false,
  ownerPasswordStored: false,
  arbitraryElevatedPowerShellExposed: false,
  founderFallbackAvailable: true,
} as const;
