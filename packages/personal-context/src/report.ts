/**
 * What AION actually knows about the Owner, written so the Owner can disagree with it.
 *
 * This is the artifact that decides whether the context is good enough to act on, so its job is not
 * to look complete. Its job is to make four things impossible to miss: what is known, where each
 * piece came from, what is uncertain, and what is absent.
 *
 * ## Origin is never blurred
 *
 * Every fact is labelled `OWNER_ENTERED`, `OWNER_CONFIRMED`, `EXTRACTED` or `CONFLICTING`, and the
 * `INFERRED` bucket is rendered even when it is empty — because a report that silently omits the
 * category it does not use is a report that would quietly start including it. Nothing in this
 * package produces an inferred fact, the fact validator refuses to store one, and this report says
 * so out loud each time it runs.
 *
 * ## Absence is content
 *
 * `MISSING IMPORTANT CAREER CONTEXT` is computed from a fixed expectation list rather than from what
 * happens to be present, so a category nobody has enrolled anything for appears as a gap instead of
 * simply not appearing. A recommender reading a report with six gaps should behave differently from
 * one reading a complete picture, and it cannot do that if the gaps are invisible.
 *
 * ## What it deliberately does not contain
 *
 * No raw file bodies, no credential material (refused at validation long before this point), and no
 * values at all when rendered with `redactValues` — which is the mode for anything that might leave
 * the machine. The default mode shows values, because the Owner is the reader and reviewing facts
 * you cannot see is not reviewing.
 */

import type { ProviderIdV1, SensitivityClassV1 } from "@aion/director";

import {
  CONTEXT_CATEGORIES_V1,
  type ContextCategoryV1,
  type ContextSourceV1,
  type FactOriginV1,
  type FreshnessStateV1,
  type PersonalContextFactV1,
} from "./contracts.js";
import { providerEligibleForSensitivity } from "./disclosure.js";
import type { PersonalContextStoreV1 } from "./store.js";

export const OWNER_CONTEXT_REPORT_SCHEMA_V1 = "aion.personalContext.ownerReview.v1" as const;

/**
 * The career context a job recommendation would want, whether or not anything supplies it yet.
 *
 * Fixed rather than derived. Deriving "what is missing" from "what exists" can only ever report
 * nothing missing.
 */
export const EXPECTED_CAREER_CATEGORIES_V1: readonly ContextCategoryV1[] = [
  "CURRENT_EMPLOYMENT",
  "WORK_HISTORY",
  "SKILL",
  "TECHNOLOGY",
  "PROJECT",
  "EDUCATION",
  "CERTIFICATION",
  "LOCATION_PREFERENCE",
  "WORK_MODE_PREFERENCE",
  "COMPENSATION_PREFERENCE",
  "CONSTRAINT",
  "GOAL",
];

export interface ReportFactV1 {
  readonly factId: string;
  readonly category: ContextCategoryV1;
  readonly predicate: string;
  readonly value: string;
  readonly origin: FactOriginV1;
  readonly temporalState: string;
  readonly freshnessState: FreshnessStateV1;
  readonly freshnessEvidence: string;
  readonly conflictState: string;
  readonly conflictsWith: readonly string[];
  readonly sensitivity: SensitivityClassV1;
  readonly sourceId: string;
  readonly sourceDisplayName: string;
  readonly sourceReference: string;
  readonly sourceCommit: string | null;
  readonly evidenceReference: string;
  readonly observedAt: string | null;
  readonly lastConfirmedAt: string | null;
}

export interface ReportSourceV1 {
  readonly sourceId: string;
  readonly displayName: string;
  readonly sourceType: string;
  readonly activeState: string;
  readonly sensitivityClass: SensitivityClassV1;
  readonly eligibleProviders: readonly ProviderIdV1[];
  readonly lastSuccessfulSync: string | null;
  readonly repositoryHead: string | null;
  readonly repositoryRemote: string | null;
  readonly liveFactCount: number;
}

export interface ProviderDisclosureRowV1 {
  readonly provider: ProviderIdV1;
  readonly visibleFacts: number;
  readonly withheldFacts: number;
  readonly withheldCategories: readonly ContextCategoryV1[];
}

export interface OwnerContextReportV1 {
  readonly schema: typeof OWNER_CONTEXT_REPORT_SCHEMA_V1;
  readonly generatedAt: string;
  readonly subject: string;
  readonly ownerContextComplete: "YES" | "NO" | "PARTIAL";
  readonly sourcesEnrolled: number;
  readonly sourcesActive: number;
  readonly sourcesSynced: number;
  readonly totalFacts: number;
  readonly currentFacts: readonly ReportFactV1[];
  readonly historicalFacts: readonly ReportFactV1[];
  readonly skillsAndTechnologies: readonly ReportFactV1[];
  readonly projects: readonly ReportFactV1[];
  readonly preferencesAndConstraints: readonly ReportFactV1[];
  readonly conflicts: readonly ReportFactV1[];
  readonly staleOrUnknown: readonly ReportFactV1[];
  readonly retired: readonly ReportFactV1[];
  readonly byOrigin: Readonly<Record<FactOriginV1, number>>;
  readonly missingCategories: readonly ContextCategoryV1[];
  readonly sources: readonly ReportSourceV1[];
  readonly providerDisclosure: readonly ProviderDisclosureRowV1[];
}

const PREFERENCE_CATEGORIES: readonly ContextCategoryV1[] = [
  "PREFERENCE",
  "CONSTRAINT",
  "LOCATION_PREFERENCE",
  "WORK_MODE_PREFERENCE",
  "COMPENSATION_PREFERENCE",
  "GOAL",
];

const PROVIDERS: readonly ProviderIdV1[] = ["codex", "grok", "claude", "local"];

function toReportFact(fact: PersonalContextFactV1, sources: Map<string, ContextSourceV1>): ReportFactV1 {
  return {
    factId: fact.factId,
    category: fact.category,
    predicate: fact.predicate,
    value: fact.value,
    origin: fact.origin,
    temporalState: fact.temporalState,
    freshnessState: fact.freshnessState,
    freshnessEvidence: fact.freshnessEvidence,
    conflictState: fact.conflictState,
    conflictsWith: fact.conflictsWith,
    sensitivity: fact.sensitivity,
    sourceId: fact.sourceId,
    sourceDisplayName: sources.get(fact.sourceId)?.displayName ?? fact.sourceId,
    sourceReference: fact.sourceReference,
    sourceCommit: fact.sourceCommit,
    evidenceReference: fact.evidenceReference,
    observedAt: fact.observedAt,
    lastConfirmedAt: fact.lastConfirmedAt,
  };
}

/**
 * Build the review from the store as it stands.
 *
 * Facts from a revoked or disabled source are excluded from every "what AION knows" section, because
 * they are no longer disclosable and presenting them as knowledge would overstate the picture. The
 * source itself still appears in the provenance section with its state, so the Owner can see that a
 * source exists and is switched off.
 */
export function buildOwnerContextReport(
  deps: { readonly store: PersonalContextStoreV1 },
  options: { readonly subject: string; readonly now: string },
): OwnerContextReportV1 {
  const allSources = deps.store.listSources();
  const sources = new Map(allSources.map((source) => [source.sourceId, source]));
  const readable = new Set(allSources.filter((source) => source.activeState === "ACTIVE").map((row) => row.sourceId));

  const mine = deps.store.listFacts().filter((fact) => fact.subject === options.subject);
  const live = mine.filter((fact) => fact.supersededBy === null && readable.has(fact.sourceId));
  const retired = mine.filter((fact) => fact.supersededBy !== null);

  const view = (rows: readonly PersonalContextFactV1[]): readonly ReportFactV1[] =>
    [...rows]
      .sort((a, b) => (a.category === b.category ? a.predicate.localeCompare(b.predicate) : a.category.localeCompare(b.category)))
      .map((fact) => toReportFact(fact, sources));

  const byOrigin: Record<FactOriginV1, number> = {
    OWNER_ENTERED: 0,
    OWNER_CONFIRMED: 0,
    EXTRACTED: 0,
    INFERRED: 0,
  };
  for (const fact of live) byOrigin[fact.origin] += 1;

  const presentCategories = new Set(live.map((fact) => fact.category));
  const missingCategories = EXPECTED_CAREER_CATEGORIES_V1.filter((category) => !presentCategories.has(category));

  const providerDisclosure: ProviderDisclosureRowV1[] = PROVIDERS.map((provider) => {
    const visible = live.filter(
      (fact) => providerEligibleForSensitivity(provider, fact.sensitivity) && fact.eligibleProviders.includes(provider),
    );
    const withheld = live.filter((fact) => !visible.includes(fact));
    return {
      provider,
      visibleFacts: visible.length,
      withheldFacts: withheld.length,
      withheldCategories: [...new Set(withheld.map((fact) => fact.category))].sort(),
    };
  });

  const syncedSources = allSources.filter((source) => source.lastSuccessfulSync !== null);
  const ownerContextComplete: "YES" | "NO" | "PARTIAL" =
    live.length === 0 ? "NO" : missingCategories.length === 0 ? "YES" : "PARTIAL";

  return {
    schema: OWNER_CONTEXT_REPORT_SCHEMA_V1,
    generatedAt: options.now,
    subject: options.subject,
    ownerContextComplete,
    sourcesEnrolled: allSources.length,
    sourcesActive: readable.size,
    sourcesSynced: syncedSources.length,
    totalFacts: live.length,
    currentFacts: view(live.filter((fact) => fact.temporalState === "CURRENT")),
    historicalFacts: view(live.filter((fact) => fact.temporalState === "HISTORICAL")),
    skillsAndTechnologies: view(live.filter((fact) => fact.category === "SKILL" || fact.category === "TECHNOLOGY")),
    projects: view(live.filter((fact) => fact.category === "PROJECT")),
    preferencesAndConstraints: view(live.filter((fact) => PREFERENCE_CATEGORIES.includes(fact.category))),
    conflicts: view(live.filter((fact) => fact.conflictState !== "NONE")),
    staleOrUnknown: view(
      live.filter((fact) => fact.freshnessState === "STALE" || fact.freshnessState === "UNKNOWN_FRESHNESS"),
    ),
    retired: view(retired),
    byOrigin,
    missingCategories,
    sources: allSources.map((source) => ({
      sourceId: source.sourceId,
      displayName: source.displayName,
      sourceType: source.sourceType,
      activeState: source.activeState,
      sensitivityClass: source.sensitivityClass,
      eligibleProviders: source.eligibleProviders,
      lastSuccessfulSync: source.lastSuccessfulSync,
      repositoryHead: source.repositoryHead,
      repositoryRemote: source.repositoryRemote,
      liveFactCount: live.filter((fact) => fact.sourceId === source.sourceId).length,
    })),
    providerDisclosure,
  };
}

function renderFactLine(fact: ReportFactV1, redactValues: boolean): string {
  const value = redactValues ? `<${fact.value.length} chars withheld>` : fact.value;
  const commit = fact.sourceCommit === null ? "" : ` @${fact.sourceCommit.slice(0, 10)}`;
  return (
    `- **${fact.predicate}** — ${value}\n` +
    `  - origin: \`${fact.origin}\` · temporal: \`${fact.temporalState}\` · freshness: \`${fact.freshnessState}\`` +
    (fact.conflictState === "NONE" ? "" : ` · conflict: \`${fact.conflictState}\``) +
    `\n  - source: ${fact.sourceDisplayName} (\`${fact.sourceId}\`) · ${fact.sourceReference}${commit}\n` +
    `  - evidence: ${fact.evidenceReference}\n` +
    `  - why that freshness: ${fact.freshnessEvidence}`
  );
}

function renderSection(title: string, facts: readonly ReportFactV1[], redactValues: boolean, empty: string): string {
  if (facts.length === 0) return `## ${title}\n\n_${empty}_\n`;
  return `## ${title}\n\n${facts.map((fact) => renderFactLine(fact, redactValues)).join("\n")}\n`;
}

/**
 * Render the review as Markdown for a local file the Owner reads.
 *
 * `redactValues` exists for any consumer that is not the Owner at their own machine. It replaces
 * values with lengths and keeps every structural fact — origin, freshness, conflict, provenance —
 * so a reviewer can audit the shape of what is stored without reading it.
 */
export function renderOwnerContextReport(
  report: OwnerContextReportV1,
  options: { readonly redactValues?: boolean } = {},
): string {
  const redact = options.redactValues ?? false;
  const lines: string[] = [];

  lines.push(`# AION — what I know about you\n`);
  lines.push(
    `Generated ${report.generatedAt} for subject \`${report.subject}\`. ` +
      `This is local state; it is not committed and it is not uploaded.\n`,
  );

  lines.push(`## Summary\n`);
  lines.push(
    [
      `- Context completeness: **${report.ownerContextComplete}**`,
      `- Sources enrolled: ${report.sourcesEnrolled} (active ${report.sourcesActive}, synced ${report.sourcesSynced})`,
      `- Facts held: ${report.totalFacts}`,
      `- By origin: OWNER_ENTERED ${report.byOrigin.OWNER_ENTERED} · OWNER_CONFIRMED ${report.byOrigin.OWNER_CONFIRMED}` +
        ` · EXTRACTED ${report.byOrigin.EXTRACTED} · INFERRED ${report.byOrigin.INFERRED}`,
      `- Conflicts: ${report.conflicts.length} · Stale or unknown freshness: ${report.staleOrUnknown.length}`,
      "",
      report.byOrigin.INFERRED === 0
        ? "No fact here was inferred. AION does not guess career facts from prose, and the store refuses to hold an inferred fact."
        : "**An inferred fact is present, which should be impossible. Treat this report as untrustworthy and investigate.**",
      "",
    ].join("\n"),
  );

  lines.push(renderSection("Current facts", report.currentFacts, redact, "Nothing is known about the present."));
  lines.push(renderSection("Historical facts", report.historicalFacts, redact, "No past-tense facts are held."));
  lines.push(renderSection("Skills and technologies", report.skillsAndTechnologies, redact, "No skills or technologies are held."));
  lines.push(renderSection("Projects", report.projects, redact, "No projects are held."));
  lines.push(
    renderSection("Preferences and constraints", report.preferencesAndConstraints, redact, "No preferences or constraints are held."),
  );
  lines.push(
    renderSection(
      "Conflicts",
      report.conflicts,
      redact,
      "No approved sources currently disagree.",
    ),
  );
  lines.push(
    renderSection(
      "Stale or unknown freshness",
      report.staleOrUnknown,
      redact,
      "Everything held has usable freshness evidence.",
    ),
  );

  lines.push(`## Missing important career context\n`);
  if (report.missingCategories.length === 0) {
    lines.push(`_Every expected career category has at least one supported fact._\n`);
  } else {
    lines.push(
      `Nothing is held for these categories. They are gaps, not zeros — AION has no basis for a ` +
        `recommendation that depends on them.\n\n` +
        report.missingCategories.map((category) => `- \`${category}\``).join("\n") +
        "\n",
    );
  }

  lines.push(`## Source provenance\n`);
  if (report.sources.length === 0) {
    lines.push(`_No source is enrolled. AION knows nothing about you through this system._\n`);
  } else {
    lines.push(
      report.sources
        .map((source) => {
          const repo =
            source.repositoryHead === null
              ? ""
              : `\n  - repository: ${source.repositoryRemote ?? "<no remote recorded>"} @ ${source.repositoryHead.slice(0, 10)}`;
          return (
            `- **${source.displayName}** (\`${source.sourceId}\`)\n` +
            `  - type: \`${source.sourceType}\` · state: \`${source.activeState}\` · class: \`${source.sensitivityClass}\`\n` +
            `  - providers allowed: ${source.eligibleProviders.join(", ")}\n` +
            `  - last successful sync: ${source.lastSuccessfulSync ?? "never"} · live facts: ${source.liveFactCount}${repo}`
          );
        })
        .join("\n"),
    );
    lines.push("");
  }

  lines.push(`## Provider disclosure restrictions\n`);
  lines.push(
    `What each provider would be shown if it asked for everything. Failover changes which provider ` +
      `runs a job; it never changes these numbers.\n`,
  );
  lines.push(
    ["| Provider | Visible | Withheld | Withheld categories |", "| --- | --- | --- | --- |"]
      .concat(
        report.providerDisclosure.map(
          (row) =>
            `| ${row.provider} | ${row.visibleFacts} | ${row.withheldFacts} | ${row.withheldCategories.length === 0 ? "—" : row.withheldCategories.join(", ")} |`,
        ),
      )
      .join("\n"),
  );
  lines.push("");

  if (report.retired.length > 0) {
    lines.push(
      `## Previously stated, now superseded\n\n` +
        `Kept so an earlier statement stays answerable. These are not used in recommendations.\n\n` +
        report.retired.map((fact) => renderFactLine(fact, redact)).join("\n") +
        "\n",
    );
  }

  return lines.join("\n");
}

/** Every category this build knows about, for a caller enumerating coverage. */
export const ALL_CATEGORIES_V1 = CONTEXT_CATEGORIES_V1;
