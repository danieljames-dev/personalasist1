import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  AssistantStateV1, CapabilityContextV1, CapabilityRegistryV1, CapabilityV1, ClockV1,
  DeveloperAgentBridgeV1, IdGeneratorV1, ImportReportV1, ImportSourceV1, ModelProviderV1,
  ModelRequestV1, PrivateBackupV1, StateRepositoryV1,
} from "./contracts.js";
import { PROPOSE_ACTION_PREFIX, PROPOSE_MEMORY_PREFIX } from "./contracts.js";

const scrypt = promisify(scryptCallback);
const MAX_STATE_BYTES = 16 * 1024 * 1024;
const MAX_IMPORT_BYTES = 16 * 1024 * 1024;
const MAX_IMPORT_FILES = 500;

function fail(message: string): never { throw new Error(message); }
function normalizedAbsolute(value: string, label: string): string {
  if (!value || value.includes("\0") || !isAbsolute(value) || resolve(value) !== value) fail(`${label} must be a normalized absolute path.`);
  if (/^(\\\\|\\\\\?\\|\\\\\.\\)/u.test(value)) fail(`${label} cannot use a UNC or device namespace.`);
  return value;
}
function isContained(root: string, selected: string, allowRoot = false): boolean {
  const rel = relative(root, selected);
  return (allowRoot || rel !== "") && !rel.startsWith("..") && !isAbsolute(rel);
}
async function existingParent(path: string): Promise<string> {
  let cursor = path;
  while (true) {
    try { return await realpath(cursor); } catch {
      const parent = dirname(cursor);
      if (parent === cursor) fail("No existing parent is available for the selected path.");
      cursor = parent;
    }
  }
}
async function authorize(rootValue: string, selectedValue: string, allowRoot = false): Promise<{ root: string; selected: string }> {
  const root = normalizedAbsolute(rootValue, "Approved root");
  const selected = normalizedAbsolute(selectedValue, "Selected path");
  if (!isContained(root, selected, allowRoot)) fail("Selected path is outside the approved root.");
  const realRoot = await realpath(root);
  const realParent = await existingParent(selected);
  if (!isContained(realRoot, realParent, true)) fail("Selected path resolves outside the approved root.");
  return { root: realRoot, selected };
}
function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") { if (!Number.isSafeInteger(value)) fail("Canonical values require safe integers."); return String(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  fail("Unsupported canonical value.");
}
export function digestValue(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }

export class SystemClockV1 implements ClockV1 { now(): string { return new Date().toISOString(); } }
export class RandomIdGeneratorV1 implements IdGeneratorV1 { next(): string { return randomUUID(); } }
export class DeterministicClockV1 implements ClockV1 {
  private tick = 0;
  constructor(private readonly epoch = Date.parse("2030-01-01T00:00:00.000Z")) {}
  now(): string { return new Date(this.epoch + this.tick++ * 1000).toISOString(); }
}
export class DeterministicIdGeneratorV1 implements IdGeneratorV1 {
  private sequence = 0;
  next(kind: string): string {
    const hex = createHash("sha256").update(`${kind}:${this.sequence++}`).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }
}

export function createEmptyStateV1(): AssistantStateV1 {
  return {
    schema: "aion.local-assistant-state.v1", revision: 0, onboardingComplete: false,
    settings: {
      providerId: "deterministic", model: "aion-offline-v1", remoteDisclosureAccepted: false,
      memoryContextEnabled: true, schedulerEnabled: true, externalActionsRequireApproval: true,
      importRoots: [], exportRoot: "", credentialEnvironmentVariable: "",
      privacy: { includeMemoryByDefault: true, retainActivityDays: 365 },
    },
    conversations: [], memories: [], tasks: [], routines: [], plans: [], actions: [], approvals: [], activity: [], imports: [],
  };
}
export function validateStateV1(value: unknown): AssistantStateV1 {
  if (!value || typeof value !== "object") fail("Assistant state is malformed.");
  const state = value as Partial<AssistantStateV1>;
  if (state.schema !== "aion.local-assistant-state.v1" || !Number.isSafeInteger(state.revision) || (state.revision ?? -1) < 0) fail("Assistant state version is unsupported.");
  for (const key of ["conversations", "memories", "tasks", "routines", "plans", "actions", "approvals", "activity", "imports"] as const) if (!Array.isArray(state[key])) fail("Assistant state is incomplete.");
  if (!state.settings || typeof state.onboardingComplete !== "boolean") fail("Assistant settings are incomplete.");
  return structuredClone(state as AssistantStateV1);
}

export class InMemoryStateRepositoryV1 implements StateRepositoryV1 {
  private state: AssistantStateV1 | null = null;
  async load(): Promise<AssistantStateV1 | null> { return this.state ? structuredClone(this.state) : null; }
  async save(expectedRevision: number, state: AssistantStateV1): Promise<void> {
    const current = this.state?.revision ?? 0;
    if (current !== expectedRevision || state.revision !== expectedRevision + 1) fail("Assistant state revision conflict.");
    this.state = validateStateV1(state);
  }
}

export class FileStateRepositoryV1 implements StateRepositoryV1 {
  readonly statePath: string;
  constructor(readonly root: string) {
    normalizedAbsolute(root, "Assistant data root");
    if (basename(root).toLowerCase() !== "aion" || basename(dirname(root)).toLowerCase() !== "private") fail("Assistant state must use an explicit private/aion root.");
    this.statePath = join(root, "state-v1.json");
  }
  async load(): Promise<AssistantStateV1 | null> {
    try {
      await authorize(this.root, this.statePath);
      const info = await stat(this.statePath);
      if (!info.isFile() || info.size > MAX_STATE_BYTES) fail("Assistant state is invalid or oversized.");
      return validateStateV1(JSON.parse(await readFile(this.statePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  async save(expectedRevision: number, state: AssistantStateV1): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await authorize(this.root, this.statePath);
    const existing = await this.load();
    if ((existing?.revision ?? 0) !== expectedRevision || state.revision !== expectedRevision + 1) fail("Assistant state revision conflict.");
    const text = `${JSON.stringify(validateStateV1(state), null, 2)}\n`;
    if (Buffer.byteLength(text) > MAX_STATE_BYTES) fail("Assistant state exceeds the V1 size limit.");
    const temporary = join(this.root, `.state-${process.pid}-${randomBytes(8).toString("hex")}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(text, "utf8"); await handle.sync(); } finally { await handle.close(); }
    try { await rename(temporary, this.statePath); } finally { await rm(temporary, { force: true }); }
  }
}

/**
 * Offline deterministic test provider. It performs no network or model call. Two scripted
 * owner prefixes exercise the proposal protocol so approval and memory review are testable
 * without a live provider: `propose: <text>` and `remember: <text>`.
 */
export class DeterministicModelProviderV1 implements ModelProviderV1 {
  readonly id = "deterministic";
  readonly location = "local" as const;
  async health(): Promise<{ available: boolean; detail: string }> { return { available: true, detail: "Offline deterministic provider is ready." }; }
  async *stream(request: ModelRequestV1): AsyncIterable<string> {
    if (request.signal?.aborted) throw new Error("Chat request cancelled.");
    const latest = [...request.messages].reverse().find((item) => item.role === "owner")?.content ?? "";
    const context = request.memoryContext.length ? ` I used ${request.memoryContext.length} enabled local memory record(s).` : "";
    const proposeMatch = latest.trim().match(/^propose:\s*(.+)$/isu);
    const rememberMatch = latest.trim().match(/^remember:\s*(.+)$/isu);
    let response = `Offline response: ${latest.trim() || "Ready."}.${context}`;
    if (proposeMatch) response += `\n${PROPOSE_ACTION_PREFIX}${JSON.stringify({ capabilityId: "aion.local.echo.v1", input: { text: proposeMatch[1]!.slice(0, 1000) } })}`;
    if (rememberMatch) response += `\n${PROPOSE_MEMORY_PREFIX}${JSON.stringify({ content: rememberMatch[1]!.slice(0, 2000), category: "semantic" })}`;
    for (const token of response.match(/\S+\s*/gu) ?? []) {
      if (request.signal?.aborted) throw new Error("Chat request cancelled.");
      yield token;
    }
  }
}

export class BoundaryModelProviderV1 implements ModelProviderV1 {
  constructor(readonly id: string, readonly location: "local" | "remote", private readonly detail: string) {}
  async health(): Promise<{ available: boolean; detail: string }> { return { available: false, detail: this.detail }; }
  async *stream(): AsyncIterable<string> { throw new Error(this.detail); }
}

export class StaticCapabilityRegistryV1 implements CapabilityRegistryV1 {
  private readonly entries = new Map<string, CapabilityV1>();
  constructor(capabilities: readonly CapabilityV1[]) {
    for (const capability of capabilities) { if (this.entries.has(capability.id)) fail("Duplicate capability identifier."); this.entries.set(capability.id, capability); }
  }
  get(id: string): CapabilityV1 | null { return this.entries.get(id) ?? null; }
  list(): readonly CapabilityV1[] { return [...this.entries.values()]; }
}

export class LocalEchoCapabilityV1 implements CapabilityV1 {
  readonly id = "aion.local.echo.v1";
  readonly privacy = "private" as const;
  readonly approval = "always" as const;
  readonly timeoutMs = 5000;
  readonly maxRetries = 1;
  summarize(input: Record<string, unknown>): string { return `Return a bounded local value (${String(input.text ?? "").length} characters).`; }
  validate(input: Record<string, unknown>): void { if (typeof input.text !== "string" || !input.text.trim() || input.text.length > 1000) fail("Echo capability input is invalid."); }
  async execute(input: Record<string, unknown>, _context: CapabilityContextV1, signal: AbortSignal): Promise<Record<string, unknown>> { if (signal.aborted) fail("Capability cancelled."); return { text: input.text, local: true }; }
}

/**
 * The only path from AION to a local developer agent. It is a normal registered capability, so
 * every run is validated, digest-bound, one-shot approved, activity-recorded, and cancellable.
 * The conversational model can at most propose it; it can never invoke or approve it.
 */
export class DeveloperAgentCapabilityV1 implements CapabilityV1 {
  readonly id = "aion.developer.task.v1";
  readonly privacy = "private" as const;
  readonly approval = "always" as const;
  readonly timeoutMs = 600_000;
  readonly maxRetries = 0;
  constructor(private readonly bridge: DeveloperAgentBridgeV1, private readonly approvedRepositoryRoot: string) {
    normalizedAbsolute(approvedRepositoryRoot, "Approved repository root");
  }
  summarize(input: Record<string, unknown>): string {
    return `Run one bounded developer-agent task in the single approved repository root (${String(input.instruction ?? "").length} instruction characters). No other directory is reachable.`;
  }
  validate(input: Record<string, unknown>): void {
    if (typeof input.instruction !== "string" || !input.instruction.trim() || input.instruction.length > 4000) fail("Developer-agent instruction is invalid.");
    if (input.repositoryRoot !== undefined && input.repositoryRoot !== this.approvedRepositoryRoot) fail("Developer-agent task is outside the approved repository root.");
  }
  async execute(input: Record<string, unknown>, _context: CapabilityContextV1, signal: AbortSignal): Promise<Record<string, unknown>> {
    const status = await this.bridge.status();
    if (!status.available) fail("No supported local developer-agent executable is available.");
    const result = await this.bridge.run({ repositoryRoot: this.approvedRepositoryRoot, instruction: String(input.instruction) }, signal);
    return { exitCode: result.exitCode, summary: result.summary.slice(-20_000) };
  }
}

export class SyntheticDeveloperAgentBridgeV1 implements DeveloperAgentBridgeV1 {
  async status(): Promise<{ available: boolean; executable: string; detail: string }> { return { available: true, executable: "synthetic", detail: "Synthetic test bridge is ready." }; }
  async run(task: { repositoryRoot: string; instruction: string }, signal: AbortSignal): Promise<{ exitCode: number; summary: string }> {
    normalizedAbsolute(task.repositoryRoot, "Repository root");
    if (!task.instruction.trim() || task.instruction.length > 4000 || signal.aborted) fail("Developer-agent request is invalid or cancelled.");
    return { exitCode: 0, summary: "Synthetic bounded developer task completed without modifying files." };
  }
}

export class UnavailableDeveloperAgentBridgeV1 implements DeveloperAgentBridgeV1 {
  constructor(private readonly detail = "No supported local developer-agent executable is configured.") {}
  async status(): Promise<{ available: boolean; executable: null; detail: string }> { return { available: false, executable: null, detail: this.detail }; }
  async run(): Promise<never> { throw new Error(this.detail); }
}

function role(value: unknown): "owner" | "assistant" { return value === "assistant" ? "assistant" : "owner"; }
function text(value: unknown): string { return typeof value === "string" ? value.slice(0, 100_000) : ""; }
function chatGptConversations(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((conversation, index) => {
    const item = conversation as Record<string, unknown>;
    const mapping = item.mapping && typeof item.mapping === "object" ? Object.values(item.mapping as Record<string, unknown>) : [];
    const messages = mapping.flatMap((node) => {
      const message = (node as Record<string, unknown>).message as Record<string, unknown> | null;
      const author = message?.author as Record<string, unknown> | undefined;
      const content = message?.content as Record<string, unknown> | undefined;
      const parts = Array.isArray(content?.parts) ? content.parts.filter((part): part is string => typeof part === "string").join("\n") : "";
      return parts ? [{ role: role(author?.role), content: text(parts), at: typeof message?.create_time === "number" ? new Date(message.create_time * 1000).toISOString() : null }] : [];
    });
    return { title: text(item.title) || `Imported conversation ${index + 1}`, messages };
  });
}
function genericConversations(value: unknown, platform: "claude" | "grok") {
  const source = Array.isArray(value) ? value : ((value as Record<string, unknown> | null)?.conversations ?? []);
  if (!Array.isArray(source)) return [];
  return source.map((conversation, index) => {
    const item = conversation as Record<string, unknown>;
    const rawMessages = Array.isArray(item.messages) ? item.messages : Array.isArray(item.chat_messages) ? item.chat_messages : [];
    return { title: text(item.title ?? item.name) || `${platform} conversation ${index + 1}`, messages: rawMessages.flatMap((message) => {
      const entry = message as Record<string, unknown>;
      const body = text(entry.content ?? entry.text);
      return body ? [{ role: role(entry.role ?? entry.sender), content: body, at: typeof (entry.created_at ?? entry.timestamp) === "string" ? String(entry.created_at ?? entry.timestamp) : null }] : [];
    }) };
  });
}

export class LocalArchiveImportSourceV1 implements ImportSourceV1 {
  async dryRun(request: { platform: ImportReportV1["platform"]; selectedRoot: string; selectedPath: string; knownDigests: readonly string[] }) {
    const allowed = await authorize(request.selectedRoot, request.selectedPath, true);
    const selectedInfo = await lstat(allowed.selected);
    if (selectedInfo.isSymbolicLink()) fail("Import selection cannot be a symbolic link.");
    const paths: string[] = [];
    const visit = async (current: string): Promise<void> => {
      if (paths.length >= MAX_IMPORT_FILES) fail("Import inventory exceeds the V1 file limit.");
      const info = await lstat(current);
      if (info.isSymbolicLink()) fail("Import inventory contains a symbolic link.");
      if (info.isFile()) { paths.push(current); return; }
      if (!info.isDirectory()) return;
      for (const entry of (await readdir(current)).sort()) await visit(join(current, entry));
    };
    await visit(allowed.selected);
    const items = [];
    const conversations = [];
    for (const path of paths) {
      const info = await stat(path);
      const rel = relative(allowed.root, path).replaceAll("\\", "/");
      if (info.size > MAX_IMPORT_BYTES) { items.push({ sourceRef: `source:${digestValue(rel).slice(0, 16)}`, relativePath: rel, digest: "", bytes: info.size, classification: "unsupported" as const, duplicate: false, conversationCount: 0 }); continue; }
      const bytes = await readFile(path);
      const digest = createHash("sha256").update(bytes).digest("hex");
      let parsedConversations: ReturnType<typeof chatGptConversations> = [];
      let classification: "conversation" | "career" | "unsupported" = request.platform === "career" ? "career" : "unsupported";
      if (request.platform !== "career" && path.toLowerCase().endsWith(".json")) {
        try {
          const parsed = JSON.parse(bytes.toString("utf8"));
          parsedConversations = request.platform === "chatgpt" ? chatGptConversations(parsed) : genericConversations(parsed, request.platform);
          if (parsedConversations.length) classification = "conversation";
        } catch { classification = "unsupported"; }
      }
      conversations.push(...parsedConversations);
      items.push({ sourceRef: `source:${digest.slice(0, 16)}`, relativePath: rel, digest, bytes: info.size, classification, duplicate: request.knownDigests.includes(digest), conversationCount: parsedConversations.length });
    }
    return { platform: request.platform, selectedRootRef: `root:${digestValue(allowed.root).slice(0, 16)}`, items, warnings: items.some((item) => item.classification === "unsupported") ? ["Unsupported files are excluded."] : [], conversations };
  }
}

interface BackupEnvelopeV1 { version: "aion.private-backup.v1"; kdf: "scrypt"; cipher: "aes-256-gcm"; salt: string; nonce: string; tag: string; ciphertext: string; stateDigest: string; }
export class NodePrivateBackupV1 implements PrivateBackupV1 {
  constructor(private readonly approvedDestinationRoot: string) { normalizedAbsolute(approvedDestinationRoot, "Private backup root"); }
  async create(state: AssistantStateV1, destination: string, passphrase: string): Promise<{ digest: string; bytes: number }> {
    if (passphrase.length < 12) fail("Private backup passphrase must contain at least 12 characters.");
    await mkdir(this.approvedDestinationRoot, { recursive: true });
    await authorize(this.approvedDestinationRoot, destination);
    const plaintext = Buffer.from(canonical(validateStateV1(state)), "utf8");
    const salt = randomBytes(16); const nonce = randomBytes(12);
    const key = await scrypt(passphrase, salt, 32) as Buffer;
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from("aion.private-backup.v1", "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope: BackupEnvelopeV1 = { version: "aion.private-backup.v1", kdf: "scrypt", cipher: "aes-256-gcm", salt: salt.toString("base64url"), nonce: nonce.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url"), stateDigest: createHash("sha256").update(plaintext).digest("hex") };
    const serialized = `${JSON.stringify(envelope)}\n`;
    await writeFile(destination, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    const restored = await this.restore(destination, passphrase);
    if (!timingSafeEqual(Buffer.from(digestValue(restored), "hex"), Buffer.from(digestValue(state), "hex"))) fail("Private backup restore verification failed.");
    return { digest: createHash("sha256").update(serialized).digest("hex"), bytes: Buffer.byteLength(serialized) };
  }
  async restore(destination: string, passphrase: string): Promise<AssistantStateV1> {
    await authorize(this.approvedDestinationRoot, destination);
    const raw = await readFile(destination, "utf8");
    if (Buffer.byteLength(raw) > MAX_STATE_BYTES * 2) fail("Private backup is oversized.");
    const envelope = JSON.parse(raw) as BackupEnvelopeV1;
    if (envelope.version !== "aion.private-backup.v1" || envelope.kdf !== "scrypt" || envelope.cipher !== "aes-256-gcm") fail("Private backup version is unsupported.");
    const key = await scrypt(passphrase, Buffer.from(envelope.salt, "base64url"), 32) as Buffer;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce, "base64url"));
    decipher.setAAD(Buffer.from("aion.private-backup.v1", "utf8")); decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final()]);
    const actual = createHash("sha256").update(plaintext).digest("hex");
    if (!timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(envelope.stateDigest, "hex"))) fail("Private backup integrity validation failed.");
    return validateStateV1(JSON.parse(plaintext.toString("utf8")));
  }
}
