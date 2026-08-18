/**
 * A filesystem the tests fully control, and the record builders the assertions read like.
 *
 * The fake filesystem exists because the boundary this package enforces is mostly about links,
 * junctions and paths that resolve somewhere other than where they are spelled — and creating real
 * ones needs privileges the test run may not have, on a host whose short-name and case behaviour
 * would then vary between machines. Here the aliasing is explicit: `addLink` says exactly what
 * resolves to what, so a test asserting that an escape is refused is asserting about the rule rather
 * than about the host it happened to run on.
 *
 * `realpathSync` follows links segment by segment, the way the real one does, so a link *inside* the
 * approved root that points *outside* it is caught by the same comparison the real filesystem would
 * force.
 */

import {
  PERSONAL_CONTEXT_AUTHORITY_SOURCE,
  PERSONAL_CONTEXT_DECLARATION_SCHEMA_V1,
  PERSONAL_CONTEXT_MILESTONE_ID,
  PERSONAL_CONTEXT_OWNER_AUTHORIZATION_ID,
  PERSONAL_CONTEXT_SCHEMA_V1,
  type ContextSourceV1,
} from "../src/contracts.js";
import type { FileStatV1, PersonalContextFsV1 } from "../src/path-boundary.js";

type EntryKind = "dir" | "file" | "link";

interface FakeEntry {
  kind: EntryKind;
  contents: string;
  target: string;
  mtimeMs: number;
}

function norm(path: string): string {
  const flattened = path.replace(/\\/g, "/").toLowerCase();
  return flattened.length > 3 && flattened.endsWith("/") ? flattened.slice(0, -1) : flattened;
}

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 2 ? path.slice(0, index + 1) : path.slice(0, index);
}

export class FakeFs implements PersonalContextFsV1 {
  private readonly entries = new Map<string, FakeEntry>();

  constructor() {
    this.entries.set("c:/", { kind: "dir", contents: "", target: "", mtimeMs: 0 });
  }

  addDir(path: string): this {
    let current = "c:/";
    for (const segment of norm(path).replace(/^c:\//, "").split("/").filter((part) => part !== "")) {
      current = current === "c:/" ? `c:/${segment}` : `${current}/${segment}`;
      if (!this.entries.has(current)) this.entries.set(current, { kind: "dir", contents: "", target: "", mtimeMs: 0 });
    }
    return this;
  }

  addFile(path: string, contents: string, mtimeMs = 1_700_000_000_000): this {
    this.addDir(parentOf(norm(path)));
    this.entries.set(norm(path), { kind: "file", contents, target: "", mtimeMs });
    return this;
  }

  addLink(path: string, target: string): this {
    this.addDir(parentOf(norm(path)));
    this.entries.set(norm(path), { kind: "link", contents: "", target: norm(target), mtimeMs: 0 });
    return this;
  }

  /** Change a file's bytes and modification time, the way an editor would. */
  touch(path: string, contents: string, mtimeMs: number): this {
    const entry = this.entries.get(norm(path));
    if (entry === undefined) throw new Error(`no such fake file: ${path}`);
    entry.contents = contents;
    entry.mtimeMs = mtimeMs;
    return this;
  }

  remove(path: string): this {
    this.entries.delete(norm(path));
    return this;
  }

  realpathSync(path: string): string {
    const target = norm(path);
    const segments = target.replace(/^c:\//, "").split("/").filter((part) => part !== "");
    let current = "c:/";
    for (const segment of segments) {
      current = current === "c:/" ? `c:/${segment}` : `${current}/${segment}`;
      let guard = 0;
      let entry = this.entries.get(current);
      while (entry !== undefined && entry.kind === "link") {
        if (guard > 8) throw new Error("ELOOP");
        current = entry.target;
        entry = this.entries.get(current);
        guard += 1;
      }
      if (entry === undefined) throw new Error(`ENOENT: ${current}`);
    }
    return current;
  }

  lstatSync(path: string): FileStatV1 {
    const entry = this.entries.get(norm(path));
    if (entry === undefined) throw new Error(`ENOENT: ${path}`);
    return {
      isDirectory: () => entry.kind === "dir",
      isFile: () => entry.kind === "file",
      isSymbolicLink: () => entry.kind === "link",
      size: entry.contents.length,
      mtimeMs: entry.mtimeMs,
    };
  }

  readdirSync(path: string): readonly string[] {
    const parent = norm(path);
    const names: string[] = [];
    for (const key of this.entries.keys()) {
      if (key === parent || key === "c:/") continue;
      if (parentOf(key) !== parent) continue;
      names.push(key.slice(key.lastIndexOf("/") + 1));
    }
    return names.sort();
  }

  readFileSync(path: string): string {
    const entry = this.entries.get(norm(path));
    if (entry === undefined || entry.kind !== "file") throw new Error(`ENOENT: ${path}`);
    return entry.contents;
  }
}

export function makeSource(overrides: Partial<ContextSourceV1> = {}): ContextSourceV1 {
  return {
    schema: PERSONAL_CONTEXT_SCHEMA_V1,
    sourceId: "test-source",
    sourceType: "APPROVED_LOCAL_FOLDER",
    location: "c:/pc-test/root",
    displayName: "Test approved folder",
    purpose: "Bounded test source for the personal context engine",
    authorizationSource: PERSONAL_CONTEXT_AUTHORITY_SOURCE,
    milestoneId: PERSONAL_CONTEXT_MILESTONE_ID,
    ownerAuthorizationId: PERSONAL_CONTEXT_OWNER_AUTHORIZATION_ID,
    allowedScope: [],
    deniedScope: [],
    sensitivityClass: "INTERNAL",
    eligibleProviders: ["codex", "grok", "claude", "local"],
    syncMode: "ON_DEMAND",
    recursiveAllowed: true,
    maxDepth: 6,
    maxFiles: 100,
    maxBytes: 1_000_000,
    followSymlinksAllowed: false,
    activeState: "ACTIVE",
    revokedAt: null,
    expiresAt: null,
    priority: 100,
    lastAttemptedSync: null,
    lastSuccessfulSync: null,
    fingerprint: null,
    version: 1,
    sourceModifiedAt: null,
    repositoryHead: null,
    repositoryRemote: null,
    createdAt: "2026-08-18T00:00:00Z",
    updatedAt: "2026-08-18T00:00:00Z",
    ...overrides,
  };
}

export interface DeclaredRowV1 {
  category: string;
  predicate: string;
  value: string;
  observedAt?: string | null;
  lastConfirmedAt?: string | null;
  temporalState?: string;
  validFrom?: string | null;
  validTo?: string | null;
  sensitivity?: string;
  confidence?: string;
  eligibleUses?: readonly string[];
  evidenceReference?: string;
}

/** A declaration document with sensible defaults, so a test only states what it is testing. */
export function declaration(rows: readonly DeclaredRowV1[], subject = "owner", documentId = "doc-1"): string {
  return JSON.stringify(
    {
      schema: PERSONAL_CONTEXT_DECLARATION_SCHEMA_V1,
      subject,
      documentId,
      facts: rows.map((row) => ({
        eligibleUses: ["JOB_MATCHING"],
        confidence: "HIGH",
        ...row,
      })),
    },
    null,
    2,
  );
}

export const NOW = "2026-08-18T12:00:00Z";
