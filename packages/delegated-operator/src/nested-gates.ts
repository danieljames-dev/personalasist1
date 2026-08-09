import { type NestedOwnerGateV1, NESTED_OWNER_GATES_V1, type OperatorDecisionV1 } from "./contracts.js";
import { refuseNestedHighConsequence } from "./authorization.js";

/** Map of dangerous intents that ordinary builder envelopes must never satisfy alone. */
export const HIGH_CONSEQUENCE_INTENTS: Readonly<Record<string, NestedOwnerGateV1>> = {
  create_real_owner_key: "real_owner_key",
  provision_real_trust: "real_trust",
  real_writer_transition: "real_writer_transition",
  primary_promotion: "primary_promotion_demotion",
  primary_demotion: "primary_promotion_demotion",
  real_private_migration: "real_private_migration",
  access_credentials: "credentials",
  sensitive_external_communication: "sensitive_external_communication",
  spend_money: "spend",
  raise_budget: "budget_increase",
  change_bitlocker: "bitlocker",
  change_secure_boot: "secure_boot",
  change_bios: "bios_uefi",
  change_tpm: "tpm_config",
  destroy_data: "destructive_data_removal",
  destroy_backup: "backup_destruction",
  change_external_drive_role: "external_drive_role",
  modify_authority_system: "authority_system_modification",
};

export function classifyHighConsequenceIntent(intent: string): NestedOwnerGateV1 | null {
  return HIGH_CONSEQUENCE_INTENTS[intent] ?? null;
}

export function refuseIfHighConsequence(intent: string): OperatorDecisionV1 | null {
  const gate = classifyHighConsequenceIntent(intent);
  if (!gate) return null;
  return refuseNestedHighConsequence(gate);
}

export function allNestedGatesCatalog(): readonly NestedOwnerGateV1[] {
  return NESTED_OWNER_GATES_V1;
}
