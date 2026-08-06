import { CAREER_FACTS_INPUT_VERSION_V1 } from "@aion/career-input";
import { asActorIdV1, asOwnerIdV1 } from "@aion/identity";
import {
  Acj1CanonicalSerializerV1,
  InMemoryObjectRepositoryV1,
  Sha256ObjectDigestV1,
  type ObjectRepository,
} from "@aion/object";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import {
  CareerEvidenceSchemaRegistryV1,
  Sha256CareerEvidenceIdDeriverV1,
  type CareerEvidenceOperationPortsV1,
} from "../src/index.js";

export const OWNER_ID = asOwnerIdV1("10000000-0000-4000-8000-000000000001");
export const ACTOR_ID = asActorIdV1("20000000-0000-4000-8000-000000000002");

export function validationPorts() {
  return {
    canonicalizer: new Acj1CanonicalSerializerV1(),
    digest: new Sha256ObjectDigestV1(),
    schemaRegistry: new CareerEvidenceSchemaRegistryV1(),
  };
}

export function evidencePorts(repository?: ObjectRepository): CareerEvidenceOperationPortsV1 {
  const validation = validationPorts();
  let milliseconds = 0;
  return {
    ...validation,
    repository: repository ?? new InMemoryObjectRepositoryV1(validation),
    idDeriver: new Sha256CareerEvidenceIdDeriverV1(),
    clock: { now: () => new Date(Date.UTC(2026, 7, 6, 12, 0, 0, milliseconds++)).toISOString() },
  };
}

export async function inputFixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "aion-career-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const approved = join(root, "approved");
  await mkdir(approved);
  return { root, approved };
}

export function syntheticFactsInput() {
  return {
    contractVersion: CAREER_FACTS_INPUT_VERSION_V1,
    entries: [{
      version: "1",
      factId: "synthetic-entry-alpha",
      factKind: "role-title",
      value: { state: "supplied", value: "Synthetic Role Alpha" },
      startDate: { state: "supplied", value: "2024-01" },
      endDate: { state: "unknown" },
      responsibilities: ["Synthetic responsibility alpha"],
      accomplishments: ["Synthetic result alpha"],
      skills: ["Synthetic skill alpha"],
      toolsAndTechnologies: ["Synthetic tool alpha"],
      evidenceReferences: [],
      ownerConfirmed: true,
    }],
  };
}

export async function factsRequest(t: TestContext, operationId = "phase7.synthetic.import") {
  const { root, approved } = await inputFixture(t);
  const sourcePath = join(approved, "synthetic-facts.json");
  await writeFile(sourcePath, JSON.stringify(syntheticFactsInput()), "utf8");
  return {
    root,
    approved,
    sourcePath,
    request: {
      version: "1" as const,
      importOperationId: operationId,
      ownerId: OWNER_ID,
      actorId: ACTOR_ID,
      approvedInputRoot: { version: "1" as const, reference: "synthetic-career-input", absolutePath: approved },
      sourcePath: { version: "1" as const, absolutePath: sourcePath },
      sourceType: "career-facts-json" as const,
    },
  };
}
