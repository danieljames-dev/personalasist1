#!/usr/bin/env node

import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  ApplicationPreparationSchemaRegistryV1, createApplicationDraftV1,
  Sha256ApplicationPreparationIdDeriverV1,
} from "../packages/application-preparation/dist/index.js";
import {
  buildCareerProfileV1, dryRunCareerEvidenceImportV1, importCareerEvidenceV1,
  Sha256CareerEvidenceIdDeriverV1,
} from "../packages/career-evidence/dist/index.js";
import {
  asActorIdV1, asOwnerIdV1, FileIdentityStateRepository, initializeLocalIdentityV1,
  RandomUuidIdentityIdGenerator, SystemIdentityClock, validateLocalIdentityStateV1,
} from "../packages/identity/dist/index.js";
import {
  createJobMatchReportV1, defaultMatchingConfigurationV1, Sha256JobMatchingIdDeriverV1,
} from "../packages/job-matching/dist/index.js";
import { dryRunJobPostingImportV1, importJobPostingV1, Sha256JobPostingIdDeriverV1 } from "../packages/job-posting/dist/index.js";
import {
  Acj1CanonicalSerializerV1, asObjectIdV1, FileObjectRepositoryV1, Sha256ObjectDigestV1, SystemObjectClock,
} from "../packages/object/dist/index.js";
import { authorizeLocalPath, recheckAuthorizedPath } from "../packages/privacy-boundary/dist/index.js";

const COMMANDS = ["init", "ingest", "profile", "job:import", "match", "draft", "export", "demo"];
const HELP = `AION local Career workflow — Reference Candidate

Usage:
  career-cli.mjs init       --root <absolute-workflow-root> [--dry-run]
  career-cli.mjs ingest     --root <absolute-workflow-root> --input <absolute-approved-file> [--type <source-type>] [--dry-run]
  career-cli.mjs profile    --root <absolute-workflow-root> [--dry-run]
  career-cli.mjs job:import --root <absolute-workflow-root> --input <absolute-owner-file> [--dry-run]
  career-cli.mjs match      --root <absolute-workflow-root> --job <object-id> [--dry-run]
  career-cli.mjs draft      --root <absolute-workflow-root> --match <object-id> [--dry-run]
  career-cli.mjs export     --root <absolute-workflow-root> --output <absolute-local-file> [--dry-run]
  career-cli.mjs demo

All domain operations are local-only. Inputs and roots are explicit; no command scans, fetches,
submits, sends, signs, attests, or prints complete Identity identifiers.`;

const ALLOWED = {
  init: ["--root", "--dry-run"], ingest: ["--root", "--input", "--type", "--dry-run"],
  profile: ["--root", "--dry-run"], "job:import": ["--root", "--input", "--dry-run"],
  match: ["--root", "--job", "--dry-run"], draft: ["--root", "--match", "--dry-run"],
  export: ["--root", "--output", "--dry-run"], demo: [],
};
const REQUIRED = {
  init: ["--root"], ingest: ["--root", "--input"], profile: ["--root"],
  "job:import": ["--root", "--input"], match: ["--root", "--job"],
  draft: ["--root", "--match"], export: ["--root", "--output"], demo: [],
};

function parse(argv) {
  const [command, ...tokens] = argv;
  if (!command || ["help", "--help", "-h"].includes(command)) return { command: "help", values: new Map(), dryRun: false };
  if (!COMMANDS.includes(command)) throw new Error("Unsupported Career operation.");
  if (tokens.includes("--help") || tokens.includes("-h")) return { command: "help", values: new Map(), dryRun: false };
  const values = new Map(); let dryRun = false;
  for (let i = 0; i < tokens.length;) {
    const key = tokens[i++];
    if (key === "--dry-run") { if (dryRun) throw new Error("Duplicate Career argument."); dryRun = true; continue; }
    const value = tokens[i++];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || values.has(key)) throw new Error("Career arguments are malformed.");
    values.set(key, value);
  }
  for (const key of [...values.keys(), ...(dryRun ? ["--dry-run"] : [])]) if (!ALLOWED[command].includes(key)) throw new Error("Unsupported Career argument.");
  for (const key of REQUIRED[command]) if (!values.has(key)) throw new Error("A required explicit Career path or Object reference is missing.");
  return { command, values, dryRun };
}
function absolute(value, label) {
  if (!isAbsolute(value) || resolve(value) !== value) throw new Error(`${label} must be an explicit normalized absolute path.`);
  return value;
}
function paths(rootValue) {
  const root = absolute(rootValue, "Workflow root");
  return { root, privateRoot: join(root, "private"), identity: join(root, "private", "identity"),
    objects: join(root, "private", "object-store"), input: join(root, "private", "input"),
    exports: join(root, "private", "exports"), config: join(root, "private", "career-config.json") };
}
function contained(root, selected) {
  const rel = relative(root, selected);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}
function boundary() {
  const apply = (request, recheck) => {
    const converted = { version: "1", operation: request.operation, approvedRoot: { version: "1", reference: request.approvedRootReference, absolutePath: request.approvedRootAbsolutePath }, requestedPath: { version: "1", absolutePath: request.requestedAbsolutePath } };
    const result = recheck ? recheckAuthorizedPath(converted) : authorizeLocalPath(converted);
    return result.authorized ? { authorized: true, resolvedPath: result.resolvedPath } : { authorized: false, reason: result.error.reason };
  };
  return { authorize: (request) => apply(request, false), recheck: (request) => apply(request, true) };
}
async function identity(p) {
  const repository = new FileIdentityStateRepository({ approvedRootAbsolutePath: p.identity, approvedRootReference: "private-career-identity", pathBoundary: boundary() });
  const state = validateLocalIdentityStateV1(await repository.load());
  const owner = state.records.find((item) => item.kind === "owner")?.id;
  const actor = state.records.find((item) => item.kind === "actor")?.id;
  return { ownerId: asOwnerIdV1(owner), actorId: asActorIdV1(actor) };
}
function ports(p, idDeriver) {
  const canonicalizer = new Acj1CanonicalSerializerV1(); const digest = new Sha256ObjectDigestV1();
  const schemaRegistry = new ApplicationPreparationSchemaRegistryV1();
  return { canonicalizer, digest, schemaRegistry, idDeriver, clock: new SystemObjectClock(),
    repository: new FileObjectRepositoryV1({ approvedRootAbsolutePath: p.objects, approvedRootReference: "private-career-objects", validationPorts: { canonicalizer, digest, schemaRegistry } }) };
}
async function loadConfig(p) { return JSON.parse(await readFile(p.config, "utf8")); }
async function saveConfig(p, config) {
  const temp = `${p.config}.tmp`; await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", flag: "wx" }); await rename(temp, p.config);
}
async function replaceConfig(p, config) { try { await rm(`${p.config}.tmp`); } catch {} const temp = `${p.config}.tmp`; await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, "utf8"); await rename(temp, p.config); }
function digestId(prefix, bytes) { return `${prefix}.${createHash("sha256").update(bytes).digest("hex").slice(0, 20)}`; }
function sourceType(parsed, explicit) {
  if (explicit) return explicit;
  if (parsed?.contractVersion === "aion.career-facts-input.v1") return "career-facts-json";
  if (parsed?.contractVersion === "aion.career-preferences-input.v1") return "career-preferences-json";
  throw new Error("JSON input needs a supported contract or an explicit --type.");
}
function factIds(input, operationId, deriver) {
  const ids = [];
  for (const [index, entry] of input.entries.entries()) {
    const root = `/entries/${index}`;
    const locations = [`${root}/value`, `${root}/startDate`, `${root}/endDate`];
    for (const key of ["responsibilities", "accomplishments", "skills", "toolsAndTechnologies"]) for (let i = 0; i < entry[key].length; i++) locations.push(`${root}/${key}/${i}`);
    for (const location of locations) ids.push(deriver.derive(operationId, "career-fact", `${entry.factId}\0${location}`));
  }
  return ids.sort();
}
function matchingFromPreferences(input) {
  const base = defaultMatchingConfigurationV1(); const values = (entry) => entry.state === "specified" ? [...entry.values].sort() : [];
  return { ...base, desiredRoleTitles: values(input.desiredRoles), excludedRoleTitles: values(input.excludedRoles),
    acceptedLocations: values(input.locations), acceptedWorkArrangements: values(input.workArrangements), acceptedEmploymentTypes: values(input.employmentTypes),
    industriesOfInterest: values(input.industriesOfInterest), industriesToAvoid: values(input.industriesToAvoid),
    minimumCompensation: input.minimumCompensation.state === "specified" ? { currency: input.minimumCompensation.currency, minimumMinorUnits: input.minimumCompensation.minimumMinorUnits } : null };
}
async function initialize(p, dryRun) {
  if (dryRun) return { message: "Initialization dry run accepted; no directories or Identity state written." };
  await mkdir(p.input, { recursive: true }); await mkdir(p.exports, { recursive: true }); await mkdir(p.objects, { recursive: true }); await mkdir(p.identity, { recursive: true });
  const identityRepository = new FileIdentityStateRepository({ approvedRootAbsolutePath: p.identity, approvedRootReference: "private-career-identity", pathBoundary: boundary() });
  await initializeLocalIdentityV1(identityRepository, new RandomUuidIdentityIdGenerator(), new SystemIdentityClock());
  const templateRoot = resolve(import.meta.dirname, "..", "templates", "career");
  for (const name of ["career-facts.template.json", "career-preferences.template.json", "job-posting.template.json", "resume-evidence.template.md", "work-history-evidence.template.md"]) {
    const destination = join(p.input, name); try { await stat(destination); } catch { await cp(join(templateRoot, name), destination, { errorOnExist: true }); }
  }
  try { await stat(p.config); } catch { await saveConfig(p, { version: "1", factIds: [], profile: null, jobs: [], matches: [], drafts: [], matchingConfiguration: defaultMatchingConfigurationV1() }); }
  return { message: "Private Career workspace initialized; blank templates copied and no personal facts populated." };
}
async function ingest(p, inputPath, explicitType, dryRun) {
  absolute(inputPath, "Input"); if (!contained(p.input, inputPath)) throw new Error("Career input must be explicitly selected inside the approved private input root.");
  const bytes = await readFile(inputPath); let parsed = null; try { parsed = JSON.parse(bytes.toString("utf8")); } catch {}
  const type = sourceType(parsed, explicitType); const operationId = digestId("career.ingest", bytes); const ids = await identity(p);
  const evidenceDeriver = new Sha256CareerEvidenceIdDeriverV1(); const pPorts = ports(p, evidenceDeriver);
  const request = { version: "1", importOperationId: operationId, ...ids, approvedInputRoot: { version: "1", reference: "private-career-input", absolutePath: p.input }, sourcePath: { version: "1", absolutePath: inputPath }, sourceType: type };
  const result = dryRun ? await dryRunCareerEvidenceImportV1(request, pPorts) : await importCareerEvidenceV1(request, pPorts);
  if ((dryRun && !result.accepted) || (!dryRun && result.outcome === "rejected")) throw new Error(`Career evidence operation rejected: ${result.error?.code ?? "unknown"}.`);
  if (!dryRun) { const config = await loadConfig(p); if (type === "career-facts-json") config.factIds = [...new Set([...config.factIds, ...factIds(parsed, operationId, evidenceDeriver)])].sort();
    if (type === "career-preferences-json") config.matchingConfiguration = matchingFromPreferences(parsed); await replaceConfig(p, config); }
  return { message: dryRun ? `Career evidence dry run accepted (${result.proposedFactCount} proposed facts).` : `Career evidence ${result.outcome}; private facts recorded: ${result.factReferences.length}.` };
}
async function profile(p, dryRun) {
  const config = await loadConfig(p); if (!config.factIds.length) throw new Error("No explicitly ingested CareerFacts are available.");
  if (dryRun) return { message: `Profile dry run accepted (${config.factIds.length} pinned facts; no writes).` };
  const ids = await identity(p); const deriver = new Sha256CareerEvidenceIdDeriverV1(); const operationId = digestId("career.profile", Buffer.from(config.factIds.join("\0")));
  const result = await buildCareerProfileV1({ version: "1", buildOperationId: operationId, ...ids, profileObjectId: null, expectedRevision: null,
    factIds: config.factIds.map(asObjectIdV1), requiredFactTypes: ["role-title", "skill"], buildConfigurationVersion: "1" }, ports(p, deriver));
  if (result.outcome === "rejected") throw new Error(`Career profile rejected: ${result.error?.code ?? "unknown"}.`);
  const profileId = deriver.derive(operationId, "career-profile", "profile"); const stored = await ports(p, deriver).repository.loadCurrent(profileId);
  config.profile = { objectId: profileId, revision: stored.revision }; await replaceConfig(p, config);
  return { message: `CareerProfile ${result.outcome}; included facts: ${result.includedFactCount}; object: ${profileId}.` };
}
async function importJob(p, inputPath, dryRun) {
  absolute(inputPath, "Job input"); if (!contained(p.input, inputPath)) throw new Error("Job input must be explicitly selected inside the approved private input root.");
  const bytes = await readFile(inputPath); const operationId = digestId("career.job", bytes); const ids = await identity(p); const deriver = new Sha256JobPostingIdDeriverV1();
  const request = { version: "1", importOperationId: operationId, ...ids, approvedInputRoot: { version: "1", reference: "private-career-input", absolutePath: p.input }, sourcePath: { version: "1", absolutePath: inputPath }, sourceType: "structured-json", target: { mode: "create" }, listingCurrentness: { version: "1", state: "unknown" } };
  const result = dryRun ? await dryRunJobPostingImportV1(request, ports(p, deriver)) : await importJobPostingV1(request, ports(p, deriver));
  if ((dryRun && !result.accepted) || (!dryRun && result.outcome === "rejected")) throw new Error(`Job Posting operation rejected: ${result.error?.code ?? "unknown"}.`);
  if (dryRun) return { message: "Job Posting dry run accepted; no Object written and currentness remains unknown." };
  const objectId = deriver.derive(operationId, "job-posting", ids.ownerId); const config = await loadConfig(p);
  config.jobs = [...config.jobs.filter((item) => item.objectId !== objectId), { objectId, revision: result.revision }].sort((a, b) => a.objectId.localeCompare(b.objectId)); await replaceConfig(p, config);
  return { message: `JobPosting ${result.outcome}; object: ${objectId}; currentness: unknown.` };
}
async function match(p, jobIdValue, dryRun) {
  const jobId = asObjectIdV1(jobIdValue); const config = await loadConfig(p); if (!config.profile) throw new Error("A CareerProfile must be built first.");
  const repository = ports(p, new Sha256JobMatchingIdDeriverV1()).repository; const job = await repository.loadCurrent(jobId); if (!job) throw new Error("The requested private JobPosting was not found.");
  if (dryRun) return { message: "Job Match dry run accepted with pinned profile and posting revisions; no writes." };
  const ids = await identity(p); const operationId = digestId("career.match", Buffer.from(`${config.profile.objectId}:${config.profile.revision}\0${jobId}:${job.revision}\0${JSON.stringify(config.matchingConfiguration)}`));
  const deriver = new Sha256JobMatchingIdDeriverV1(); const result = await createJobMatchReportV1({ version: "1", matchOperationId: operationId, ...ids,
    careerProfileObjectId: asObjectIdV1(config.profile.objectId), careerProfileRevision: config.profile.revision, jobPostingObjectId: jobId, jobPostingRevision: job.revision,
    configuration: config.matchingConfiguration }, ports(p, deriver));
  if (result.outcome === "rejected") throw new Error(`Job Match rejected: ${result.error?.code ?? "unknown"}.`);
  const objectId = deriver.derive(operationId, "job-match-report", ids.ownerId); config.matches = [...config.matches.filter((item) => item.objectId !== objectId), { objectId, revision: 1 }].sort((a, b) => a.objectId.localeCompare(b.objectId)); await replaceConfig(p, config);
  return { message: `JobMatchReport ${result.outcome}; score: ${result.overallScoreBps}/10000; object: ${objectId}.` };
}
async function draft(p, matchIdValue, dryRun) {
  const matchId = asObjectIdV1(matchIdValue); const config = await loadConfig(p); const repository = ports(p, new Sha256ApplicationPreparationIdDeriverV1()).repository;
  const report = await repository.loadCurrent(matchId); if (!report) throw new Error("The requested private JobMatchReport was not found.");
  if (dryRun) return { message: "Application Draft dry run accepted with a pinned Match revision; no writes." };
  const ids = await identity(p); const operationId = digestId("career.draft", Buffer.from(`${matchId}:${report.revision}`)); const deriver = new Sha256ApplicationPreparationIdDeriverV1();
  const result = await createApplicationDraftV1({ version: "1", preparationOperationId: operationId, ...ids, jobMatchObjectId: matchId, jobMatchRevision: report.revision }, ports(p, deriver));
  if (result.outcome === "rejected") throw new Error(`Application Draft rejected: ${result.error?.code ?? "unknown"}.`);
  const objectId = deriver.derive(operationId, "application-draft", ids.ownerId); config.drafts = [...config.drafts.filter((item) => item.objectId !== objectId), { objectId, revision: 1 }].sort((a, b) => a.objectId.localeCompare(b.objectId)); await replaceConfig(p, config);
  return { message: `ApplicationDraft ${result.outcome}; cited facts: ${result.usedFactCount}; object: ${objectId}; owner review required.` };
}
async function exportBundle(p, output, dryRun) {
  absolute(output, "Output"); if (!contained(p.exports, output)) throw new Error("Export output must be explicitly located inside the approved private exports root.");
  const config = await loadConfig(p); const repository = ports(p, new Sha256ApplicationPreparationIdDeriverV1()).repository;
  const references = [config.profile, ...config.jobs, ...config.matches, ...config.drafts].filter(Boolean); const objects = [];
  for (const ref of references) { const object = await repository.loadRevision(asObjectIdV1(ref.objectId), ref.revision); if (!object) throw new Error("A configured private Object revision is unavailable."); objects.push(object); }
  const bundle = { version: "1", implementationStatus: "Reference Candidate", objects };
  if (dryRun) return { message: `Local export dry run accepted (${objects.length} objects; no write).` };
  await mkdir(p.exports, { recursive: true }); await writeFile(output, `${JSON.stringify(bundle, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  const reloaded = JSON.parse(await readFile(output, "utf8")); if (reloaded.version !== "1" || reloaded.objects.length !== objects.length) throw new Error("Local export reload verification failed.");
  return { message: `Local export and reload verified (${objects.length} private Objects); no external transfer.` };
}

async function runOperation(parsed, io) {
  if (parsed.command === "help") { io.log(HELP); return 0; }
  if (parsed.command === "demo") return runDemo(io);
  const p = paths(parsed.values.get("--root"));
  const result = parsed.command === "init" ? await initialize(p, parsed.dryRun)
    : parsed.command === "ingest" ? await ingest(p, parsed.values.get("--input"), parsed.values.get("--type"), parsed.dryRun)
    : parsed.command === "profile" ? await profile(p, parsed.dryRun)
    : parsed.command === "job:import" ? await importJob(p, parsed.values.get("--input"), parsed.dryRun)
    : parsed.command === "match" ? await match(p, parsed.values.get("--job"), parsed.dryRun)
    : parsed.command === "draft" ? await draft(p, parsed.values.get("--match"), parsed.dryRun)
    : await exportBundle(p, parsed.values.get("--output"), parsed.dryRun);
  io.log(result.message); return 0;
}
export async function runCareerCli(argv, io = console) {
  let parsed; try { parsed = parse(argv); } catch (error) { io.error(error instanceof Error ? error.message : "Career arguments are invalid."); return 2; }
  try { return await runOperation(parsed, io); } catch (error) { io.error(error instanceof Error ? `Career operation failed closed: ${error.message}` : "Career operation failed closed."); return 1; }
}

async function runDemo(io) {
  const root = await mkdtemp(join(tmpdir(), "aion-career-demo-"));
  try {
    const p = paths(root); await initialize(p, false);
    const factsPath = join(p.input, "synthetic-career-facts.json"); const preferencesPath = join(p.input, "synthetic-career-preferences.json"); const jobPath = join(p.input, "synthetic-job-posting.json");
    const entry = (factId, factKind, value) => ({ version: "1", factId, factKind, value: { state: "supplied", value }, startDate: { state: "not-applicable" }, endDate: { state: "not-applicable" }, responsibilities: [], accomplishments: [], skills: [], toolsAndTechnologies: [], evidenceReferences: [], ownerConfirmed: true });
    await writeFile(factsPath, JSON.stringify({ contractVersion: "aion.career-facts-input.v1", entries: [entry("synthetic-role", "role-title", "Orbital Garden Systems Steward"), entry("synthetic-skill-a", "skill", "Deterministic Testing"), entry("synthetic-skill-b", "skill", "TypeScript")] }), "utf8");
    await writeFile(preferencesPath, JSON.stringify({ contractVersion: "aion.career-preferences-input.v1", desiredRoles: { state: "specified", values: ["Orbital Garden Systems Steward"] }, excludedRoles: { state: "unknown", values: [] }, locations: { state: "specified", values: ["Example Harbor"] }, workArrangements: { state: "specified", values: ["remote"] }, employmentTypes: { state: "specified", values: ["full-time"] }, minimumCompensation: { state: "unknown" }, scheduleConstraints: { state: "unknown", values: [] }, travelPreference: { state: "unknown", values: [] }, industriesOfInterest: { state: "unknown", values: [] }, industriesToAvoid: { state: "unknown", values: [] } }), "utf8");
    await writeFile(jobPath, JSON.stringify({ contractVersion: "aion.job-posting-input.v1", title: { state: "supplied", value: "Orbital Garden Systems Steward" }, company: { state: "supplied", value: "Neutral Celestial Horticulture Lab" }, location: { state: "supplied", value: "Example Harbor" }, workArrangement: { state: "supplied", value: "remote" }, employmentType: { state: "supplied", value: "full-time" }, compensation: { state: "unknown" }, description: { state: "supplied", value: "Maintain synthetic garden-control systems." }, requiredSkills: { state: "specified", values: ["Deterministic Testing", "TypeScript"] }, preferredSkills: { state: "unknown", values: [] }, requiredExperience: { state: "unknown" }, educationRequirements: { state: "unknown", values: [] }, certificationRequirements: { state: "unknown", values: [] }, travel: { state: "unknown" }, schedule: { state: "unknown" }, applicationDeadline: { state: "unknown" }, sourceReference: { state: "explicit-empty" } }), "utf8");
    io.log("Synthetic Owner/Principal/Actor/System Instance references initialized (identifiers withheld).");
    io.log((await ingest(p, factsPath, undefined, false)).message); io.log((await ingest(p, preferencesPath, undefined, false)).message); io.log((await profile(p, false)).message);
    io.log((await importJob(p, jobPath, false)).message); let config = await loadConfig(p); const jobId = config.jobs[0].objectId;
    io.log((await match(p, jobId, false)).message); config = await loadConfig(p); const matchId = config.matches[0].objectId;
    io.log((await draft(p, matchId, false)).message); const output = join(p.exports, "synthetic-career-export.json"); io.log((await exportBundle(p, output, false)).message);
    const retryMatch = await match(p, jobId, false); const retryDraft = await draft(p, matchId, false); io.log(`${retryMatch.message} ${retryDraft.message}`);
    io.log("Synthetic Career demo complete: provenance, profile, transparent match, review-gated draft, evidence appendix, export, reload, and deterministic reruns verified.");
    return 0;
  } finally { await rm(root, { recursive: true, force: true }); }
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invoked) process.exitCode = await runCareerCli(process.argv.slice(2));
