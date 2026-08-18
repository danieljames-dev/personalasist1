/**
 * Roadmap state on disk, so the sequence survives the worker that was running it.
 *
 * Four collections with three different lifetimes, kept apart on purpose. The roadmap header changes
 * when the shape changes; milestones change on every transition; gates change when the Owner is
 * asked or answers; the ledger only ever grows. A single document would make a milestone transition
 * rewrite the Owner's pending decisions, which is how a crash mid-dispatch loses a gate.
 *
 * ## The ledger is append-only, and checkably so
 *
 * Events are appended as lines and numbered from one with no gaps. Reading validates that the
 * sequence is contiguous, so a deleted or reordered line is an integrity error rather than a quietly
 * shorter history. That matters more here than anywhere else in the system: the ledger is the only
 * evidence that a milestone was authorised, dispatched and verified rather than simply marked done.
 * A history that can be rewritten to manufacture success is not evidence.
 *
 * ## Fail closed on the way out
 *
 * A malformed record raises and names its file rather than being skipped. Skipping is friendlier and
 * wrong: a milestone silently dropped from the graph changes what is "ready", and a corrupt roadmap
 * header silently ignored would let the orchestrator start from an empty plan and re-run completed
 * work.
 */

import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeAtomic } from "./atomic-write.js";
import {
  ROADMAP_EVENT_SCHEMA_V1,
  ROADMAP_EVENT_TYPES_V1,
  ROADMAP_PACKET_SCHEMA_V1,
  validateMilestone,
  validateOwnerGate,
  validateRoadmap,
  type RoadmapOwnerGateV1,
  type RoadmapEventV1,
  type RoadmapMilestoneV1,
  type RoadmapV1,
  type TakeoverPacketV1,
} from "./roadmap-contracts.js";

/** Raised when durable roadmap state cannot be trusted. Never swallowed inside this package. */
export class RoadmapIntegrityError extends Error {
  readonly recordPath: string;
  constructor(recordPath: string, detail: string) {
    super(`roadmap record is unusable (${recordPath}): ${detail}`);
    this.name = "RoadmapIntegrityError";
    this.recordPath = recordPath;
  }
}

export interface RoadmapStoreV1 {
  loadRoadmap(): RoadmapV1 | null;
  saveRoadmap(roadmap: RoadmapV1): void;
  listMilestones(): readonly RoadmapMilestoneV1[];
  loadMilestone(milestoneId: string): RoadmapMilestoneV1 | null;
  saveMilestone(milestone: RoadmapMilestoneV1): void;
  listGates(): readonly RoadmapOwnerGateV1[];
  saveGate(gate: RoadmapOwnerGateV1): void;
  appendEvent(event: Omit<RoadmapEventV1, "schema" | "sequence">): RoadmapEventV1;
  listEvents(): readonly RoadmapEventV1[];
  savePacket(packet: TakeoverPacketV1): void;
  loadPacket(milestoneId: string): TakeoverPacketV1 | null;
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function segment(value: string, what: string): string {
  if (!SAFE_SEGMENT.test(value)) throw new RoadmapIntegrityError(value, `${what} is not a safe path segment`);
  return value;
}

function readJson(path: string): unknown | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new RoadmapIntegrityError(path, "record is not valid JSON");
  }
}

function readAll(directory: string): { path: string; parsed: unknown }[] {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return [];
  }
  const rows: { path: string; parsed: unknown }[] = [];
  for (const name of [...names].sort()) {
    if (!name.endsWith(".json")) continue;
    const path = join(directory, name);
    const parsed = readJson(path);
    if (parsed === null) throw new RoadmapIntegrityError(path, "record could not be read");
    rows.push({ path, parsed });
  }
  return rows;
}

/**
 * A roadmap store rooted at one directory.
 *
 * Reopening it over the same root is how restart recovery works: everything the orchestrator needs
 * to resume is a file, and nothing needs a transcript.
 */
export function createFileRoadmapStore(root: string): RoadmapStoreV1 {
  const roadmapPath = join(root, "roadmap.json");
  const milestonesDir = join(root, "milestones");
  const gatesDir = join(root, "gates");
  const packetsDir = join(root, "packets");
  const ledgerPath = join(root, "events.jsonl");

  function readLedger(): RoadmapEventV1[] {
    let raw: string;
    try {
      raw = readFileSync(ledgerPath, "utf8");
    } catch {
      return [];
    }
    const events: RoadmapEventV1[] = [];
    const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== "");
    lines.forEach((line, index) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new RoadmapIntegrityError(ledgerPath, `event ${index + 1} is not valid JSON`);
      }
      const event = parsed as Partial<RoadmapEventV1>;
      if (event.schema !== ROADMAP_EVENT_SCHEMA_V1) {
        throw new RoadmapIntegrityError(ledgerPath, `event ${index + 1} has the wrong schema`);
      }
      if (typeof event.type !== "string" || !ROADMAP_EVENT_TYPES_V1.includes(event.type)) {
        throw new RoadmapIntegrityError(ledgerPath, `event ${index + 1} has an unsupported type`);
      }
      // Contiguity is the tamper-evidence: a removed or reordered line breaks the run of sequences.
      if (event.sequence !== index + 1) {
        throw new RoadmapIntegrityError(ledgerPath, `event ledger is not contiguous at line ${index + 1}`);
      }
      events.push(event as RoadmapEventV1);
    });
    return events;
  }

  return {
    loadRoadmap() {
      const parsed = readJson(roadmapPath);
      if (parsed === null) return null;
      const problem = validateRoadmap(parsed);
      if (problem !== null) throw new RoadmapIntegrityError(roadmapPath, problem);
      return parsed as RoadmapV1;
    },
    saveRoadmap(roadmap) {
      const problem = validateRoadmap(roadmap);
      if (problem !== null) throw new RoadmapIntegrityError(roadmapPath, problem);
      writeAtomic(roadmapPath, `${JSON.stringify(roadmap, null, 2)}\n`);
    },
    listMilestones() {
      return readAll(milestonesDir)
        .map(({ path, parsed }) => {
          const problem = validateMilestone(parsed);
          if (problem !== null) throw new RoadmapIntegrityError(path, problem);
          return parsed as RoadmapMilestoneV1;
        })
        .sort((a, b) => a.milestoneId.localeCompare(b.milestoneId));
    },
    loadMilestone(milestoneId) {
      const parsed = readJson(join(milestonesDir, `${segment(milestoneId, "milestoneId")}.json`));
      if (parsed === null) return null;
      const problem = validateMilestone(parsed);
      if (problem !== null) throw new RoadmapIntegrityError(milestoneId, problem);
      return parsed as RoadmapMilestoneV1;
    },
    saveMilestone(milestone) {
      const problem = validateMilestone(milestone);
      if (problem !== null) throw new RoadmapIntegrityError(milestone.milestoneId ?? "<unknown>", problem);
      writeAtomic(
        join(milestonesDir, `${segment(milestone.milestoneId, "milestoneId")}.json`),
        `${JSON.stringify(milestone, null, 2)}\n`,
      );
    },
    listGates() {
      return readAll(gatesDir)
        .map(({ path, parsed }) => {
          const problem = validateOwnerGate(parsed);
          if (problem !== null) throw new RoadmapIntegrityError(path, problem);
          return parsed as RoadmapOwnerGateV1;
        })
        .sort((a, b) => a.gateId.localeCompare(b.gateId));
    },
    saveGate(gate) {
      const problem = validateOwnerGate(gate);
      if (problem !== null) throw new RoadmapIntegrityError(gate.gateId ?? "<unknown>", problem);
      writeAtomic(join(gatesDir, `${segment(gate.gateId, "gateId")}.json`), `${JSON.stringify(gate, null, 2)}\n`);
    },
    appendEvent(event) {
      const sequence = readLedger().length + 1;
      const record: RoadmapEventV1 = { schema: ROADMAP_EVENT_SCHEMA_V1, sequence, ...event };
      mkdirSync(root, { recursive: true });
      // Appended rather than rewritten: the whole point is that earlier lines cannot be revised.
      appendFileSync(ledgerPath, `${JSON.stringify(record)}\n`, "utf8");
      return record;
    },
    listEvents() {
      return readLedger();
    },
    savePacket(packet) {
      if (packet.schema !== ROADMAP_PACKET_SCHEMA_V1) {
        throw new RoadmapIntegrityError(packet.milestoneId, "takeover packet schema mismatch");
      }
      writeAtomic(
        join(packetsDir, `${segment(packet.milestoneId, "milestoneId")}.json`),
        `${JSON.stringify(packet, null, 2)}\n`,
      );
    },
    loadPacket(milestoneId) {
      const parsed = readJson(join(packetsDir, `${segment(milestoneId, "milestoneId")}.json`));
      if (parsed === null) return null;
      const packet = parsed as Partial<TakeoverPacketV1>;
      if (packet.schema !== ROADMAP_PACKET_SCHEMA_V1) {
        throw new RoadmapIntegrityError(milestoneId, "takeover packet schema mismatch");
      }
      return packet as TakeoverPacketV1;
    },
  };
}
