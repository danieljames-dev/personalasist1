/**
 * Which providers the AION app process can actually execute work with, stated honestly.
 *
 * The dispatch layer will happily manufacture an adapter for every provider id if the caller
 * supplies none — see `adaptersFor` in `mva-dispatch.ts`, which fills the gaps with a bounded local
 * executor. That default is right for a test and wrong for a live process, because the artifact it
 * writes records `EXECUTOR = claude` while nothing resembling Claude ran. A system that reports a
 * provider it did not use is worse than one that reports none.
 *
 * So this module registers adapters explicitly, for all four ids, and lies about none of them:
 *
 * - `local` gets the real bounded executor. It is deterministic, offline, writes one artifact inside
 *   an artifact root, costs nothing, and is the only executor this process has.
 * - `codex`, `grok` and `claude` get an adapter that refuses, and health that says `DISABLED`. That
 *   is not a placeholder — it is the true state. The Owner authority record for this milestone lists
 *   `allowedProviders: ["local"]` with a zero spend ceiling, so a cloud provider is not merely
 *   missing, it is disallowed, and `manuallyDisabled` is the field the bridge already has for
 *   exactly that.
 *
 * Routing is untouched. This module hands Provider Bridge a truthful picture of the world and lets
 * it decide; it contains no ordering, no preference and no fallback logic of its own.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  PROVIDER_IDS_V1,
  closedEffectGate,
  createRealBoundedExecutorAdapter,
  defaultProviderCapabilities,
  defaultProviderHealth,
  memoryEffectJournal,
} from "../../packages/director/dist/index.js";

/** Providers this process has a real executor for. */
export const REGISTERED_PROVIDERS_V1 = Object.freeze(["local"]);

/**
 * Providers deliberately not registered, and why.
 *
 * Kept as text rather than a bare list so the reason travels with the fact — the Owner asking "why
 * is Claude not running my roadmap" should not have to read the directive to find out.
 */
export const UNREGISTERED_PROVIDERS_V1 = Object.freeze({
  codex: "no cloud executor is wired into the app process, and paid providers are not authorized",
  grok: "no cloud executor is wired into the app process, and paid providers are not authorized",
  claude: "no cloud executor is wired into the app process, and paid providers are not authorized",
});

function writeFileEnsuringDirectory(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

function readFileUtf8(path) {
  return readFileSync(path, "utf8");
}

/**
 * An adapter for a provider this process cannot run.
 *
 * It returns `PROVIDER_UNAVAILABLE` rather than throwing, because that is a class the bridge already
 * understands: it fails over to the next eligible provider and records the attempt truthfully. It
 * writes nothing, claims no artifact, and reports no cost. In practice routing never reaches it —
 * health says `DISABLED` — but an adapter that would fabricate a success if it were ever called is
 * the kind of thing that survives a refactor, so it refuses at both layers.
 */
function createUnregisteredProviderAdapter(providerId, reason) {
  return {
    providerId,
    family: "unregistered",
    capabilities: defaultProviderCapabilities(providerId),
    execute() {
      return {
        class: "PROVIDER_UNAVAILABLE",
        leaseOutcome: "RELEASED",
        writerLiveness: "STOPPED",
        externalEffectState: "NONE",
        costUsd: 0,
        modelId: `${providerId}-unregistered`,
        // `reason` is carried in the closure for the registry report; the bridge's result contract
        // has no free-text field, and inventing one here would diverge from the shared shape.
      };
    },
    probeHealth() {
      void reason;
      return "DISABLED";
    },
  };
}

/**
 * Build the adapter map and the starting health table for this process.
 *
 * `allowedProviders` comes from the durable Owner authority record, not from a constant here, so
 * narrowing the Owner's envelope narrows what the app will run. Widening it does not invent an
 * executor: a provider the Owner allows but this process cannot run stays unregistered, which is the
 * safe direction of the two.
 */
export function createProviderRegistry(input) {
  const artifactRoot = input.artifactRoot;
  if (typeof artifactRoot !== "string" || artifactRoot.trim() === "") {
    throw new Error("provider registry needs an artifactRoot");
  }
  const startingSha = input.startingSha;
  if (typeof startingSha !== "string" || startingSha.trim() === "") {
    throw new Error("provider registry needs a startingSha");
  }
  const now = input.now ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const allowed = Array.isArray(input.allowedProviders) ? input.allowedProviders : REGISTERED_PROVIDERS_V1;

  // Nothing is created on disk here. Building the registry answers "what could run"; the artifact
  // directory appears when something actually runs, so a read of provider state leaves no trace.
  const adapters = {};
  const health = {};
  const effectJournal = memoryEffectJournal();
  const registered = [];
  const unregistered = {};

  for (const id of PROVIDER_IDS_V1) {
    const runnable = REGISTERED_PROVIDERS_V1.includes(id);
    const permitted = allowed.includes(id);
    if (runnable && permitted) {
      adapters[id] = createRealBoundedExecutorAdapter(id, {
        artifactRoot,
        writeFile: writeFileEnsuringDirectory,
        readFile: readFileUtf8,
        startingSha,
        ...(typeof input.branch === "string" && input.branch !== "" ? { branch: input.branch } : {}),
        /*
         * The artifact writes below now cross the pre-action effect gate.
         *
         * An adapter built without authority gets `closedEffectGate`, which resolves no envelope, so
         * its writes are refused rather than performed. That is deliberate: "the caller forgot to
         * pass authority" must not look like "authority said yes".
         */
        effectGate: input.effectGate ?? closedEffectGate(now),
        actorId: "aion.app.provider-registry",
        authorityEnvelopeId: input.authorityEnvelopeId ?? "",
        parentMilestoneId: input.parentMilestoneId ?? "",
        publishFrozenAuthority: input.registerFrozenJobAuthority,
        journal: effectJournal,
        recordDecision: input.recordEffectDecision ?? (() => undefined),
      });
      health[id] = { ...defaultProviderHealth(id, now), observedAt: now };
      registered.push(id);
      continue;
    }
    const reason = !runnable
      ? UNREGISTERED_PROVIDERS_V1[id] ?? "no executor is registered for this provider"
      : "provider is outside the Owner-authorized provider envelope";
    adapters[id] = createUnregisteredProviderAdapter(id, reason);
    health[id] = {
      ...defaultProviderHealth(id, now),
      state: "DISABLED",
      manuallyDisabled: true,
      observedAt: now,
    };
    unregistered[id] = reason;
  }

  return { adapters, health, artifactRoot, registered: Object.freeze(registered), unregistered: Object.freeze(unregistered) };
}
