/**
 * The Owner-facing half: stating a job without a file, and the gate that decides what may be read.
 *
 * Two failure modes drive this suite. The first is a form that fills itself in — a system that turns
 * "I did not answer that" into a stored value, which then reads as fact forever. The second is a
 * sensitivity gate that an agent can widen by editing a constant, which is what the ceiling used to
 * be. Both are tested by pushing on the refusals, not by confirming the happy path works.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { resolveEnrollmentCeiling, withinCeiling, type OwnerAuthorityRecordV1 } from "../src/authority.js";
import { authorityFromPersonalContext } from "../src/contracts.js";
import { defaultsForSourceType, isPersonalSourceType } from "../src/enrollment-defaults.js";
import { registerContextSource, setSourceState } from "../src/enrollment.js";
import { parsePackedRef, parseRemoteUrl, readRepositoryIdentity } from "../src/git-identity.js";
import { buildOwnerCurrentJobFacts, recordOwnerCurrentJob, type OwnerEntryResultV1 } from "../src/owner-entry.js";
import { buildOwnerContextReport, renderOwnerContextReport } from "../src/report.js";
import { createMemoryPersonalContextStore } from "../src/store.js";
import { FakeFs, makeSource, NOW } from "./fixtures.js";

const LATER = "2026-09-20T12:00:00Z";

function authority(overrides: Partial<OwnerAuthorityRecordV1> = {}): OwnerAuthorityRecordV1 {
  return {
    schemaVersion: "aion.ownerStandingAuthority.v1",
    ownerAuthorizationId: "OWNER-CONTEXT-ENROLLMENT-V1-20260818T172656Z",
    milestoneId: "OWNER-CONTEXT-ENROLLMENT-V1",
    state: "ACTIVE",
    sensitiveDataPermission: "YES",
    expiresAtUtc: "",
    ...overrides,
  };
}

function ownerJobStore() {
  const store = createMemoryPersonalContextStore();
  const registered = registerContextSource(
    {
      sourceId: "current-job",
      sourceType: "OWNER_ENTERED_CURRENT_JOB",
      location: "c:/pc-test/owner-entry",
      displayName: "Current job, stated by the Owner",
      purpose: "What the Owner says about their current work",
    },
    { store, now: NOW, authority: authority() },
  );
  assert.equal(registered.registered, true, registered.registered === false ? registered.detail : "");
  return store;
}

function entered(result: OwnerEntryResultV1 | { error: string }): OwnerEntryResultV1 {
  assert.ok(!("error" in result), "error" in result ? result.error : "");
  return result;
}

/* -------------------------------------------------------------------------- */
/* The ceiling is authority, not a constant                                    */
/* -------------------------------------------------------------------------- */

test("the enrollment ceiling comes from the Owner authority record", () => {
  const granted = resolveEnrollmentCeiling(authority({ sensitiveDataPermission: "YES" }), NOW);
  assert.equal(granted.ceiling, "CONFIDENTIAL");
  assert.equal(granted.basis, "OWNER_AUTHORITY_SENSITIVE_YES");
  assert.equal(withinCeiling("CONFIDENTIAL", granted), true);
  assert.equal(withinCeiling("RESTRICTED", granted), false, "RESTRICTED is never reachable from an authority record");

  const withheld = resolveEnrollmentCeiling(authority({ sensitiveDataPermission: "NO" }), NOW);
  assert.equal(withheld.ceiling, "INTERNAL");
  assert.equal(withinCeiling("CONFIDENTIAL", withheld), false);
});

test("every unusable authority fails closed to the default ceiling", () => {
  for (const [label, record] of [
    ["missing", null],
    ["revoked", authority({ state: "REVOKED" })],
    ["suspended", authority({ state: "SUSPENDED" })],
    ["expired", authority({ expiresAtUtc: "2026-01-01T00:00:00Z" })],
    ["malformed", { ...authority(), sensitiveDataPermission: "MAYBE" } as OwnerAuthorityRecordV1],
    ["wrong schema", { ...authority(), schemaVersion: "something.else" } as OwnerAuthorityRecordV1],
  ] as const) {
    const decision = resolveEnrollmentCeiling(record, NOW);
    assert.equal(decision.ceiling, "INTERNAL", `${label} should fail closed`);
    assert.notEqual(decision.basis, "OWNER_AUTHORITY_SENSITIVE_YES", `${label} must not grant sensitive data`);
  }
});

test("a confidential source is refused without authority and accepted with it", () => {
  const input = {
    sourceId: "resume",
    sourceType: "RESUME_CV" as const,
    location: "c:/pc-test/resume",
    displayName: "Resume",
    purpose: "Career evidence",
  };

  const withoutAuthority = registerContextSource(input, { store: createMemoryPersonalContextStore(), now: NOW });
  assert.equal(withoutAuthority.registered, false);
  assert.equal(
    withoutAuthority.registered === false ? withoutAuthority.reason : null,
    "SENSITIVITY_ABOVE_MILESTONE_CEILING",
  );
  assert.match(
    String(withoutAuthority.registered === false ? withoutAuthority.detail : ""),
    /NO_AUTHORITY_SUPPLIED/,
  );

  const withAuthority = registerContextSource(input, {
    store: createMemoryPersonalContextStore(),
    now: NOW,
    authority: authority(),
  });
  assert.equal(withAuthority.registered, true);
  assert.equal(withAuthority.registered === true ? withAuthority.source.sensitivityClass : null, "CONFIDENTIAL");
  assert.equal(withAuthority.registered === true ? withAuthority.ceiling.ceiling : null, "CONFIDENTIAL");
  // The row records which authority permitted it, not today's guess.
  assert.equal(
    withAuthority.registered === true ? withAuthority.source.ownerAuthorizationId : null,
    "OWNER-CONTEXT-ENROLLMENT-V1-20260818T172656Z",
  );
});

/* -------------------------------------------------------------------------- */
/* Least-disclosure defaults                                                   */
/* -------------------------------------------------------------------------- */

test("every personal source type defaults to local-only disclosure", () => {
  for (const type of ["RESUME_CV", "WORK_HISTORY", "OWNER_ENTERED_CURRENT_JOB", "APPROVED_LOCAL_FILE", "APPROVED_LOCAL_FOLDER"] as const) {
    const defaults = defaultsForSourceType(type);
    assert.deepEqual([...defaults.eligibleProviders], ["local"], `${type} should default to local-only`);
    assert.equal(isPersonalSourceType(type), true, `${type} should be treated as personal`);
  }
  // AION's own project context is not personal and is readable by the providers already working on it.
  assert.equal(isPersonalSourceType("AION_REPOSITORY"), false);
  assert.ok(defaultsForSourceType("AION_REPOSITORY").eligibleProviders.length > 1);
});

test("a git source excludes .git and build output from the content walk by default", () => {
  const defaults = defaultsForSourceType("APPROVED_GIT_REPOSITORY");
  for (const excluded of [".git", "node_modules", "dist"]) {
    assert.ok(defaults.deniedScope.includes(excluded), `${excluded} should be excluded`);
  }
  assert.ok(defaults.maxDepth <= 4);
});

test("the Owner only has to supply where and what; the rest comes from defaults", () => {
  const store = createMemoryPersonalContextStore();
  const result = registerContextSource(
    {
      sourceId: "work-folder",
      sourceType: "APPROVED_LOCAL_FOLDER",
      location: "c:/pc-test/work",
      displayName: "Work folder",
      purpose: "Approved work material",
    },
    { store, now: NOW, authority: authority() },
  );
  assert.equal(result.registered, true);
  const source = result.registered === true ? result.source : null;
  assert.ok(source);
  assert.equal(source.sensitivityClass, "CONFIDENTIAL");
  assert.deepEqual([...source.eligibleProviders], ["local"]);
  assert.equal(source.followSymlinksAllowed, false);
  assert.equal(source.recursiveAllowed, true);
  assert.ok(source.maxDepth > 0 && source.maxFiles > 0 && source.maxBytes > 0);
});

/* -------------------------------------------------------------------------- */
/* File-free Owner current-job entry                                           */
/* -------------------------------------------------------------------------- */

test("the Owner states a current job without writing a file, and it is stored as Owner-entered", () => {
  const store = ownerJobStore();
  const result = entered(
    recordOwnerCurrentJob(
      "current-job",
      {
        employer: "Fixture Employer",
        title: "Fixture Role A",
        industry: "Fixture Industry",
        responsibilities: ["Fixture responsibility"],
        tools: ["Fixture Platform"],
        skills: ["Process design", "SQL"],
        projects: ["Fixture Project"],
        startDate: "2024-02-01T00:00:00Z",
      },
      { store, now: NOW },
    ),
  );

  assert.equal(result.receipt.outcome, "COMPLETED");
  assert.equal(result.receipt.filesRead, 0, "an Owner entry reads no file");
  assert.ok(result.facts.length >= 8);

  const stored = store.listFacts();
  assert.equal(stored.every((fact) => fact.origin === "OWNER_ENTERED"), true);
  assert.equal(stored.every((fact) => fact.sourceReference === "owner-entry"), true);
  assert.equal(stored.every((fact) => fact.temporalState === "CURRENT"), true);
  assert.equal(stored.every((fact) => fact.freshnessState === "CURRENT"), true);
  assert.equal(stored.every((fact) => fact.confidence === "HIGH"), true);
  assert.ok(stored.every((fact) => /Stated directly by the Owner/.test(fact.evidenceReference)));

  const employer = stored.find((fact) => fact.predicate === "employer");
  assert.equal(employer?.category, "CURRENT_EMPLOYMENT");
  assert.equal(employer?.validFrom, "2024-02-01T00:00:00Z");
  // Least disclosure survives all the way to the fact.
  assert.deepEqual([...(employer?.eligibleProviders ?? [])], ["local"]);
});

test("two skills are two facts, not one slot with two competing answers", () => {
  const store = ownerJobStore();
  entered(recordOwnerCurrentJob("current-job", { skills: ["SQL", "Process design"] }, { store, now: NOW }));

  const skills = store.listFacts().filter((fact) => fact.category === "SKILL");
  assert.equal(skills.length, 2);
  assert.equal(new Set(skills.map((fact) => fact.claimKey)).size, 2, "each skill gets its own slot");
  assert.equal(skills.every((fact) => fact.conflictState === "NONE"), true, "the Owner's own skills must not conflict");
  assert.equal(skills.every((fact) => fact.supersededBy === null), true);
});

test("a partial entry stores what was given and reports what was not, inventing nothing", () => {
  const store = ownerJobStore();
  const result = entered(recordOwnerCurrentJob("current-job", { title: "Fixture Role A" }, { store, now: NOW }));

  assert.equal(result.facts.length, 1);
  assert.deepEqual(
    [...result.notSupplied].sort(),
    ["employer", "industry", "projects", "responsibilities", "skills", "startDate", "tools"],
  );

  const stored = store.listFacts();
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.predicate, "title");
  // Nothing stands in for the employer: not a blank, not "unknown", not a placeholder.
  assert.equal(stored.some((fact) => fact.predicate === "employer"), false);
  assert.equal(stored.some((fact) => /unknown|n\/a|tbd/i.test(fact.value)), false);
});

test("an empty entry stores nothing at all", () => {
  const store = ownerJobStore();
  const result = entered(recordOwnerCurrentJob("current-job", {}, { store, now: NOW }));
  assert.equal(result.facts.length, 0);
  assert.equal(store.listFacts().length, 0);
  assert.equal(result.notSupplied.length, 8);
});

test("whitespace-only values are not values", () => {
  const store = ownerJobStore();
  entered(recordOwnerCurrentJob("current-job", { employer: "   ", skills: ["", "  "] }, { store, now: NOW }));
  assert.equal(store.listFacts().length, 0);
});

test("re-confirming the same job updates the confirmation without duplicating the facts", () => {
  const store = ownerJobStore();
  entered(recordOwnerCurrentJob("current-job", { title: "Fixture Role A" }, { store, now: NOW }));
  const again = entered(recordOwnerCurrentJob("current-job", { title: "Fixture Role A" }, { store, now: LATER }));

  const live = store.listFacts().filter((fact) => fact.supersededBy === null);
  assert.equal(live.length, 1);
  assert.equal(live[0]?.lastConfirmedAt, LATER, "the confirmation moved forward");
  assert.equal(again.created.length, 0, "restating the same value is not a new fact");
  assert.ok(again.updated.length + again.unchanged.length >= 1);
});

test("a changed answer supersedes the old one, and an unrepeated one is retired rather than left live", () => {
  const store = ownerJobStore();
  entered(
    recordOwnerCurrentJob("current-job", { title: "Fixture Role B", skills: ["SQL", "COBOL"] }, { store, now: NOW }),
  );
  const restated = entered(
    recordOwnerCurrentJob("current-job", { title: "Fixture Role A", skills: ["SQL"] }, { store, now: LATER }),
  );

  const all = store.listFacts();
  const live = all.filter((fact) => fact.supersededBy === null);

  assert.equal(live.some((fact) => fact.value === "Fixture Role A"), true);
  assert.equal(live.some((fact) => fact.value === "Fixture Role B"), false, "the old title is no longer live");
  assert.equal(live.some((fact) => fact.value === "COBOL"), false, "an unrepeated skill is retired");
  assert.equal(live.some((fact) => fact.value === "SQL"), true);

  // Retired, never deleted: the earlier statement stays answerable.
  assert.equal(all.some((fact) => fact.value === "COBOL"), true);
  assert.ok(restated.retired.length >= 1);
});

test("MERGE keeps what a restatement would have retired", () => {
  const store = ownerJobStore();
  entered(recordOwnerCurrentJob("current-job", { skills: ["SQL", "COBOL"] }, { store, now: NOW }));
  entered(recordOwnerCurrentJob("current-job", { skills: ["Rust"], mode: "MERGE" }, { store, now: LATER }));

  const live = store.listFacts().filter((fact) => fact.supersededBy === null);
  assert.deepEqual(live.map((fact) => fact.value).sort(), ["COBOL", "Rust", "SQL"]);
});

test("an Owner entry is refused against a source that is not an Owner-entry source", () => {
  const store = createMemoryPersonalContextStore();
  store.saveSource(makeSource({ sourceId: "folder-source" }));
  const result = recordOwnerCurrentJob("folder-source", { title: "X" }, { store, now: NOW });
  assert.ok("error" in result);
  assert.match(String("error" in result ? result.error : ""), /not an Owner-entry source/);
});

test("an Owner entry is refused against an unregistered or revoked source", () => {
  const store = ownerJobStore();
  assert.ok("error" in recordOwnerCurrentJob("nope", { title: "X" }, { store, now: NOW }));
  setSourceState("current-job", "REVOKED", { store, now: NOW });
  const revoked = recordOwnerCurrentJob("current-job", { title: "X" }, { store, now: NOW });
  assert.ok("error" in revoked);
  assert.match(String("error" in revoked ? revoked.error : ""), /REVOKED/);
});

test("building the facts is pure, so a caller can preview before storing", () => {
  const source = makeSource({ sourceType: "OWNER_ENTERED_CURRENT_JOB", sensitivityClass: "CONFIDENTIAL", eligibleProviders: ["local"] });
  const first = buildOwnerCurrentJobFacts({ title: "Fixture Role A" }, source, NOW);
  const second = buildOwnerCurrentJobFacts({ title: "Fixture Role A" }, source, NOW);
  assert.deepEqual(first.facts, second.facts, "the same input produces the same facts");
  assert.equal(first.facts[0]?.origin, "OWNER_ENTERED");
});

test("no stored fact grants authority, however the Owner phrased it", () => {
  const store = ownerJobStore();
  entered(
    recordOwnerCurrentJob("current-job", { employer: "Fixture Employer", tools: ["Fixture Platform", "Fixture Service"] }, { store, now: NOW }),
  );
  for (const fact of store.listFacts()) {
    const answer = authorityFromPersonalContext(fact);
    assert.equal(answer.granted, false);
    assert.match(answer.requiredInstead, /Owner-authorized directive/);
  }
});

/* -------------------------------------------------------------------------- */
/* Git identity                                                                */
/* -------------------------------------------------------------------------- */

test("repository identity is read from the checkout, loose ref and packed alike", () => {
  const head = "a".repeat(40);
  const looseFs = new FakeFs()
    .addDir("c:/pc-test/repo")
    .addFile("c:/pc-test/repo/.git/HEAD", "ref: refs/heads/main\n", 1)
    .addFile("c:/pc-test/repo/.git/refs/heads/main", `${head}\n`, 1)
    .addFile("c:/pc-test/repo/.git/config", '[remote "origin"]\n\turl = https://example.invalid/repo.git\n', 1);
  const loose = readRepositoryIdentity(makeSource({ location: "c:/pc-test/repo" }), looseFs);
  assert.equal(loose.head, head);
  assert.equal(loose.remote, "https://example.invalid/repo.git");

  const packedFs = new FakeFs()
    .addDir("c:/pc-test/repo")
    .addFile("c:/pc-test/repo/.git/HEAD", "ref: refs/heads/main\n", 1)
    .addFile("c:/pc-test/repo/.git/packed-refs", `# pack-refs with: peeled\n${head} refs/heads/main\n`, 1);
  const packed = readRepositoryIdentity(makeSource({ location: "c:/pc-test/repo" }), packedFs);
  assert.equal(packed.head, head);
  assert.match(packed.detail, /packed-refs/);
});

test("a detached HEAD names its commit, and an unreadable layout reports null rather than a guess", () => {
  const sha = "b".repeat(40);
  const detached = readRepositoryIdentity(
    makeSource({ location: "c:/pc-test/repo" }),
    new FakeFs().addDir("c:/pc-test/repo").addFile("c:/pc-test/repo/.git/HEAD", `${sha}\n`, 1),
  );
  assert.equal(detached.head, sha);

  const unborn = readRepositoryIdentity(
    makeSource({ location: "c:/pc-test/repo" }),
    new FakeFs().addDir("c:/pc-test/repo").addFile("c:/pc-test/repo/.git/HEAD", "ref: refs/heads/main\n", 1),
  );
  assert.equal(unborn.head, null);
  assert.match(unborn.detail, /neither a loose ref nor in packed-refs/);

  const notARepo = readRepositoryIdentity(
    makeSource({ location: "c:/pc-test/plain" }),
    new FakeFs().addDir("c:/pc-test/plain"),
  );
  assert.equal(notARepo.head, null);
  assert.match(notARepo.detail, /not a Git checkout/);
});

test("a linked worktree points outside the approved root, so its commit is not read", () => {
  const fs = new FakeFs()
    .addDir("c:/pc-test/repo")
    .addFile("c:/pc-test/repo/.git", "gitdir: c:/elsewhere/.git/worktrees/x\n", 1);
  const identity = readRepositoryIdentity(makeSource({ location: "c:/pc-test/repo" }), fs);
  assert.equal(identity.head, null);
  assert.match(identity.detail, /outside the approved root/);
});

test("config and packed-ref parsing pick the right line", () => {
  assert.equal(
    parseRemoteUrl('[remote "upstream"]\n\turl = https://a.invalid/u.git\n[remote "origin"]\n\turl = https://b.invalid/o.git\n'),
    "https://b.invalid/o.git",
  );
  assert.equal(parseRemoteUrl('[remote "upstream"]\n\turl = https://a.invalid/u.git\n'), "https://a.invalid/u.git");
  assert.equal(parseRemoteUrl("[core]\n\tbare = false\n"), null);
  const sha = "c".repeat(40);
  assert.equal(parsePackedRef(`# comment\n${sha} refs/heads/main\n^${"d".repeat(40)}\n`, "refs/heads/main"), sha);
  assert.equal(parsePackedRef(`${sha} refs/heads/other\n`, "refs/heads/main"), null);
});

/* -------------------------------------------------------------------------- */
/* Owner review report                                                         */
/* -------------------------------------------------------------------------- */

function reportStore() {
  const store = ownerJobStore();
  entered(
    recordOwnerCurrentJob(
      "current-job",
      {
        employer: "Fixture Employer",
        title: "Fixture Role A",
        skills: ["SQL"],
        projects: ["Fixture Project"],
      },
      { store, now: NOW },
    ),
  );
  return store;
}

test("the report separates what is known, what is uncertain, and what is absent", () => {
  const store = reportStore();
  const report = buildOwnerContextReport({ store }, { subject: "owner", now: NOW });

  assert.equal(report.ownerContextComplete, "PARTIAL");
  assert.equal(report.sourcesEnrolled, 1);
  assert.ok(report.totalFacts >= 4);
  assert.equal(report.byOrigin.OWNER_ENTERED, report.totalFacts);
  assert.equal(report.byOrigin.EXTRACTED, 0);
  assert.equal(report.byOrigin.INFERRED, 0, "nothing may ever be inferred");

  assert.ok(report.currentFacts.length >= 4);
  assert.equal(report.historicalFacts.length, 0);
  assert.ok(report.skillsAndTechnologies.some((fact) => fact.value === "SQL"));
  assert.ok(report.projects.some((fact) => fact.value === "Fixture Project"));

  // Absence is content: categories with nothing are named rather than omitted.
  for (const expected of ["WORK_HISTORY", "EDUCATION", "LOCATION_PREFERENCE", "COMPENSATION_PREFERENCE"]) {
    assert.ok(report.missingCategories.includes(expected as never), `${expected} should be reported missing`);
  }
  assert.equal(report.missingCategories.includes("CURRENT_EMPLOYMENT"), false);
});

test("an empty store reports NO rather than a tidy-looking nothing", () => {
  const report = buildOwnerContextReport({ store: createMemoryPersonalContextStore() }, { subject: "owner", now: NOW });
  assert.equal(report.ownerContextComplete, "NO");
  assert.equal(report.totalFacts, 0);
  assert.equal(report.sourcesEnrolled, 0);
  assert.ok(report.missingCategories.length > 0);

  const rendered = renderOwnerContextReport(report);
  assert.match(rendered, /No source is enrolled/);
  assert.match(rendered, /Context completeness: \*\*NO\*\*/);
});

test("the report drops facts from a revoked source but still shows the source", () => {
  const store = reportStore();
  setSourceState("current-job", "REVOKED", { store, now: LATER });
  const report = buildOwnerContextReport({ store }, { subject: "owner", now: LATER });

  assert.equal(report.totalFacts, 0, "revoked facts are not presented as knowledge");
  assert.equal(report.sourcesEnrolled, 1);
  assert.equal(report.sources[0]?.activeState, "REVOKED");
  assert.equal(report.ownerContextComplete, "NO");
});

test("the report states provider disclosure honestly, per provider", () => {
  const store = reportStore();
  const report = buildOwnerContextReport({ store }, { subject: "owner", now: NOW });

  const local = report.providerDisclosure.find((row) => row.provider === "local");
  const grok = report.providerDisclosure.find((row) => row.provider === "grok");
  assert.equal(local?.visibleFacts, report.totalFacts, "local sees the local-only facts");
  assert.equal(grok?.visibleFacts, 0, "least disclosure means a cloud provider sees none of it");
  assert.equal(grok?.withheldFacts, report.totalFacts);
  assert.ok((grok?.withheldCategories.length ?? 0) > 0);
});

test("the rendered report labels origin everywhere and says nothing was inferred", () => {
  const store = reportStore();
  const rendered = renderOwnerContextReport(buildOwnerContextReport({ store }, { subject: "owner", now: NOW }));

  assert.match(rendered, /origin: `OWNER_ENTERED`/);
  assert.match(rendered, /No fact here was inferred/);
  assert.match(rendered, /## Missing important career context/);
  assert.match(rendered, /## Provider disclosure restrictions/);
  assert.match(rendered, /## Source provenance/);
  assert.match(rendered, /not committed and it is not uploaded/);
  assert.match(rendered, /Fixture Employer/, "the Owner reviewing their own facts must be able to see them");
});

test("redacted rendering keeps every structural fact and no values", () => {
  const store = reportStore();
  const report = buildOwnerContextReport({ store }, { subject: "owner", now: NOW });
  const redacted = renderOwnerContextReport(report, { redactValues: true });

  assert.equal(redacted.includes("Fixture Employer"), false, "a value must not survive redaction");
  assert.equal(redacted.includes("Fixture Project"), false);
  assert.match(redacted, /chars withheld/);
  // Structure survives, so the shape stays auditable without the content.
  assert.match(redacted, /origin: `OWNER_ENTERED`/);
  assert.match(redacted, /## Provider disclosure restrictions/);
});

test("a conflict between the Owner and a document is shown, not resolved", () => {
  const store = reportStore();
  // A second source that disagrees with what the Owner said about their own title.
  store.saveSource(
    makeSource({
      sourceId: "resume",
      sourceType: "RESUME_CV",
      sensitivityClass: "CONFIDENTIAL",
      eligibleProviders: ["local"],
      location: "c:/pc-test/resume",
    }),
  );
  const ownerTitle = store.listFacts().find((fact) => fact.predicate === "title");
  assert.ok(ownerTitle);
  store.saveFacts([
    { ...ownerTitle, conflictState: "CONFIRMED", conflictsWith: ["resume-title"] },
    {
      ...ownerTitle,
      factId: "resume-title",
      sourceId: "resume",
      origin: "EXTRACTED",
      sourceReference: "resume.json",
      value: "Fixture Role B",
      normalizedValue: "operations manager",
      evidenceReference: "resume.json#facts[0]",
      contentFingerprint: "resume-fp",
      conflictState: "CONFIRMED",
      conflictsWith: [ownerTitle.factId],
    },
  ]);

  const report = buildOwnerContextReport({ store }, { subject: "owner", now: NOW });
  assert.equal(report.conflicts.length, 2, "both sides of the disagreement are shown");
  assert.deepEqual([...new Set(report.conflicts.map((fact) => fact.origin))].sort(), ["EXTRACTED", "OWNER_ENTERED"]);
  assert.equal(report.byOrigin.OWNER_ENTERED > 0 && report.byOrigin.EXTRACTED > 0, true);

  const rendered = renderOwnerContextReport(report);
  assert.match(rendered, /## Conflicts/);
  assert.match(rendered, /conflict: `CONFIRMED`/);
});
