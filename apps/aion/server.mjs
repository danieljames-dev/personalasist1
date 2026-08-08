import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  AionAssistantV1, BoundaryModelProviderV1, DeterministicModelProviderV1, DeveloperAgentCapabilityV1,
  FileStateRepositoryV1, LocalArchiveImportSourceV1, LocalEchoCapabilityV1, NodePrivateBackupV1,
  RandomIdGeneratorV1, SelectableDeveloperAgentRegistryV1, StaticCapabilityRegistryV1, SystemClockV1,
  UnavailableResearchProviderV1, VerificationCapabilityV1, digestValue, validateBindAddress,
} from "../../packages/local-assistant/dist/index.js";
import { HttpBrainRuntimeV1, runEvaluation } from "./brain-runtime.mjs";
import { resolveDeveloperAgentBridges } from "./developer-agent.mjs";
import { AllowlistedVerificationRunnerV1 } from "./verification.mjs";
import { remoteAccessStatus } from "./private-network.mjs";

const ASSETS = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/sw.js", ["sw.js", "text/javascript; charset=utf-8"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
  ["/icon.svg", ["icon.svg", "image/svg+xml; charset=utf-8"]],
]);
/** The shell an unpaired device may fetch so it can render the pairing screen. Never any data. */
const PUBLIC_ASSETS = new Set(["/", "/app.js", "/styles.css", "/sw.js", "/manifest.webmanifest", "/icon.svg"]);
const MAX_BODY = 1024 * 1024;
const ASSET_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const CAREER_COMMANDS = new Set(["init", "ingest", "profile", "job:import", "match", "draft", "export", "demo"]);
const runFile = promisify(execFile);

/** Removes absolute local paths from any text that reaches the browser, logs, or activity. */
function privacySafe(text) {
  return String(text ?? "").replace(/\\\\[^\s"'<>|]+/gu, "[local path]").replace(/[A-Za-z]:[\\/][^\s"'<>|]*/gu, "[local path]");
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
  for await (const chunk of request) { size += chunk.length; if (size > MAX_BODY) throw new Error("Request body exceeds the 1 MiB limit."); chunks.push(chunk); }
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
 * Same-origin enforcement. The allowed hosts are loopback plus, only when the owner has turned
 * private access on, the one private interface they named. A wildcard is never allowed, and an
 * `Origin` from anywhere else is rejected outright, which is what keeps a web page on the phone
 * from driving AION behind the owner's back.
 */
function sameOrigin(request, address, extraHost) {
  const host = request.headers.host; const origin = request.headers.origin;
  const hosts = new Set([`127.0.0.1:${address.port}`, `localhost:${address.port}`, `[::1]:${address.port}`]);
  if (extraHost) { hosts.add(`${extraHost}:${address.port}`); hosts.add(`[${extraHost}]:${address.port}`); }
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

export async function createAionServer(options = {}) {
  const repositoryRoot = resolve(options.repositoryRoot ?? resolve(import.meta.dirname, "..", ".."));
  const dataRoot = resolve(options.dataRoot ?? join(repositoryRoot, "private", "aion"));
  const exportRoot = resolve(options.exportRoot ?? join(dataRoot, "exports"));
  const developerAgents = options.developerAgents
    ?? (options.developerBridge ? new SelectableDeveloperAgentRegistryV1([options.developerBridge]) : await resolveDeveloperAgentBridges(repositoryRoot));
  const verificationRunner = options.verificationRunner ?? new AllowlistedVerificationRunnerV1(repositoryRoot, digestValue);
  const brainRuntime = options.brainRuntime ?? new HttpBrainRuntimeV1();
  const service = new AionAssistantV1({
    repository: options.repository ?? new FileStateRepositoryV1(dataRoot), clock: options.clock ?? new SystemClockV1(), ids: options.ids ?? new RandomIdGeneratorV1(),
    providers: options.providers ?? [
      new DeterministicModelProviderV1(),
      new BoundaryModelProviderV1("remote-generic", "remote", "Configure an approved remote adapter and a session credential before this boundary can be used. AION ships no remote client."),
      new BoundaryModelProviderV1("local-model", "local", "No supported local model runtime is configured on this computer."),
    ],
    capabilities: options.capabilities ?? new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1(), new DeveloperAgentCapabilityV1(developerAgents, repositoryRoot), new VerificationCapabilityV1(verificationRunner)]),
    importer: options.importer ?? new LocalArchiveImportSourceV1(),
    backup: options.backup ?? new NodePrivateBackupV1(exportRoot), developerAgents,
    // AION ships with no research provider at all. A default that could already reach the
    // internet would make "governed research" a label rather than a property.
    research: options.research ?? new UnavailableResearchProviderV1(),
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
      case "opportunity.assess": return service.assessOpportunity(input.id);
      case "opportunity.list": return { opportunities: await service.opportunities() };
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
      case "brain.evaluate": {
        const settings = await service.brainSettings();
        const endpoint = settings.endpoints.find((entry) => entry.id === input.id);
        if (!endpoint) throw new Error("Endpoint is not registered.");
        return service.recordEvaluation(endpoint.id, await runEvaluation(endpoint, service.evaluationSuite(), brainRuntime), new Date().toISOString());
      }
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
      if (!boundPort || !sameOrigin(request, address, remote.enabled ? remote.bindAddress : null)) {
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
        const data = await readFile(join(import.meta.dirname, "public", file));
        response.writeHead(200, { "content-type": type, "content-length": data.length, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "content-security-policy": ASSET_CSP });
        return response.end(data);
      }
      if (request.method === "GET" && url.pathname === "/api/state") {
        return json(response, 200, {
          state: await service.snapshot(), providers: await service.providerHealth(), capabilities: service.capabilities(),
          developerBridge: await service.developerBridgeStatus(), developerBridges: await service.developerBridgeInventory(),
          verificationOperations: verificationRunner.operations(),
          salesRoutineTemplates: service.salesRoutineTemplates(),
          remoteAccess: await remoteAccessStatus(settings, listeners),
          devices: await service.deviceInventory(),
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
        try { host = validateBindAddress(remote.bindAddress); }
        catch (error) {
          listeners.push({ address: String(remote.bindAddress ?? ""), port: boundPort, state: "refused", scope: "private", detail: privacySafe(error.message) });
        }
        if (host && host !== "127.0.0.1") {
          const extra = createServer(handler);
          try {
            await bind(extra, host, boundPort);
            servers.push(extra);
            listeners.push({ address: host, port: boundPort, state: "listening", scope: "private", detail: "Reachable from a paired device on this private network. Pairing is still required." });
          } catch (error) {
            try { extra.close(); } catch { /* it never bound */ }
            const why = error.code === "EADDRNOTAVAIL" ? "that address does not belong to this computer right now"
              : error.code === "EADDRINUSE" ? "another program is already using that address and port"
                : error.code === "EACCES" ? "the operating system refused permission to bind it"
                  : `the operating system reported ${String(error.code ?? "an error")}`;
            listeners.push({ address: host, port: boundPort, state: "failed", scope: "private", detail: `AION could not listen on ${host}: ${why}. Loopback is unaffected and AION did not widen the bind.` });
          }
        } else if (host === "127.0.0.1") {
          listeners.push({ address: host, port: boundPort, state: "loopback-only", scope: "private", detail: "Private access is on, but the configured address is loopback, so no other device can reach AION. Enter this computer's private network address in Settings." });
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
