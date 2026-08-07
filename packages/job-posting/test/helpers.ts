import { JOB_POSTING_INPUT_VERSION_V1 } from "@aion/career-input";
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
  JobPostingSchemaRegistryV1,
  Sha256JobPostingIdDeriverV1,
  type JobPostingOperationPortsV1,
} from "../src/index.js";

export const OWNER_ID = asOwnerIdV1("30000000-0000-4000-8000-000000000003");
export const ACTOR_ID = asActorIdV1("40000000-0000-4000-8000-000000000004");

export function validationPorts() {
  return {
    canonicalizer: new Acj1CanonicalSerializerV1(),
    digest: new Sha256ObjectDigestV1(),
    schemaRegistry: new JobPostingSchemaRegistryV1(),
  };
}

export function jobPorts(repository?: ObjectRepository): JobPostingOperationPortsV1 {
  const validation = validationPorts();
  let milliseconds = 0;
  return {
    ...validation,
    repository: repository ?? new InMemoryObjectRepositoryV1(validation),
    idDeriver: new Sha256JobPostingIdDeriverV1(),
    clock: { now: () => new Date(Date.UTC(2026, 7, 7, 0, 0, 0, milliseconds++)).toISOString() },
  };
}

export async function inputRoot(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "aion-job-posting-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const approved = join(root, "approved");
  await mkdir(approved);
  return { root, approved };
}

export function syntheticPostingInput() {
  return {
    contractVersion: JOB_POSTING_INPUT_VERSION_V1,
    title: { state: "supplied", value: "Synthetic Systems Steward" },
    company: { state: "supplied", value: "Example Cooperative Alpha" },
    location: { state: "unknown" },
    workArrangement: { state: "supplied", value: "hybrid" },
    employmentType: { state: "supplied", value: "full-time" },
    compensation: { state: "supplied", currency: "USD", minimumMinorUnits: 7000000, maximumMinorUnits: 9000000 },
    description: { state: "supplied", value: "Maintain a synthetic deterministic system." },
    requiredSkills: { state: "specified", values: ["Synthetic Skill Alpha", "Synthetic Skill Beta"] },
    preferredSkills: { state: "unknown", values: [] },
    requiredExperience: { state: "explicit-empty" },
    educationRequirements: { state: "no-preference", values: [] },
    certificationRequirements: { state: "unknown", values: [] },
    travel: { state: "unknown" },
    schedule: { state: "supplied", value: "Synthetic daytime schedule" },
    applicationDeadline: { state: "supplied", value: "2099-12-31" },
    sourceReference: { state: "supplied", value: "https://example.invalid/jobs/synthetic-alpha" },
  } as const;
}

export async function structuredFixture(t: TestContext, operationId = "phase8.synthetic.create") {
  const { root, approved } = await inputRoot(t);
  const sourcePath = join(approved, "synthetic-posting.json");
  await writeFile(sourcePath, JSON.stringify(syntheticPostingInput()), "utf8");
  return {
    root,
    approved,
    sourcePath,
    request: {
      version: "1" as const,
      importOperationId: operationId,
      ownerId: OWNER_ID,
      actorId: ACTOR_ID,
      approvedInputRoot: { version: "1" as const, reference: "synthetic-job-input", absolutePath: approved },
      sourcePath: { version: "1" as const, absolutePath: sourcePath },
      sourceType: "structured-json" as const,
      target: { mode: "create" as const },
      listingCurrentness: { version: "1" as const, state: "unknown" as const },
    },
  };
}
