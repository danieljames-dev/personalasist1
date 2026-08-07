/**
 * Sales-facing names for the Relationship Core.
 *
 * Sales was where the relationship record was designed and proved, so its vocabulary — customer,
 * prospect, lifecycle — is the one already written into the Command Center, the demo, and the
 * tests. The record itself now lives in `relationships.ts` and serves every workspace and every
 * relationship type; this module keeps the Sales names pointing at it so nothing that already
 * worked has to be rewritten to keep working.
 *
 * There is deliberately no second implementation here. A customer *is* a relationship whose type
 * is `customer`; the promotion added a field and removed a restriction, it did not fork the domain.
 */
export {
  applyRelationshipEdit as applyCustomerEdit,
  assertNoSensitiveValue,
  buildAppointment,
  buildFollowUp,
  buildInteraction,
  buildRelationship as buildCustomer,
  contactMethods,
  interests,
  lastInteraction,
  queryRelationships as queryCustomers,
} from "./relationships.js";

export type { ContactChannelV1, CustomerLifecycleV1, DataOriginV1 } from "./contracts.js";
