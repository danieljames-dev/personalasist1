/**
 * The evidence AION actually has, written down once, with its sources.
 *
 * Everything here traces to something real: an AHCA certificate the Owner read to AION, a regulatory
 * profile dated 2026-05-17 sitting on an offline drive, a machine transcript, an Owner clarification.
 * Nothing is here because it sounded plausible, and the module is arranged so that adding something
 * plausible would be conspicuous — every claim names its source, and the source names its class.
 *
 * **No sensitive value appears in this file.** Not the certificate number, not the account numbers,
 * not the address, phone or email that the underlying documents contain. The store would classify
 * them `SENSITIVE` if they were here; the better answer is that they are not. What is recorded is
 * what a decision needs: what the business may do, where, and until when.
 *
 * The May profile is included **because it is wrong now**. It said registration was pending, which
 * was true of 2026-05-17 and is not true today. Deleting it would lose the ability to explain how
 * AION's picture changed; keeping it as a live fact would be worse. It is loaded as evidence and
 * superseded by the certificate, which is what supersession is for.
 */

import type { ProposedSourceV1 } from "./business-evidence-store.js";

/** Claim categories. Stable strings, so two sources asserting the same thing can be compared. */
export const CLAIM_V1 = Object.freeze({
  legalName: "identity.legal-name",
  status: "regulatory.status",
  providerType: "regulatory.provider-type",
  serviceArea: "regulatory.service-area",
  serviceAreaPending: "regulatory.service-area-pending",
  scopeProhibited: "regulatory.scope-prohibited",
  scopeAllowed: "regulatory.scope-allowed",
  transportPolicy: "policy.transportation",
  transportLegal: "regulatory.transportation",
  officialRole: "identity.official-role",
  employmentModel: "policy.employment-model",
  screening: "regulatory.screening",
  advertising: "regulatory.advertising",
  brandAlias: "identity.brand-alias",
  assets: "assets.present",
  businessModel: "business.model",
  monetisation: "business.monetisation",
  offers: "business.offers",
});

export const COMPASSIONATE_CHOICE_WORKSPACE_V1 = "compassionate-choice";
export const LOCALFINDS_WORKSPACE_V1 = "localfinds";
export const TALK_TO_CALEB_WORKSPACE_V1 = "talk-to-caleb";
export const AISERVICE_CO_WORKSPACE_V1 = "aiservice-co";

/**
 * The AHCA certificate, as the Owner read it to AION.
 *
 * Source class is `OWNER_STATEMENT`, not `OFFICIAL_REGULATORY_DOCUMENT`, and the distinction is
 * deliberate and slightly uncomfortable: the certificate exists, AION has located the PDFs, and AION
 * **cannot read them** — no PDF text extraction is available here. So what AION has is the Owner
 * relaying an official document, which is strong but is not the document.
 *
 * The document itself is registered separately as an `UNREAD_SOURCE` so the gap is visible rather
 * than implied. When a readable copy arrives it will supersede this cleanly, because an official
 * regulatory document outranks an Owner statement by construction.
 */
export function compassionateChoiceCertificate(now: string): ProposedSourceV1 {
  return {
    sourceClass: "OWNER_STATEMENT",
    reference: "Owner statement of the issued AHCA Certificate of Registration, 2026-08-21",
    readable: true,
    content: "ahca-certificate-owner-relay-2026-08-21",
    observedAtUtc: "2026-08-21T00:00:00Z",
    claims: [
      {
        subject: "Compassionate Choice",
        claim: CLAIM_V1.legalName,
        value: "Compassionate Choice LLC",
        asserted: "KNOWN",
        note: "The current official name on the certificate. Earlier material used a longer form.",
      },
      {
        subject: "Compassionate Choice",
        claim: CLAIM_V1.status,
        value: "REGISTERED",
        asserted: "KNOWN",
        effectiveFromUtc: "2026-06-26T00:00:00Z",
        effectiveToUtc: "2028-06-25T00:00:00Z",
        note: "AHCA §400.509 Certificate of Registration, issued. Supersedes the May pending state.",
      },
      {
        subject: "Compassionate Choice",
        claim: CLAIM_V1.providerType,
        value: "Homemaker and Companion Services",
        asserted: "KNOWN",
      },
      {
        subject: "Compassionate Choice",
        claim: CLAIM_V1.serviceArea,
        value: "Hardee, Highlands, Hillsborough, Manatee, Polk",
        asserted: "KNOWN",
        note: "The counties named on the certificate. This is a hard operational boundary.",
      },
      {
        subject: "Compassionate Choice",
        claim: CLAIM_V1.scopeProhibited,
        value: "hands-on personal care: bathing, feeding, dressing, toileting, transferring, medication",
        asserted: "KNOWN",
      },
      {
        subject: "Compassionate Choice",
        claim: CLAIM_V1.officialRole,
        value: "Kristina Diane Leach is the official owner and administrator of record",
        asserted: "KNOWN",
        note: "Legal fact from official records. Separate from AION's operational authorization.",
      },
    ],
  };
}

/** The certificate document itself: located, and not machine-readable here. */
export function compassionateChoiceCertificateDocument(): ProposedSourceV1 {
  return {
    sourceClass: "OFFICIAL_REGULATORY_DOCUMENT",
    reference: "AHCA Certificate of Registration PDF, offline drive (not tracked, not committed)",
    readable: false,
    unreadableReason: "PDF text extraction is unavailable in this environment; the file is located but unread",
    content: "unread-official-certificate",
    observedAtUtc: "2026-06-26T00:00:00Z",
    claims: [
      {
        subject: "Compassionate Choice",
        claim: CLAIM_V1.status,
        value: "as printed on the certificate",
        asserted: "KNOWN",
        note: "Registered as UNREAD_SOURCE. A readable copy would outrank the Owner relay of it.",
      },
    ],
  };
}

/**
 * The May regulatory profile: superseded, and kept.
 *
 * It is loaded as `BUSINESS_DOCUMENT` rather than an official one — it is derived research compiled
 * by the business owner, however carefully cross-referenced. That is why the certificate overtakes
 * it, and why its scope research is still worth having.
 */
export function compassionateChoiceMayProfile(): ProposedSourceV1 {
  return {
    sourceClass: "BUSINESS_DOCUMENT",
    reference: "AHCA_REGULATORY_PROFILE.md, compiled 2026-05-17, offline corpus",
    readable: true,
    content: "ahca-regulatory-profile-2026-05-17",
    observedAtUtc: "2026-05-17T00:00:00Z",
    claims: [
      {
        subject: "Compassionate Choice",
        claim: CLAIM_V1.status,
        value: "PENDING_REGISTRATION",
        asserted: "KNOWN",
        note: "True of 2026-05-17. Superseded by the certificate; preserved as history.",
      },
      {
        subject: "Compassionate Choice",
        claim: CLAIM_V1.scopeAllowed,
        value: "companionship, housekeeping, meal preparation, laundry, shopping, errands, casual cosmetic assistance, steadying while walking",
        asserted: "KNOWN",
      },
      {
        subject: "Compassionate Choice",
        claim: CLAIM_V1.transportLegal,
        value: "transportation is legally permitted within §400.509 scope",
        asserted: "KNOWN",
        note: "Legal scope. Not the same question as whether the business offers it.",
      },
      {
        subject: "Compassionate Choice",
        claim: CLAIM_V1.transportPolicy,
        value: "the business has chosen not to offer transportation, for liability reasons",
        asserted: "KNOWN",
        note: "Business policy. Recorded separately from the legal scope on purpose.",
      },
      {
        subject: "Compassionate Choice",
        claim: CLAIM_V1.employmentModel,
        value: "W-2 employees rather than 1099 contractors",
        asserted: "KNOWN",
      },
      {
        subject: "Compassionate Choice",
        claim: CLAIM_V1.screening,
        value: "Level 2 background screening for owners, managing employees and direct-service staff",
        asserted: "KNOWN",
      },
      {
        subject: "Compassionate Choice",
        claim: CLAIM_V1.advertising,
        value: "the registration number must appear in all advertising",
        asserted: "KNOWN",
      },
    ],
  };
}

/** The July transcript: the weakest source here, and kept for exactly that reason. */
export function compassionateChoiceJulyTranscript(): ProposedSourceV1 {
  return {
    sourceClass: "ASR_TRANSCRIPT",
    reference: "machine transcript, 2026-07-09, offline archive",
    readable: true,
    content: "asr-transcript-2026-07-09",
    observedAtUtc: "2026-07-09T00:00:00Z",
    claims: [
      {
        subject: "Compassionate Choice",
        claim: CLAIM_V1.status,
        value: "reported as cleared, without a geographic claim",
        asserted: "KNOWN",
        note: "Machine-transcribed speech. Cannot carry a fact; recorded as corroboration only.",
      },
    ],
  };
}

/** The pending expansion, which is a real state and not an authority. */
export function compassionateChoicePendingExpansion(): ProposedSourceV1 {
  return {
    sourceClass: "OWNER_STATEMENT",
    reference: "Owner clarification on pending geographic expansion, 2026-08-21",
    readable: true,
    content: "pending-expansion-2026-08-21",
    observedAtUtc: "2026-08-21T00:00:00Z",
    claims: [
      {
        subject: "Compassionate Choice",
        claim: CLAIM_V1.serviceAreaPending,
        value: "areas beyond the five certificate counties are being pursued and are not yet approved in writing",
        asserted: "HYPOTHESIS",
        note: "Deliberately not KNOWN as authority: pending is a plan, and confers nothing operationally.",
      },
    ],
  };
}

/** LocalFinds: the alias the Owner closed, and nothing about the business model. */
export function localFindsAlias(): ProposedSourceV1 {
  return {
    sourceClass: "OWNER_STATEMENT",
    reference: "Owner clarification on brand identity, 2026-08-22",
    readable: true,
    content: "localfinds-alias-2026-08-22",
    observedAtUtc: "2026-08-22T00:00:00Z",
    claims: [
      {
        subject: "LocalFinds",
        claim: CLAIM_V1.brandAlias,
        value: "LakelandFinds is a legacy name for the same business; LocalFinds is canonical",
        asserted: "KNOWN",
      },
      {
        subject: "LocalFinds",
        claim: CLAIM_V1.assets,
        value: "logo, social covers and two lead files exist under the legacy LakelandFinds name",
        asserted: "KNOWN",
        note: "Assets prove a name was used. They say nothing about what the business does.",
      },
      {
        subject: "LocalFinds",
        claim: CLAIM_V1.businessModel,
        value: "",
        asserted: "UNKNOWN",
        note: "Not inferable from a logo, a cover image or a lead list.",
      },
    ],
  };
}

export function talkToCalebAssets(): ProposedSourceV1 {
  return {
    sourceClass: "BUSINESS_DOCUMENT",
    reference: "content export archives and recording folders, June–July 2026, offline archive",
    readable: true,
    content: "talk-to-caleb-assets-2026-07",
    observedAtUtc: "2026-07-17T00:00:00Z",
    claims: [
      {
        subject: "Talk to Caleb",
        claim: CLAIM_V1.assets,
        value: "a real content operation exists: dated export archives and recordings",
        asserted: "KNOWN",
      },
      {
        subject: "Talk to Caleb",
        claim: CLAIM_V1.monetisation,
        value: "",
        asserted: "UNKNOWN",
        note: "Content existing is not a revenue model.",
      },
    ],
  };
}

export function aiServiceCoAssets(): ProposedSourceV1 {
  return {
    sourceClass: "BUSINESS_DOCUMENT",
    reference: "architecture and tooling project folders, offline archive",
    readable: true,
    content: "aiservice-co-assets-2026",
    observedAtUtc: "2026-07-01T00:00:00Z",
    claims: [
      {
        subject: "AIService Co",
        claim: CLAIM_V1.assets,
        value: "architecture and tooling project assets exist",
        asserted: "KNOWN",
      },
      {
        subject: "AIService Co",
        claim: CLAIM_V1.offers,
        value: "",
        asserted: "UNKNOWN",
        note: "AI-assisted business services is a hypothesis about direction, not a recorded offer.",
      },
    ],
  };
}

/** Every source for a workspace, oldest first, so supersession resolves in the order it happened. */
export function corpusFor(workspaceId: string, now: string): readonly ProposedSourceV1[] {
  switch (workspaceId) {
    case COMPASSIONATE_CHOICE_WORKSPACE_V1:
      return [
        compassionateChoiceMayProfile(),
        compassionateChoiceJulyTranscript(),
        compassionateChoiceCertificateDocument(),
        compassionateChoiceCertificate(now),
        compassionateChoicePendingExpansion(),
      ];
    case LOCALFINDS_WORKSPACE_V1:
      return [localFindsAlias()];
    case TALK_TO_CALEB_WORKSPACE_V1:
      return [talkToCalebAssets()];
    case AISERVICE_CO_WORKSPACE_V1:
      return [aiServiceCoAssets()];
    default:
      return [];
  }
}
