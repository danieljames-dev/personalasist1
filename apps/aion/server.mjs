import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve, basename, relative, sep, isAbsolute } from "node:path";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import {
  AionAssistantV1, AuthorityGatedStateRepositoryV1, BoundaryModelProviderV1, DeterministicModelProviderV1, DeveloperAgentCapabilityV1,
  FileStateRepositoryV1, LocalArchiveImportSourceV1, LocalEchoCapabilityV1, NodePrivateBackupV1,
  CompositeBrainRuntimeV1, InProcessBrainRuntimeV1, OwnerAuthorityRuntimeV2,
  RandomIdGeneratorV1, SelectableDeveloperAgentRegistryV1, StaticCapabilityRegistryV1, SystemClockV1,
  UnavailableGpuInfrastructureV1, UnavailableResearchProviderV1, VerificationCapabilityV1, digestValue, validateBindAddress,
  defaultGmailConfig, gmailConnectorStatus, defaultMetricoolConfig, metricoolConnectorStatus,
  imageUnderstandingStatus, extractImageMetadataOnly, extractImageWithLocalVision,
  walkAuthorizedFolder, mimeForBulkExtension, hashBytes,
  discoverPrivateLanAddresses, discoverAccessEndpoints, buildPhoneUrl, buildAppUrl,
} from "../../packages/local-assistant/dist/index.js";
import { HttpBrainRuntimeV1 } from "./brain-runtime.mjs";
import { createDockerCodeSandboxV1 } from "./code-sandbox.mjs";
import { DEFAULT_VAST_CREDENTIAL_VARIABLE, VastAiInfrastructureV1 } from "./vast-ai.mjs";
import { PublicUrlResearchProviderV1, SearxngSearchProviderV1 } from "./research-fetch.mjs";
import { resolveDeveloperAgentBridges } from "./developer-agent.mjs";
import { AllowlistedVerificationRunnerV1 } from "./verification.mjs";
import { remoteAccessStatus } from "./private-network.mjs";

/** Bump when shipping mobile UI fixes so phones load new CSS/JS without manual cache clear. */
const ASSET_VERSION = "20260810m7";
const ASSETS = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/phone", ["phone.html", "text/html; charset=utf-8"]],
  ["/phone.html", ["phone.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/sw.js", ["sw.js", "text/javascript; charset=utf-8"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
  ["/icon.svg", ["icon.svg", "image/svg+xml; charset=utf-8"]],
]);
/** The shell an unpaired device may fetch so it can render the pairing screen. Never any data. */
const PUBLIC_ASSETS = new Set(["/", "/phone", "/phone.html", "/app.js", "/styles.css", "/sw.js", "/manifest.webmanifest", "/icon.svg"]);
const MAX_BODY = 8 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const ASSET_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const CAREER_COMMANDS = new Set(["init", "ingest", "profile", "job:import", "match", "draft", "export", "demo"]);
const runFile = promisify(execFile);
/** The environment variable naming an owner-controlled search instance. Optional. */
const SEARCH_VARIABLE = "AION_SEARCH_BASE_URL";

/** Removes absolute local paths from any text that reaches the browser, logs, or activity. */
function privacySafe(text) {
  return String(text ?? "").replace(/\\\\[^\s"'<>|]+/gu, "[local path]").replace(/[A-Za-z]:[\\/][^\s"'<>|]*/gu, "[local path]");
}
/** Escape HTML for OAuth callback pages (never inject raw OAuth payloads). */
function escHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function absolute(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be an explicit path.`);
  const normalized = resolve(value);
  if (normalized !== value) throw new Error(`${label} must already be a normalized absolute path.`);
  return normalized;
}

/**
 * The only bridge from the Command Center to the accepted Career engine. The command is
 * allow-listed, arguments are fixed and explicit, and no shell is used.
 */
async function runCareer(repositoryRoot, input) {
  if (!CAREER_COMMANDS.has(input.command)) throw new Error("Unsupported Career command.");
  const args = [join(repositoryRoot, "apps", "career-cli.mjs"), input.command];
  if (input.command !== "demo") args.push("--root", absolute(input.root, "Career root"));
  const valueFlag = { ingest: "--input", "job:import": "--input", match: "--job", draft: "--match", export: "--output" }[input.command];
  if (valueFlag) { if (typeof input.value !== "string" || !input.value.trim() || input.value.length > 4096) throw new Error("Career command requires an explicit value."); args.push(valueFlag, input.value); }
  // Deliberately `sourceType`, not `type`: the transport envelope already owns `type`, and a
  // Career field of the same name would overwrite the action being dispatched.
  if (input.sourceType && input.command === "ingest") { if (!/^[a-z][a-z0-9-]{0,63}$/u.test(input.sourceType)) throw new Error("Career source type is invalid."); args.push("--type", input.sourceType); }
  if (input.dryRun && input.command !== "demo") args.push("--dry-run");
  try {
    const result = await runFile(process.execPath, args, { cwd: repositoryRoot, timeout: 300_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, shell: false });
    return { command: input.command, exitCode: 0, output: privacySafe(result.stdout).trim().slice(-20_000) };
  } catch (error) {
    const detail = privacySafe(`${error?.stdout ?? ""}\n${error?.stderr ?? error?.message ?? ""}`).trim().slice(-20_000);
    const failure = new Error(detail || "Career command failed."); failure.careerCommand = input.command; throw failure;
  }
}

function json(response, status, body) {
  const data = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(data), "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; frame-ancestors 'none'" });
  response.end(data);
}
async function body(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > MAX_BODY) throw new Error("Request body exceeds the 8 MiB limit."); chunks.push(chunk); }
  if (!chunks.length) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Request body must be a JSON object.");
  return parsed;
}
/**
 * True only for a socket whose peer is this machine. Never inferred from a header, because a
 * header is attacker-controlled and would let any request claim to be the console.
 *
 * `treatPeerAsRemote` is a composition-root switch used by the test suite and the demo to exercise
 * the phone path from a loopback socket. It is not a runtime setting and cannot be reached from
 * the API, so no request can turn itself into a console session or the reverse.
 */
function isLoopbackPeer(request, treatPeerAsRemote) {
  if (treatPeerAsRemote) return false;
  const remote = request.socket?.remoteAddress ?? "";
  return remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
}

/**
 * Same-origin enforcement. Allowed hosts: loopback plus every private address AION is actually
 * listening on (LAN and/or Tailscale overlay). Wildcards are never allowed.
 */
function sameOrigin(request, address, extraHosts) {
  const host = request.headers.host; const origin = request.headers.origin;
  const hosts = new Set([`127.0.0.1:${address.port}`, `localhost:${address.port}`, `[::1]:${address.port}`]);
  const list = Array.isArray(extraHosts) ? extraHosts : (extraHosts ? [extraHosts] : []);
  for (const extraHost of list) {
    if (!extraHost || extraHost === "auto") continue;
    hosts.add(`${extraHost}:${address.port}`);
    hosts.add(`[${extraHost}]:${address.port}`);
  }
  if (!host || !hosts.has(host.toLowerCase())) return false;
  if (!origin) return true;
  return [...hosts].some((candidate) => origin.toLowerCase() === `http://${candidate}`);
}

/** Bearer material is read from a header only. A token in a URL would leak into logs and history. */
function bearerToken(request) {
  const header = request.headers.authorization;
  if (typeof header !== "string") return "";
  const match = /^Bearer\s+(\S+)$/u.exec(header.trim());
  return match ? match[1] : "";
}

/** The providers AION ships with. None of them requires a credential or a network. */
function defaultProviders() {
  return [
    new DeterministicModelProviderV1(),
    new BoundaryModelProviderV1("remote-generic", "remote", "Configure an approved remote adapter and a session credential before this boundary can be used. AION ships no remote client."),
    new BoundaryModelProviderV1("local-model", "local", "No supported local model runtime is configured on this computer."),
  ];
}
export async function createAionServer(options = {}) {
  const repositoryRoot = resolve(options.repositoryRoot ?? resolve(import.meta.dirname, "..", ".."));
  const dataRoot = resolve(options.dataRoot ?? join(repositoryRoot, "private", "aion"));
  const exportRoot = resolve(options.exportRoot ?? join(dataRoot, "exports"));
  const developerAgents = options.developerAgents
    ?? (options.developerBridge ? new SelectableDeveloperAgentRegistryV1([options.developerBridge]) : await resolveDeveloperAgentBridges(repositoryRoot));
  const verificationRunner = options.verificationRunner ?? new AllowlistedVerificationRunnerV1(repositoryRoot, digestValue);
  /*
   * The floor is evaluated in-process; everything with an address goes over HTTP.
   *
   * The offline provider deliberately has no URL, so giving it one purely to satisfy an
   * address-based evaluator would mean benchmarking the invention rather than the provider.
   * The composite picks whichever adapter can actually serve each endpoint, and refuses by
   * name when none can.
   */
  const providers = options.providers ?? defaultProviders();
  const offlineProvider = providers.find((entry) => entry.id === "deterministic") ?? providers[0];
  /*
   * An owner-controlled search instance, if one is configured. SearXNG is the reference because
   * the owner can run it themselves; no commercial search API is required or assumed.
   */
  const searchProvider = options.searchProvider ?? (process.env[SEARCH_VARIABLE]?.trim()
    ? new SearxngSearchProviderV1(process.env[SEARCH_VARIABLE].trim())
    : null);
  const brainRuntime = options.brainRuntime
    ?? new CompositeBrainRuntimeV1(new InProcessBrainRuntimeV1(offlineProvider), new HttpBrainRuntimeV1());
  const codeSandbox = options.codeSandbox ?? createDockerCodeSandboxV1();
  /*
   * Writer authority V2 (R6.1-R1):
   * - External trusted Owner key material (never self-declared solely by the mutable anchor)
   * - Portable authority anchor (current + ledger) when configured
   * - Local SystemInstanceIdV1 when explicitly supplied
   * - Live re-evaluation on every durable save (no cached WRITER)
   * - Absence of trust / anchor / identity / valid grant => READ_ONLY (fail closed)
   * - No production bootstrap, no randomUUID identity fallback, no runtime signing
   * - Does not read real private identity files unless the caller injects an SI id
   *
   * R6.6 production load: when dataRoot/authority-v2/{trust.json,system-instance-id.txt,anchor/}
   * exist (placed by offline Owner cutover tools), wire them as the external trust boundary.
   * Runtime still only verifies — it never generates keys or appends the ledger.
   */
  const loadAuthorityV2FromDataRoot = () => {
    const authRoot = join(dataRoot, "authority-v2");
    const trustPath = join(authRoot, "trust.json");
    const siPath = join(authRoot, "system-instance-id.txt");
    const anchorRoot = join(authRoot, "anchor");
    try {
      if (!existsSync(trustPath) || !existsSync(siPath) || !existsSync(join(anchorRoot, "current.json"))) {
        return null;
      }
      const trustRaw = JSON.parse(readFileSync(trustPath, "utf8"));
      const ownerKeyId = String(trustRaw.ownerKeyId || "").trim();
      const spkiB64 = String(trustRaw.publicKeySpkiDerBase64 || "").trim();
      const systemInstanceId = readFileSync(siPath, "utf8").trim();
      if (!ownerKeyId || !spkiB64 || !systemInstanceId) return null;
      const publicKeySpkiDer = new Uint8Array(Buffer.from(spkiB64, "base64"));
      return {
        trustedOwnerVerification: { ownerKeyId, publicKeySpkiDer },
        authorityAnchorRoot: resolve(anchorRoot),
        localSystemInstanceId: systemInstanceId,
      };
    } catch {
      return null;
    }
  };
  const fileAuthority = options.authority ? null : loadAuthorityV2FromDataRoot();
  const authority = options.authority ?? new OwnerAuthorityRuntimeV2({
    getTrustedOwner: () =>
      options.trustedOwnerVerification
      ?? fileAuthority?.trustedOwnerVerification
      ?? null,
    getAnchorRoot: () => {
      const root = options.authorityAnchorRoot ?? fileAuthority?.authorityAnchorRoot;
      if (typeof root !== "string" || !root.trim()) return null;
      return resolve(root);
    },
    getLocalSystemInstanceId: () => {
      const id = options.localSystemInstanceId ?? fileAuthority?.localSystemInstanceId;
      return typeof id === "string" && id.trim() ? id.trim() : null;
    },
  });
  // Always wrap the durable repository — injected repositories cannot bypass the authority gate.
  const rawRepository = options.repository ?? new FileStateRepositoryV1(dataRoot);
  const repository = new AuthorityGatedStateRepositoryV1(rawRepository, authority);
  const service = new AionAssistantV1({
    repository, clock: options.clock ?? new SystemClockV1(), ids: options.ids ?? new RandomIdGeneratorV1(),
    providers,
    capabilities: options.capabilities ?? new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1(), new DeveloperAgentCapabilityV1(developerAgents, repositoryRoot), new VerificationCapabilityV1(verificationRunner)]),
    importer: options.importer ?? new LocalArchiveImportSourceV1(),
    backup: options.backup ?? new NodePrivateBackupV1(exportRoot), developerAgents,
    authority,
    codeSandbox,
    /*
     * V1.3 activates real public-URL research, and the guards around it are unchanged.
     *
     * Having a provider does not mean AION browses. A job still needs to be proposed with an
     * explicit non-local scope, approved by the owner, and bounded by its own limits; the
     * default scope is local-only, so the ordinary path still makes no request. What changed is
     * that an approved public-web job can now actually read the pages the owner named.
     */
    research: options.research ?? new PublicUrlResearchProviderV1(),
    // No build pipeline by default either. A pipeline that ran a project's own build commands
    // would be the shell exposure the rest of the design exists to avoid, so it stays an explicit
    // future capability rather than something that arrives switched on.
    pipeline: options.pipeline,
    /*
     * GPU infrastructure is wired only when the owner has deliberately set the named credential
     * variable. AION does not search for a key and does not accept one pasted into Chat; the
     * variable's presence is the whole of the detection. Provisioning stays off regardless:
     * discovery and pricing are authorised, renting is not.
     */
    gpu: options.gpu ?? (process.env[DEFAULT_VAST_CREDENTIAL_VARIABLE]?.trim()
      ? new VastAiInfrastructureV1({ allowProvisioning: false })
      : new UnavailableGpuInfrastructureV1(`No GPU infrastructure provider is configured. Set ${DEFAULT_VAST_CREDENTIAL_VARIABLE} in the shell that starts AION to enable Vast.ai discovery. AION stores only the variable name, never the value, and will still not rent anything without an approved bounded proposal.`)),
    /*
     * The same adapter that runs evaluations verifies a rented endpoint before AION will route to
     * it. Giving the service the runtime port rather than doing the check up here is deliberate:
     * "this machine answered a real completion" is the fact the whole bridge turns on, and it must
     * be established by the code that decides, not by the transport that happens to be in front.
     */
    brainRuntime,
  });

  async function dispatch(input) {
    switch (input.type) {
      case "onboarding.complete": return service.completeOnboarding();
      case "settings.update": return service.updateSettings(input.settings ?? {});
      case "conversation.create": return service.createConversation(input.title);
      case "conversation.update": return service.updateConversation(input.id, input.change ?? {});
      case "conversation.delete": return service.deleteConversation(input.id);
      case "chat.send": return service.sendMessage(input.id, input.content);
      case "chat.cancel": return service.cancelChat(input.id);
      case "memory.create": return service.createMemory(input.memory ?? {});
      case "memory.search": return service.searchMemories(input.query);
      case "memory.correct": return service.correctMemory(input.id, input.content, input.reason);
      case "memory.accept": return service.acceptMemory(input.id);
      case "memory.enable": return service.setMemoryEnabled(input.id, input.enabled === true);
      case "memory.delete": return service.forgetMemory(input.id);
      case "memory.export": return { export: await service.exportMemories() };
      case "state.export": return { export: await service.exportState() };
      case "task.create": return service.createTask(input.task ?? {});
      case "task.update": return service.updateTask(input.id, input.change ?? {});
      case "task.transition": return service.transitionTask(input.id, input.state, input.reason);
      case "routine.create": return service.createRoutine(input.routine ?? {});
      case "routine.update": return service.updateRoutine(input.id, input.change ?? {});
      case "routine.run": return service.runRoutine(input.id);
      case "scheduler.tick": return { due: await service.tick() };
      case "plan.create": return service.createPlan(input.goal, input.steps ?? []);
      case "plan.accept": return service.acceptPlan(input.id);
      case "plan.convert": return service.convertPlanToTasks(input.id);
      case "action.propose": return service.proposeAction(input.capabilityId, input.input ?? {});
      case "developer.health": return { bridges: await service.developerBridgeInventory(true) };
      // Pairing is issued from the console only; a phone can redeem a code but never mint one.
      case "device.pair.code": return service.createPairingCode(input.label ?? "");
      case "device.revoke": return service.revokeDevice(input.id);
      case "device.revoke.all": return service.revokeAllDevices();
      case "device.list": return { devices: await service.deviceInventory() };
      // There is no endpoint that submits verification evidence: executing the approved capability
      // is the only way a record can appear, so an analysis always cites a command AION really ran.
      case "verify.analyse": return service.proposeVerificationAnalysis(input.id, input.question);
      // Workspaces. A new workspace starts empty; nothing is ever copied into it.
      case "workspace.create": return service.createWorkspace(input.workspace ?? {});
      case "workspace.update": return service.updateWorkspace(input.id, input.change ?? {});
      case "workspace.archive": return service.setWorkspaceArchived(input.id, input.archived === true);
      case "workspace.product": return service.addBrandProduct(input.id, input.product ?? {});
      // The general Relationship Core. Scoped to the active workspace, whichever one that is.
      case "relationship.create": return service.createRelationship(input.relationship ?? {});
      case "relationship.update": return service.updateCustomer(input.id, input.change ?? input.relationship ?? {});
      case "relationship.find": return { relationships: await service.findRelationships(input.query ?? { kind: "all" }) };
      // Product Studio. Nothing here invents market evidence, and every claim carries its class.
      case "opportunity.create": return service.createOpportunity(input.opportunity ?? {});
      case "opportunity.update": return service.updateOpportunity(input.id, input.change ?? {});
      case "opportunity.claim": return service.addOpportunityClaim(input.id, input.claim ?? {});
      case "opportunity.claim.promote": return service.promoteOpportunityClaim(input.id, input.claimId, input.to, input.reason);
      case "opportunity.claim.supersede": return service.supersedeOpportunityClaim(input.id, input.claimId, input.replacementId ?? null);
      case "opportunity.competitor": return service.addCompetitorNote(input.id, input.competitor ?? {});
      case "opportunity.experiment": return service.addExperiment(input.id, input.experiment ?? {});
      case "opportunity.experiment.result": return service.completeExperiment(input.id, input.experimentId, input.status, input.result ?? "");
      case "opportunity.specify": return service.setOpportunitySpecification(input.id, input.specification ?? {});
      // Typed linkage. Deliberately four verbs rather than a writable field: each one resolves
      // the reference and checks the workspace before anything is stored.
      case "opportunity.task.link": return service.linkOpportunityTask(input.id, input.taskId);
      case "opportunity.task.unlink": return service.unlinkOpportunityTask(input.id, input.taskId);
      case "opportunity.plan.link": return service.linkOpportunityPlan(input.id, input.planId);
      case "opportunity.plan.unlink": return service.unlinkOpportunityPlan(input.id, input.planId);
      case "opportunity.assess": return service.assessOpportunity(input.id);
      case "opportunity.list": return { opportunities: await service.opportunities() };
      // Learning. A lesson carries its class, so a suggestion is never quoted as settled practice.
      case "lesson.record": return service.recordLesson(input.lesson ?? {});
      case "lesson.promote": return service.promoteLesson(input.id, input.to, input.reason);
      case "lesson.outcome": return service.recordLessonOutcome(input.id, input.outcome ?? {});
      case "lesson.enable": return service.setLessonEnabled(input.id, input.enabled === true);
      case "lesson.list": return { lessons: await service.lessons(input.scope ?? {}), summary: await service.learningSummary() };
      case "lesson.boundary": return service.adaptationBoundary();
      // Development projects. Stages are not skipped and no agent authorises itself.
      case "project.create": return service.createProject(input.project ?? {});
      case "project.specify": return service.setProjectSpecification(input.id, input.specification ?? {});
      case "project.plan": return service.setProjectPlan(input.id, input.steps ?? []);
      case "project.proposal": return service.recordAgentProposal(input.id, input.proposal ?? {});
      case "project.verification": return service.attachProjectVerification(input.id, input.verificationId);
      case "project.step": return service.runProjectStep(input.id, input.step);
      case "project.approve": return service.approveProjectStage(input.id, input.stage, input.note ?? "");
      case "project.advance": return service.advanceProject(input.id, input.stage, input.reason);
      case "project.deployment": return service.prepareDeployment(input.id, input.deployment ?? {});
      case "project.list": return { projects: await service.projects() };
      // The command router. Resolving proposes; it never executes and never creates anything.
      case "command.route": return service.route(input.text);
      // Rented GPU capacity. Discovery and pricing only; renting needs an approved proposal.
      case "gpu.credential": return service.gpuCredentialStatus();
      case "gpu.discover": return service.discoverGpuOffers(input.filter ?? {});
      case "gpu.propose": return service.proposeGpuProvisioning(input.proposal ?? {});
      case "gpu.decide": return service.decideGpuProposal(input.id, input.approve === true);
      case "gpu.start": return service.startGpuSession(input.id);
      case "gpu.stop": return service.stopGpuSession(input.id, input.reason ?? "owner stop");
      case "gpu.enforce": return { stopped: await service.enforceGpuLimits() };
      /*
       * The readiness bridge. `gpu.poll` is one bounded check, safe to call from a browser on a
       * timer; `gpu.activate` runs the loop server-side for a caller that wants to wait. Both stop
       * the machine rather than extending anything if a limit is reached, and neither can create a
       * second paid resource. `gpu.reconcile` is the same reconciliation that runs at startup.
       */
      case "gpu.poll": return service.pollGpuReadiness(input.id);
      case "gpu.activate": return service.activateGpuSession(input.id, input.options ?? {});
      case "gpu.activation": return service.gpuActivation(input.id);
      case "gpu.reconcile": return { reconciled: await service.reconcileGpuSessions() };
      case "gpu.sessions": return { sessions: await service.gpuSessions(), proposals: await service.gpuProposals() };
      case "gpu.models": return service.modelProfiles();
      case "gpu.cost": return service.costIntelligence();
      case "research.analyse": return service.analyseResearchJob(input.id);
      case "research.learn": return service.adoptResearchLearning(input.id, Number(input.index ?? 0));
      // The brain. Endpoints are owner-configured; AION never adds one it merely detected.
      case "brain.endpoint.add": return service.addBrainEndpoint(input.endpoint ?? {});
      case "brain.endpoint.remove": return service.removeBrainEndpoint(input.id);
      case "brain.settings": return service.updateBrainSettings(input.change ?? {});
      case "brain.route": return service.routeBrain(input.request ?? { workspace: "", needs: ["conversation"], includesMemory: false, includesWorkOrCustomerInformation: false, contextClasses: [] });
      case "brain.independence": return service.independence();
      case "brain.boundary": return service.brainBoundary();
      case "brain.health": {
        const settings = await service.brainSettings();
        const endpoint = settings.endpoints.find((entry) => entry.id === input.id);
        if (!endpoint) throw new Error("Endpoint is not registered.");
        return service.recordEndpointHealth(endpoint.id, await brainRuntime.probe(endpoint, AbortSignal.timeout(15_000)));
      }
      case "brain.detect": return { runtimes: await brainRuntime.detect(AbortSignal.timeout(20_000)) };
      // One harness for every endpoint, including a machine rented by the minute. A rented
      // endpoint is an ordinary registered endpoint by the time it reaches here, which is why it
      // needs no branch: if it needed one, "measured against the same suite" would not be true.
      case "brain.evaluate": return service.evaluateEndpoint(input.id, AbortSignal.timeout(20 * 60_000));
      case "brain.comparison": return { comparison: await service.modelComparison(), runs: await service.evaluations() };
      case "chat.disclosure": return service.chatDisclosure(input.id);
      // Governed research. Proposing runs nothing; a job runs only after the owner approves it.
      case "research.propose": return service.proposeResearchJob(input.job ?? {});
      case "research.approve": return service.approveResearchJob(input.id);
      case "research.run": return service.runResearchJob(input.id);
      case "research.cancel": return { cancelled: service.cancelResearchJob(input.id) };
      case "research.adopt": return service.adoptResearchFinding(input.id, input.findingId, input.opportunityId);
      case "research.list": return { jobs: await service.researchJobs() };
      case "research.check-url": return service.checkResearchUrl(String(input.url ?? ""));
      case "research.search": {
        // Search is entirely optional. Without a configured instance, public-URL research still
        // works, which is the whole point of keeping the search tier replaceable.
        if (!searchProvider) throw new Error(`No search provider is configured. Set ${SEARCH_VARIABLE} to a SearXNG-compatible base URL to enable discovery, or supply the URLs yourself — research works either way.`);
        return { results: await searchProvider.search(String(input.question ?? ""), Number(input.limit ?? 8), AbortSignal.timeout(30_000)) };
      }
      // Sales-facing relationship operations. Every one of these refuses outside the Work workspace.
      case "customer.create": return service.createCustomer(input.customer ?? {});
      case "customer.update": return service.updateCustomer(input.id, input.change ?? {});
      case "customer.interaction": return service.recordCustomerInteraction(input.id, input.interaction ?? {});
      case "customer.lifecycle": return service.setCustomerLifecycle(input.id, input.lifecycle, input.summary);
      case "customer.appointment": return service.addCustomerAppointment(input.id, input.appointment ?? {});
      case "customer.appointment.status": return service.setCustomerAppointmentStatus(input.id, input.appointmentId, input.status);
      case "customer.followup": return service.addCustomerFollowUp(input.id, input.followUp ?? {});
      case "customer.followup.complete": return service.completeCustomerFollowUp(input.id, input.followUpId, input.outcome, input.status === "skipped" ? "skipped" : "done");
      case "customer.outcome": return service.setCustomerOutcome(input.id, input.outcome, input.detail);
      case "customer.archive": return service.setCustomerArchived(input.id, input.archived === true);
      case "customer.link.task": return service.linkCustomerTask(input.id, input.taskId);
      case "customer.find": return { customers: await service.findCustomers(input.query ?? { kind: "all" }) };
      case "customer.timeline": return service.customerTimeline(input.id);
      case "customer.summary": return service.accountSummary(input.id);
      case "assistant.prompt": {
        const text = String(input.text ?? input.content ?? "");
        const result = await service.assistantPrompt(text);
        if (result.action === "chat.fallback") {
          // Create/use a short-lived conversation for general chat when CRM intent is unclear.
          let conversationId = input.conversationId;
          if (!conversationId) {
            const conv = await service.createConversation(text.slice(0, 80) || "Assistant");
            conversationId = conv.id;
          }
          const turn = await service.sendMessage(conversationId, text);
          return {
            ...result,
            conversationId,
            reply: turn.message?.content ?? JSON.stringify(turn).slice(0, 2000),
            data: turn,
          };
        }
        return result;
      }
      case "crm.document.attach": return service.attachCrmDocument(input.document ?? input);
      case "crm.document.upload": {
        // Real byte intake: base64 content written under private/aion/intake (never Git).
        const filename = basename(String(input.filename ?? "upload.bin")).replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 180) || "upload.bin";
        const mimeType = String(input.mimeType ?? "application/octet-stream").slice(0, 120);
        const b64 = String(input.contentBase64 ?? "");
        if (!b64) throw new Error("contentBase64 is required for document upload.");
        let bytes;
        try { bytes = Buffer.from(b64, "base64"); } catch { throw new Error("contentBase64 is invalid."); }
        if (!bytes.length) throw new Error("Upload is empty.");
        if (bytes.length > MAX_UPLOAD_BYTES) throw new Error(`Upload exceeds ${MAX_UPLOAD_BYTES} bytes.`);
        const intakeRoot = join(dataRoot, "intake");
        const id = randomBytes(8).toString("hex");
        const destDir = join(intakeRoot, id);
        mkdirSync(destDir, { recursive: true });
        const storedPath = join(destDir, filename);
        writeFileSync(storedPath, bytes, { flag: "wx" });
        let extractedText = "";
        const lower = filename.toLowerCase();
        if (mimeType.startsWith("text/") || /\.(txt|csv|json|md|log)$/i.test(lower)) {
          extractedText = bytes.toString("utf8").slice(0, 100_000);
        } else if (/\.pdf$/i.test(lower) || mimeType === "application/pdf") {
          // Best-effort: pull printable Latin text streams from PDF bytes (no paid OCR).
          const raw = bytes.toString("latin1");
          const chunks = [];
          const re = /\((?:\\.|[^\\)]){2,400}\)/g;
          let m;
          while ((m = re.exec(raw)) && chunks.length < 400) {
            const inner = m[0].slice(1, -1).replace(/\\n/g, "\n").replace(/\\(.)/g, "$1");
            if (/[A-Za-z]{3,}/.test(inner)) chunks.push(inner);
          }
          // Also harvest BT/ET text blocks roughly
          const bt = raw.match(/BT[\s\S]{0,2000}?ET/g) || [];
          for (const block of bt.slice(0, 40)) {
            const parts = block.match(/\((?:\\.|[^\\)])+\)/g) || [];
            for (const p of parts) {
              const t = p.slice(1, -1).replace(/\\n/g, "\n").replace(/\\(.)/g, "$1");
              if (/[A-Za-z]{2,}/.test(t)) chunks.push(t);
            }
          }
          extractedText = chunks.join(" ").replace(/\s+/g, " ").trim().slice(0, 100_000);
        } else if (/\.docx$/i.test(lower) || mimeType.includes("wordprocessingml")) {
          // DOCX is a ZIP: extract word/document.xml text nodes without full unzip deps.
          try {
            const asLatin = bytes.toString("latin1");
            if (asLatin.startsWith("PK")) {
              const xmlStart = asLatin.indexOf("word/document.xml");
              // Prefer shared strings of <w:t> if present anywhere in package bytes
              const texts = [];
              const tre = /<w:t[^>]*>([^<]{1,500})<\/w:t>/g;
              let tm;
              while ((tm = tre.exec(asLatin)) && texts.length < 2000) texts.push(tm[1]);
              extractedText = texts.join(" ").replace(/\s+/g, " ").trim().slice(0, 100_000);
              if (!extractedText && xmlStart >= 0) {
                extractedText = `[docx stored; structured XML extract partial — file ${filename}]`;
              }
            }
          } catch {
            extractedText = "";
          }
        }
        const kind = mimeType.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(lower)
          ? "image"
          : /\.(csv|xlsx?)$/i.test(lower)
            ? "spreadsheet"
            : "document";
        if (kind === "image" && !extractedText) {
          // Prefer local Ollama vision when configured; never invent OCR on failure.
          const vision = await extractImageWithLocalVision({
            filename,
            mimeType,
            byteLength: bytes.length,
            bytes,
          });
          extractedText = vision.extractedText || vision.description;
          if (!input.summary) input.summary = vision.description.slice(0, 400);
          if (vision.code === "READY" && vision.extractedText) {
            // tag so Owner can see vision path was used
            if (!Array.isArray(input.tags)) input.tags = [];
            if (Array.isArray(input.tags) && !input.tags.includes("vision-local")) {
              input.tags = [...input.tags, "vision-local"];
            }
          }
        }
        const summary = String(input.summary ?? (extractedText ? extractedText.slice(0, 400) : `Uploaded ${filename}`)).slice(0, 4000);
        const contentHash = typeof input.contentHash === "string" && input.contentHash
          ? String(input.contentHash).slice(0, 128)
          : hashBytes(bytes);
        return service.attachCrmDocument({
          relationshipId: input.relationshipId ?? null,
          filename,
          storedPath,
          mimeType,
          byteLength: bytes.length,
          kind,
          summary,
          extractedText: String(input.extractedText ?? extractedText).slice(0, 100_000),
          tags: input.tags,
          contentHash,
          sourceRelativePath: input.sourceRelativePath,
          sourceModifiedAt: input.sourceModifiedAt,
          sourceRootPath: input.sourceRootPath,
          entityKind: input.entityKind,
          entityConfidence: input.entityConfidence,
        });
      }
      case "crm.document.list": return { documents: await service.listCrmDocuments(input.relationshipId) };
      case "crm.document.importFolder": {
        // Owner-selected folder only (not whole-drive scan). Bounded recursive hierarchy.
        const rawPath = String(input.path ?? "").trim();
        if (!rawPath) throw new Error("Import folder path is required.");
        const folder = resolve(rawPath);
        if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new Error("Import folder does not exist or is not a directory.");
        const settings = (await service.snapshot()).settings;
        const roots = Array.isArray(settings.importRoots) ? settings.importRoots : [];
        let approvedRoot = null;
        for (const root of roots) {
          try {
            const r = resolve(root);
            const rel = relative(r, folder);
            if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
              approvedRoot = r;
              break;
            }
          } catch { /* next */ }
        }
        if (!approvedRoot) {
          try {
            const rel = relative(dataRoot, folder);
            if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) approvedRoot = dataRoot;
          } catch { /* no */ }
        }
        if (!approvedRoot) {
          throw new Error("Folder must be under an approved import root (Settings) or private AION data root. AION will not scan arbitrary drives.");
        }
        const knownHashes = await service.knownDocumentHashes();
        const knownProv = await service.knownDocumentProvenance(folder);
        const limits = {
          maxDepth: Number(input.maxDepth ?? 12) || 12,
          maxFiles: Number(input.maxFiles ?? 500) || 500,
          maxFileBytes: Number(input.maxFileBytes ?? MAX_UPLOAD_BYTES) || MAX_UPLOAD_BYTES,
          maxTotalBytes: Number(input.maxTotalBytes ?? (200 * 1024 * 1024)) || (200 * 1024 * 1024),
        };
        const walk = walkAuthorizedFolder({
          folder,
          approvedRoot,
          limits,
          knownHashes,
          knownProvenance: knownProv,
        });
        const imported = [];
        const skipped = walk.skipped.map((s) => ({
          filename: s.relativePath || s.absolutePath,
          reason: s.reason,
          detail: s.detail,
        }));
        const errors = [...walk.errors];
        let duplicatesSkipped = walk.skipped.filter((s) => s.reason === "duplicate-in-batch").length;
        let unsupportedSkipped = walk.skipped.filter((s) => s.reason === "unsupported-type").length;
        let factsExtracted = 0;
        let entitiesAssociated = 0;
        let reviewItems = 0;
        const errorLog = [];

        for (const file of walk.files) {
          try {
            const bytes = readFileSync(file.absolutePath);
            if (hashBytes(bytes) !== file.contentHash) {
              // TOCTOU: re-hash after read
              file.contentHash = hashBytes(bytes);
            }
            if (knownHashes.has(file.contentHash)) {
              duplicatesSkipped++;
              skipped.push({ filename: file.relativePath, reason: "duplicate-in-batch", detail: "content-hash-already-ingested" });
              continue;
            }
            const contentBase64 = bytes.toString("base64");
            const mimeType = mimeForBulkExtension(file.extension || file.relativePath);
            const tags = [...(Array.isArray(input.tags) ? input.tags : []), "folder-import", "recursive-bulk"];
            const sourceModifiedAt = new Date(file.modifiedAtMs).toISOString();
            const doc = await dispatch({
              type: "crm.document.upload",
              filename: basename(file.relativePath),
              mimeType,
              contentBase64,
              relationshipId: input.relationshipId ?? null,
              tags,
              summary: input.summary ?? `Imported from ${file.relativePathPosix || file.relativePath}`,
              contentHash: file.contentHash,
              sourceRelativePath: file.relativePathPosix || file.relativePath,
              sourceModifiedAt,
              sourceRootPath: folder,
            });
            // If dedupe returned an existing doc, count as duplicate not new import
            if (doc.contentHash === file.contentHash && knownHashes.has(file.contentHash)) {
              duplicatesSkipped++;
              skipped.push({ filename: file.relativePath, reason: "duplicate-in-batch", detail: "dedupe-on-attach" });
              continue;
            }
            knownHashes.add(file.contentHash);
            const classified = await service.classifyAndAssociateImport({
              documentId: doc.id,
              filename: doc.filename,
              relativePath: file.relativePathPosix || file.relativePath,
              extractedText: doc.extractedText,
              tags: doc.tags,
              sourcePath: file.absolutePath,
            });
            if (classified.factId) {
              factsExtracted++;
              entitiesAssociated++;
            }
            if (classified.reviewItem) reviewItems++;
            imported.push({
              id: doc.id,
              filename: doc.filename,
              byteLength: doc.byteLength,
              contentHash: doc.contentHash,
              sourceRelativePath: doc.sourceRelativePath,
              entityKind: doc.entityKind || classified.auto?.kind || null,
              review: Boolean(classified.reviewItem),
            });
          } catch (error) {
            const message = String(error?.message || error).slice(0, 500);
            errors.push({ path: file.relativePath, message });
            errorLog.push(`${file.relativePath}: ${message}`);
            skipped.push({ filename: file.relativePath, reason: "unreadable", detail: message });
            // Continue — never abort entire import for one file
          }
        }

        return {
          imported,
          skipped,
          errors,
          folder,
          approvedRoot,
          recursive: true,
          truncated: walk.truncated,
          stats: {
            filesDiscovered: walk.files.length + walk.skipped.length,
            filesProcessed: imported.length,
            duplicatesSkipped,
            unsupportedSkipped,
            factsExtracted,
            entitiesAssociated,
            reviewItems,
            errors: errors.length,
          },
          errorLog,
        };
      }
      case "crm.email.draft": return service.createEmailDraft(input.draft ?? input);
      case "crm.email.list": return { drafts: await service.listEmailDrafts(input.relationshipId) };
      case "owner.knowledge.get": return service.getOwnerKnowledge();
      case "owner.profile.update": return service.updateOwnerProfile(input.profile ?? input.change ?? input);
      case "owner.knowledge.add": return service.addOwnerKnowledgeFact(input.fact ?? input);
      case "owner.knowledge.correct": return service.correctOwnerKnowledgeFact(input.id, String(input.content ?? ""), String(input.reason ?? ""));
      case "owner.knowledge.enable": return service.setOwnerKnowledgeEnabled(input.id, input.enabled === true);
      case "brand.collaborator.list": return { collaborators: await service.listBrandCollaborators() };
      case "brand.collaborator.add": return service.addBrandCollaborator(input.collaborator ?? input);
      case "job.list": return { applications: await service.listJobApplications() };
      case "job.track": return service.addJobApplication(input.application ?? input);
      case "job.prepare": return service.prepareJobApplication(input.id);
      case "import.queue.list": return { sources: await service.listImportSourceQueue() };
      case "import.queue.add": return service.queueImportSource(input.source ?? input);
      case "import.queue.process": {
        // Process one Owner-queued source (folder/file/csv). Never invents new roots.
        const id = String(input.id ?? "");
        const sources = await service.listImportSourceQueue();
        const src = sources.find((s) => s.id === id) || sources.find((s) => s.status === "queued");
        if (!src) throw new Error("No queued import source to process.");
        await service.markImportSourceProcessing(src.id);
        try {
          if (src.kind === "folder" || src.kind === "document-batch") {
            const result = await dispatch({
              type: "crm.document.importFolder",
              path: src.path,
              relationshipId: src.associateWith === "customer" ? src.associateId : null,
              tags: ["queue-import", src.kind],
              summary: `Queue import: ${src.label}`,
            });
            const stats = result.stats ?? {};
            const status = (stats.reviewItems > 0 && (result.imported?.length ?? 0) > 0)
              ? "needs-review"
              : "completed";
            return service.finalizeImportSource(src.id, {
              status,
              itemsImported: result.imported?.length ?? 0,
              itemsSkipped: result.skipped?.length ?? 0,
              stats,
              errorLog: result.errorLog ?? [],
              lastError: (result.errors?.length ? `${result.errors.length} file error(s); continued` : "") || undefined,
            });
          }
          if (src.kind === "csv" || (src.kind === "file" && /\.csv$/i.test(src.path))) {
            if (!existsSync(src.path)) throw new Error("CSV path does not exist.");
            const text = readFileSync(src.path, "utf8");
            const result = await service.importContactsFromCsv(text, { sourceLabel: src.label });
            return service.finalizeImportSource(src.id, {
              status: "completed",
              itemsImported: result.created,
              itemsSkipped: result.skipped,
              stats: {
                filesDiscovered: result.created + result.skipped,
                filesProcessed: result.created,
                duplicatesSkipped: 0,
                unsupportedSkipped: 0,
                factsExtracted: 0,
                entitiesAssociated: result.created,
                reviewItems: 0,
                errors: result.errors?.length ?? 0,
              },
              errorLog: result.errors ?? [],
            });
          }
          if (src.kind === "file" || src.kind === "json") {
            if (!existsSync(src.path) || !statSync(src.path).isFile()) throw new Error("Import file does not exist.");
            const bytes = readFileSync(src.path);
            if (bytes.length > MAX_UPLOAD_BYTES) throw new Error("File too large.");
            const filename = basename(src.path);
            const doc = await dispatch({
              type: "crm.document.upload",
              filename,
              mimeType: /\.json$/i.test(filename) ? "application/json" : "application/octet-stream",
              contentBase64: bytes.toString("base64"),
              tags: ["queue-import"],
              summary: `Queue import file: ${src.label}`,
              contentHash: hashBytes(bytes),
              sourceRelativePath: filename,
              sourceRootPath: resolve(src.path, ".."),
            });
            const classified = await service.classifyAndAssociateImport({
              documentId: doc.id,
              filename: doc.filename,
              relativePath: filename,
              extractedText: doc.extractedText,
              tags: doc.tags,
              sourcePath: src.path,
            });
            return service.finalizeImportSource(src.id, {
              status: classified.reviewItem ? "needs-review" : "completed",
              itemsImported: doc?.id ? 1 : 0,
              itemsSkipped: 0,
              stats: {
                filesDiscovered: 1,
                filesProcessed: 1,
                duplicatesSkipped: 0,
                unsupportedSkipped: 0,
                factsExtracted: classified.factId ? 1 : 0,
                entitiesAssociated: classified.factId ? 1 : 0,
                reviewItems: classified.reviewItem ? 1 : 0,
                errors: 0,
              },
            });
          }
          throw new Error(`Unsupported import kind: ${src.kind}`);
        } catch (error) {
          return service.finalizeImportSource(src.id, {
            status: "failed",
            lastError: String(error?.message || error).slice(0, 2000),
          });
        }
      }
      case "import.dashboard": return service.importDashboard();
      case "import.review.list": return { items: await service.listImportReviewQueue() };
      case "import.review.resolve": return service.resolveImportReviewItem(String(input.id ?? ""), input.decision === "accepted" ? "accepted" : "rejected");
      case "network.lan.discover": {
        const lan = discoverPrivateLanAddresses();
        const access = discoverAccessEndpoints();
        const port = boundPort || Number(process.env.AION_PORT || 31415);
        return {
          ...lan,
          access,
          phoneUrl: (access.preferredRemote || lan.preferred)
            ? buildPhoneUrl((access.preferredRemote || lan.preferred).address, port, "/phone")
            : null,
          remoteUrl: access.overlay ? buildAppUrl(access.overlay.address, port, "/") : null,
          localUrl: access.physical ? buildAppUrl(access.physical.address, port, "/") : null,
          port,
        };
      }
      case "mobile.status": {
        const settings = (await service.snapshot()).settings;
        const devices = await service.deviceInventory();
        const lastIntake = await service.lastPhoneIntakeAt();
        return remoteAccessStatus(settings, listeners, process.env, process.platform, {
          port: boundPort || Number(process.env.AION_PORT || 31415),
          devices,
          lastPhoneIntake: lastIntake,
        });
      }
      case "import.csv.contacts": return service.importContactsFromCsv(String(input.csvText ?? input.text ?? ""), { sourceLabel: input.sourceLabel });
      case "connector.gmail.status": return service.gmailConsentStatus();
      case "connector.metricool.status": return service.metricoolReadinessStatus();
      case "connector.settings.update": return service.updateConnectorSettings(input.connectors ?? input);
      case "import.readiness": return service.importReadiness();
      case "connector.image.status": return imageUnderstandingStatus();
      case "metricool.fixture.seed": return service.seedMetricoolFixtures(input);
      case "metricool.insight": return service.metricoolInsight(input.now);
      case "work.queue": return service.workQueue();
      case "work.briefing": return service.dailyBriefing();
      case "gmail.fixture.seed": return { count: service.seedGmailFixtures(input.messages ?? []) };
      case "gmail.fixture.search": return service.searchGmailFixtures(String(input.query ?? ""));
      case "gmail.fixture.associate": return service.associateGmailFixtureWithCrm(String(input.messageId ?? ""));
      case "coach": return service.coach(input.kind, input.input ?? {});
      case "sales.routine.create": return service.createRoutineFromTemplate(input.templateId);
      case "sales.metrics": return service.recordSalesMetrics(input.date, input.counts ?? {}, input.note ?? "");
      case "sales.summary": return service.salesSummary(input.from, input.to);
      case "action.execute": return service.executeAction(input.id);
      case "action.cancel": return service.cancelAction(input.id);
      case "approval.decide": return service.decideApproval(input.id, input.approve === true);
      case "import.dry-run": return service.dryRunImport(input.platform, absolute(input.root, "Import root"), absolute(input.path, "Import selection"));
      case "import.execute": return service.importConversations(input.id, absolute(input.root, "Import root"), absolute(input.path, "Import selection"));
      case "import.cancel": return service.cancelImport(input.id);
      case "backup.create": return service.createPrivateBackup(absolute(input.destination, "Backup destination"), String(input.passphrase ?? ""));
      case "backup.verify": return service.verifyPrivateBackup(absolute(input.destination, "Backup destination"), String(input.passphrase ?? ""));
      case "career.run": {
        try { const result = await runCareer(repositoryRoot, input); await service.recordCareerActivity(input.command, "success", "No Career content is stored in activity."); return result; }
        catch (error) { if (error?.careerCommand) await service.recordCareerActivity(error.careerCommand, "failed", "The command failed; no Career content is stored."); throw error; }
      }
      default: throw new Error("Unsupported Command Center action.");
    }
  }

  /*
   * One request handler, potentially several listeners.
   *
   * `boundPort` is captured once at listen time rather than read from a particular server,
   * because every listener shares the same port and a request may arrive on any of them.
   */
  let boundPort = 0;
  let listeners = [];

  const handler = async (request, response) => {
    try {
      const address = { port: boundPort };
      const settings = (await service.snapshot()).settings;
      const remote = settings.remoteAccess;
      const privateHosts = listeners
        .filter((entry) => entry.state === "listening" && entry.scope === "private")
        .map((entry) => entry.address);
      if (!boundPort || !sameOrigin(request, address, remote.enabled ? privateHosts : [])) {
        return json(response, 403, { error: "Request origin is not allowed." });
      }
      const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

      /*
       * Who is allowed to be served.
       *
       * A request from this machine is the owner at the console, exactly as in V1. Anything else
       * is a phone, and reaching AION over a private network proves nothing about who is holding
       * it -- so it must additionally present a session issued by a pairing the owner performed.
       * Everything fails closed: access off, no token, unknown token, expired or revoked session,
       * or a revoked device all land in the same place.
       */
      const loopback = isLoopbackPeer(request, options.treatPeerAsRemote === true);
      let device = null;
      if (!loopback) {
        if (!remote.enabled) return json(response, 403, { error: "Private phone access is turned off." });
        device = await service.authenticateDevice(bearerToken(request));
        const pairing = request.method === "POST" && url.pathname === "/api/pair";
        if (!device && !pairing && !PUBLIC_ASSETS.has(url.pathname)) {
          return json(response, 401, { error: "This device is not paired. Pair it from Settings on the computer running AION." });
        }
        if (device) void service.touchDevice(device.deviceId).catch(() => {});
      }

      // Pairing is the one endpoint an unpaired device may reach, and it is rate-limited per peer.
      if (request.method === "POST" && url.pathname === "/api/pair") {
        if (loopback && !remote.enabled) return json(response, 403, { error: "Private phone access is turned off." });
        const body_ = await body(request);
        try {
          const paired = await service.pairDevice(String(body_.code ?? ""), `pair:${request.socket?.remoteAddress ?? "unknown"}`);
          return json(response, 200, { result: paired });
        } catch (error) {
          return json(response, 429, { error: privacySafe(error instanceof Error ? error.message : "Pairing failed.") });
        }
      }
      if (request.method === "GET" && ASSETS.has(url.pathname)) {
        const [file, type] = ASSETS.get(url.pathname);
        let data = await readFile(join(import.meta.dirname, "public", file));
        // Cache-bust asset URLs embedded in HTML so iPhone Safari loads new UI without wiping site data.
        if (file === "index.html" || file === "phone.html") {
          const html = data.toString("utf8").replaceAll("ASSET_V", ASSET_VERSION);
          data = Buffer.from(html, "utf8");
        }
        const cache = file.endsWith(".html") || file === "sw.js"
          ? "no-store"
          : `public, max-age=60, must-revalidate`;
        response.writeHead(200, {
          "content-type": type,
          "content-length": data.length,
          "cache-control": cache,
          "x-aion-asset-version": ASSET_VERSION,
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "content-security-policy": ASSET_CSP,
        });
        return response.end(data);
      }
      if (request.method === "GET" && url.pathname === "/api/state") {
        const devices = await service.deviceInventory();
        const lastIntake = await service.lastPhoneIntakeAt();
        return json(response, 200, {
          state: await service.snapshot(), providers: await service.providerHealth(), capabilities: service.capabilities(),
          developerBridge: await service.developerBridgeStatus(), developerBridges: await service.developerBridgeInventory(),
          verificationOperations: verificationRunner.operations(),
          salesRoutineTemplates: service.salesRoutineTemplates(),
          remoteAccess: await remoteAccessStatus(settings, listeners, process.env, process.platform, {
            port: boundPort, devices, lastPhoneIntake: lastIntake,
          }),
          devices,
          // V1.2 surfaces. Everything here is already workspace-scoped by the service.
          independence: await service.independence(),
          lessons: await service.lessons(),
          learningSummary: await service.learningSummary(),
          projects: await service.projects(),
          brainBoundary: service.brainBoundary(),
          adaptationBoundary: service.adaptationBoundary(),
          gpu: { credential: await service.gpuCredentialStatus(), sessions: await service.gpuSessions(), proposals: await service.gpuProposals(), models: service.modelProfiles(), cost: await service.costIntelligence() },
          search: searchProvider
            ? { configured: true, ...(await searchProvider.health()) }
            : { configured: false, available: false, detail: `No search provider is configured. Set ${SEARCH_VARIABLE} to a SearXNG-compatible base URL if you want discovery; research works without it when you supply the URLs.` },
          // A phone knows it is a phone, so the UI can hide what only the console may change.
          viewer: loopback ? "console" : "device",
          dataRoot: "private/aion", exportRoot: "private/aion/exports",
        });
      }
      if (request.method === "POST" && url.pathname === "/api/chat/stream") {
        const input = await body(request);
        response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "connection": "keep-alive", "content-security-policy": "default-src 'none'; frame-ancestors 'none'" });
        const send = (event, data) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        try {
          const turn = service.streamMessage(input.id, input.content);
          for (;;) { const step = await turn.next(); if (step.done) { send("done", step.value); break; } send("chunk", { text: step.value }); }
        } catch (error) { send("error", { error: privacySafe(error instanceof Error ? error.message : "Chat request failed.") }); }
        return response.end();
      }
      // Gmail OAuth callback (loopback only). Exchanges code → refresh token once; never stores secrets in state.
      if (request.method === "GET" && url.pathname === "/oauth/gmail/callback") {
        if (!loopback) return json(response, 403, { error: "OAuth callback is only accepted on this computer." });
        const code = url.searchParams.get("code") || "";
        const err = url.searchParams.get("error") || "";
        const gmailStatus = await service.gmailConsentStatus();
        const clientId = gmailStatus.clientIdConfigured
          ? (await service.snapshot()).settings.connectors?.gmailClientId || process.env.AION_GMAIL_CLIENT_ID || ""
          : process.env.AION_GMAIL_CLIENT_ID || "";
        const clientSecret = process.env.AION_GMAIL_CLIENT_SECRET || "";
        const redirectUri = gmailStatus.redirectUri || "http://127.0.0.1:31415/oauth/gmail/callback";
        let bodyHtml = "";
        if (err) {
          bodyHtml = `<h1>Gmail consent cancelled</h1><p class="meta">${escHtml(err)}</p><p><a href="/">Back to AION</a></p>`;
        } else if (!code) {
          bodyHtml = `<h1>Gmail OAuth callback</h1><p class="meta">No authorization code present. Start consent from Settings → Connectors.</p><p><a href="/">Back to AION</a></p>`;
        } else if (!clientId || !clientSecret) {
          bodyHtml = `<h1>Gmail almost ready</h1><p>Authorization code received, but client id/secret env is incomplete.</p>
<p class="meta">Set <code>AION_GMAIL_CLIENT_ID</code> and <code>AION_GMAIL_CLIENT_SECRET</code>, save the client id in Settings if needed, then re-run consent.</p>
<p class="meta">Code was not exchanged and will not be reused. <a href="/">Back to AION</a></p>`;
        } else {
          try {
            const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
              method: "POST",
              headers: { "content-type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                grant_type: "authorization_code",
              }).toString(),
            });
            const tokenJson = await tokenRes.json();
            if (!tokenRes.ok) {
              bodyHtml = `<h1>Gmail token exchange failed</h1><p class="meta">${escHtml(tokenJson.error || tokenRes.status)} ${escHtml(tokenJson.error_description || "")}</p><p><a href="/">Back to AION</a></p>`;
            } else {
              const refresh = tokenJson.refresh_token || "";
              const envName = gmailStatus.refreshTokenEnvVar || "AION_GMAIL_REFRESH_TOKEN";
              bodyHtml = refresh
                ? `<h1>Gmail consent complete</h1>
<p>Copy this refresh token into a user environment variable named <code>${escHtml(envName)}</code>, then restart AION. AION does not store the token in assistant state.</p>
<pre style="white-space:pre-wrap;word-break:break-all;background:#111;color:#eee;padding:12px;border-radius:8px">${escHtml(refresh)}</pre>
<p class="meta">SEND remains disabled until a separate Owner SEND policy is enabled. <a href="/">Back to AION</a></p>`
                : `<h1>Gmail consent partial</h1>
<p>Google did not return a refresh token (often when consent was already granted). Revoke app access in Google Account → Security, then re-run consent with prompt=consent.</p>
<p class="meta">Access token received but not stored. <a href="/">Back to AION</a></p>`;
            }
          } catch (error) {
            bodyHtml = `<h1>Gmail token exchange error</h1><p class="meta">${escHtml(error?.message || error)}</p><p><a href="/">Back to AION</a></p>`;
          }
        }
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>AION Gmail OAuth</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.45}.meta{color:#555}code{background:#f2f2f2;padding:.1em .3em;border-radius:4px}</style></head>
<body>${bodyHtml}</body></html>`;
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        });
        return response.end(html);
      }
      if (request.method !== "POST" || url.pathname !== "/api/action") return json(response, 404, { error: "Not found." });
      const command = await body(request);
      // A phone may drive AION, but it may never mint its own pairing code or change how access
      // itself works. Those decisions stay at the console the owner physically controls.
      if (device && ["device.pair.code", "settings.update"].includes(String(command.type))) {
        const changingAccess = command.type === "device.pair.code" || Object.hasOwn(command.settings ?? {}, "remoteAccess");
        if (changingAccess) return json(response, 403, { error: "Pairing and access settings can only be changed on the computer running AION." });
      }
      return json(response, 200, { result: (await dispatch(command)) ?? null });
    } catch (error) {
      return json(response, 400, { error: privacySafe(error instanceof Error ? error.message : "Request failed.") });
    }
  };

  const server = createServer(handler);
  const servers = [server];

  /** Binds one server to one exact host. Never a wildcard: the host is always explicit. */
  const bind = (target, host, port) => new Promise((resolveBind, reject) => {
    const onError = (error) => { target.off("listening", onListening); reject(error); };
    const onListening = () => { target.off("error", onError); resolveBind(); };
    target.once("error", onError);
    target.listen(port, host, onListening);
  });

  const tick = setInterval(() => void service.tick().catch(() => {}), 30_000); tick.unref();
  server.on("close", () => clearInterval(tick));
  return {
    server, servers, service, repositoryRoot, dataRoot, exportRoot,
    get listeners() { return listeners.map((entry) => ({ ...entry })); },
    /**
     * Applies the persisted access configuration to the actual listeners.
     *
     * Loopback is bound first and unconditionally, so AION is always reachable from this
     * computer. Only when the owner has enabled private access *and* supplied a validated
     * private address different from loopback is a second listener added, on that exact
     * address and the same port. A wildcard is never used, and a failure to bind the private
     * address never widens the bind -- it is recorded and reported, and loopback survives.
     */
    async listen(port = 0) {
      await bind(server, "127.0.0.1", port);
      boundPort = server.address().port;
      listeners = [{ address: "127.0.0.1", port: boundPort, state: "listening", scope: "loopback", detail: "Reachable from this computer only." }];

      const remote = (await service.snapshot()).settings.remoteAccess;
      if (remote?.enabled) {
        let host = null;
        let bindSource = "configured";
        try { host = validateBindAddress(remote.bindAddress); }
        catch (error) {
          listeners.push({ address: String(remote.bindAddress ?? ""), port: boundPort, state: "refused", scope: "private", detail: privacySafe(error.message) });
        }
        // Bind private addresses without requiring Owner-maintained IPs.
        // "auto" / loopback / empty → bind both physical LAN and private overlay when present.
        // Explicit host → bind that first, then still add overlay+LAN discovery for resilience.
        const tryBindPrivate = async (address, source) => {
          if (!address || address === "127.0.0.1" || address === "auto") return false;
          if (listeners.some((e) => e.state === "listening" && e.address === address)) return true;
          const extra = createServer(handler);
          try {
            await bind(extra, address, boundPort);
            servers.push(extra);
            const isOverlay = source === "overlay" || /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./u.test(address);
            listeners.push({
              address,
              port: boundPort,
              state: "listening",
              scope: "private",
              detail: isOverlay
                ? `Private overlay address. Reachable from a paired phone anywhere the overlay reaches (e.g. work cellular). App: ${buildAppUrl(address, boundPort, "/")} · Phone: ${buildPhoneUrl(address, boundPort, "/phone")}`
                : source === "discovered" || source === "lan"
                  ? `Auto-discovered LAN address. Same-network phone access. App: ${buildAppUrl(address, boundPort, "/")} · Phone: ${buildPhoneUrl(address, boundPort, "/phone")}`
                  : `Reachable from a paired device on this private network. App: ${buildAppUrl(address, boundPort, "/")}`,
            });
            return true;
          } catch (error) {
            try { extra.close(); } catch { /* it never bound */ }
            const why = error.code === "EADDRNOTAVAIL" ? "that address does not belong to this computer right now"
              : error.code === "EADDRINUSE" ? "another program is already using that address and port"
                : error.code === "EACCES" ? "the operating system refused permission to bind it"
                  : `the operating system reported ${String(error.code ?? "an error")}`;
            listeners.push({
              address,
              port: boundPort,
              state: "failed",
              scope: "private",
              detail: `AION could not listen on ${address}: ${why}. Loopback is unaffected and AION did not widen the bind.`,
            });
            return false;
          }
        };

        const access = discoverAccessEndpoints();
        const targets = [];
        if (host && host !== "127.0.0.1" && host !== "::1" && host !== "auto") {
          targets.push({ address: host, source: bindSource });
        }
        if (host === "::1") targets.push({ address: "::1", source: "configured" });
        // Always auto-bind overlay + physical when access is on (covers "auto" and stale single IPs).
        if (access.overlay?.address) targets.push({ address: access.overlay.address, source: "overlay" });
        if (access.physical?.address) targets.push({ address: access.physical.address, source: "lan" });
        // Fallback: older discoverPrivateLanAddresses preferred
        if (!access.overlay && !access.physical) {
          const lan = discoverPrivateLanAddresses();
          if (lan.preferred?.address) targets.push({ address: lan.preferred.address, source: "discovered" });
        }

        const seen = new Set();
        let anyPrivate = false;
        for (const t of targets) {
          if (!t.address || seen.has(t.address)) continue;
          seen.add(t.address);
          if (await tryBindPrivate(t.address, t.source)) anyPrivate = true;
        }
        if (!anyPrivate) {
          listeners.push({
            address: host || "auto",
            port: boundPort,
            state: "loopback-only",
            scope: "private",
            detail: "Private access is on, but no usable private LAN or overlay IPv4 is bound yet. Connect Ethernet/Wi-Fi and/or install+sign-in Tailscale on this desktop, then restart AION. Bind address \"auto\" needs no manual IP.",
          });
        }
      }
      return server.address();
    },
    /** Closes every listener, so a private listener never outlives the process that made it. */
    async close() {
      await Promise.all(servers.map((target) => new Promise((resolveClose, reject) => {
        if (!target.listening) return resolveClose();
        target.close((error) => error ? reject(error) : resolveClose());
      })));
      listeners = [];
    },
  };
}
