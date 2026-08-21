/**
 * The four routes Discovery Campaign 02 measured reaching the public internet.
 *
 * `POST /api/action` with `vin.decode`, `vehicle.recalls`, `inventory.refresh` or `vin.ocr` reached
 * NHTSA vPIC, the NHTSA recall API, a dealer site, and a vision endpoint named by an environment
 * variable — the last one carrying the submitted photo. None consulted any boundary, because each
 * connector held an injectable transport that defaulted to the global `fetch`.
 *
 * Every test here judges the **transport**, not a returned string. The whole finding was that the
 * returned values looked fine: a checker reading them would have agreed with the code. So the
 * network is instrumented at two levels and the assertion is about what was observed:
 *
 *   - `globalThis.fetch` records and refuses non-loopback before any name is resolved;
 *   - `net.Socket.prototype.connect` refuses non-loopback before DNS, which covers everything that
 *     does not go through `fetch`.
 *
 * Nothing in this file reaches the network, and a test that failed to prove that would fail.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  DeterministicClockV1, DeterministicIdGeneratorV1, DeterministicModelProviderV1,
  InMemoryWriterAuthorityV1, LocalEchoCapabilityV1, SelectableDeveloperAgentRegistryV1,
  StaticCapabilityRegistryV1, SyntheticDeveloperAgentBridgeV1, SyntheticVerificationRunnerV1,
  createWriterGrantForTest,
} from "../../packages/local-assistant/dist/index.js";
import {
  OUTWARD_ROUTE_IDS_V1, REFUSING_OUTWARD_TRANSPORT_V1, classifyEndpointV1,
  extractImageWithLocalVision, decodeVinNhtsa, imageUnderstandingStatus, isLoopbackUrlV1,
  lookupRecallsNhtsa,
} from "../../packages/local-assistant/dist/index.js";
import {
  OUTWARD_ROUTES_V1, clearOutwardRoute, isLoopbackUrl, registerOutwardRoute,
} from "../../apps/aion/outward-effect-guard.mjs";
import { createAionServer } from "../../apps/aion/server.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..", "..");

/* -------------------------------------------------------------------------- */
/* Instrumentation                                                             */
/* -------------------------------------------------------------------------- */

const realFetch = globalThis.fetch;
const realConnect = net.Socket.prototype.connect;

function loopbackHost(host) {
  const h = String(host ?? "").toLowerCase().replace(/^\[|\]$/gu, "");
  return h === "" || h === "127.0.0.1" || h === "localhost" || h === "::1" || h.startsWith("127.");
}

/**
 * Run `body` with the network shut and every attempt recorded.
 *
 * Loopback is forwarded because the test drives a real server over it. Anything else is refused
 * before a name is resolved, so a regression here is observed rather than sent.
 */
async function withNetworkObserved(body) {
  const seen = { fetches: [], sockets: [] };
  globalThis.fetch = (input, init) => {
    const url = String(input && typeof input === "object" && "url" in input ? input.url : input);
    const loopback = isLoopbackUrl(url);
    seen.fetches.push({ url, loopback });
    if (loopback) return realFetch.call(globalThis, input, init);
    return Promise.reject(new Error(`test refused a non-loopback request: ${url}`));
  };
  net.Socket.prototype.connect = function observedConnect(...args) {
    const options = typeof args[0] === "object" && args[0] !== null ? args[0] : { port: args[0], host: args[1] };
    const host = options.host ?? options.path ?? "127.0.0.1";
    const loopback = options.path !== undefined || loopbackHost(host);
    seen.sockets.push({ host: String(host), loopback });
    if (!loopback) throw new Error(`test refused a non-loopback socket: ${String(host)}`);
    return realConnect.apply(this, args);
  };
  try {
    return { result: await body(seen), seen };
  } finally {
    globalThis.fetch = realFetch;
    net.Socket.prototype.connect = realConnect;
  }
}

const offMachine = (seen) => [
  ...seen.fetches.filter((f) => !f.loopback).map((f) => f.url),
  ...seen.sockets.filter((s) => !s.loopback).map((s) => `socket ${s.host}`),
];

/** One isolated Command Center over synthetic temporary state, with no outward port beyond the app's. */
async function withServer(run) {
  const root = await mkdtemp(join(tmpdir(), "aion-outward-routes-"));
  const app = await createAionServer({
    repositoryRoot,
    dataRoot: join(root, "private", "aion"),
    exportRoot: join(root, "private", "aion", "exports"),
    clock: new DeterministicClockV1(),
    ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
    verificationRunner: new SyntheticVerificationRunnerV1({}),
    authority: new InMemoryWriterAuthorityV1(createWriterGrantForTest({ state: "WRITER" })),
  });
  const address = await app.listen(0);
  const base = `http://127.0.0.1:${address.port}`;
  const post = async (body) => {
    const response = await realFetch(`${base}/api/action`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  try { return await run({ post, base }); }
  finally { await app.close(); await rm(root, { recursive: true, force: true }); }
}

/* -------------------------------------------------------------------------- */
/* The three public-web routes                                                 */
/* -------------------------------------------------------------------------- */

test("vin.decode makes no outward attempt while no capability is granted", async () => {
  const { seen } = await withNetworkObserved(() => withServer(async ({ post }) => {
    // Campaign 02's smallest counterexample: one JSON field reached vpic.nhtsa.dot.gov.
    const response = await post({ type: "vin.decode", vin: "1HGCM82633A004352" });
    assert.equal(response.status, 200, "the action must still answer rather than crash");
    return response;
  }));
  assert.deepEqual(offMachine(seen), [], "vin.decode reached off this machine");
});

test("vehicle.recalls makes no outward attempt while no capability is granted", async () => {
  const { seen } = await withNetworkObserved(() => withServer(async ({ post }) => {
    const response = await post({ type: "vehicle.recalls", make: "Toyota", model: "Camry", year: 2020 });
    assert.equal(response.status, 200);
    return response;
  }));
  assert.deepEqual(offMachine(seen), [], "vehicle.recalls reached off this machine");
});

test("inventory.refresh crawls nothing while no capability is granted", async () => {
  const { result, seen } = await withNetworkObserved(() => withServer(async ({ post }) => {
    // This one took no argument at all: the dealership context is created on demand.
    const response = await post({ type: "inventory.refresh", scope: "new", maxPagesPerUrl: 1, pageDelayMs: 0 });
    assert.equal(response.status, 200);
    return response;
  }));
  assert.deepEqual(offMachine(seen), [], "inventory.refresh crawled off this machine");
  const message = String(result?.body?.result?.message ?? "");
  assert.match(message, /not authorized to leave this machine/u,
    `the refusal must say so rather than blaming the dealer site: ${message}`);
});

test("the refusal names the boundary rather than reporting the service as down", async () => {
  /*
   * A refusal and an unreachable third party both stop the call, and they mean opposite things.
   * An Owner told "NHTSA is unreachable" when nothing was ever sent has been told something false.
   */
  const result = await lookupRecallsNhtsa({ make: "Toyota", model: "Camry", year: 2020, now: "2026-08-21T00:00:00.000Z" });
  assert.equal(result.mode, "error");
  assert.match(result.message, /not authorized to leave this machine/u);
  assert.match(result.message, /outward effect refused: vehicle\.recalls/u);
  assert.deepEqual(result.recalls, []);
});

test("a connector handed no transport refuses without resolving a name", async () => {
  const { seen } = await withNetworkObserved(async () => {
    /*
     * The connector raises; `service.decodeVinAction` is what turns that into a decode carrying
     * `errorText`, which the server-driven test above already covers. Asserting the raise here
     * keeps the two layers distinct rather than assuming one does the other's job.
     */
    await assert.rejects(
      () => decodeVinNhtsa("1HGCM82633A004352", "2026-08-21T00:00:00.000Z"),
      /outward effect refused: vehicle\.vinDecode/u,
    );
    // The explicit refusing port must behave identically to omitting the argument.
    await assert.rejects(
      () => decodeVinNhtsa("1HGCM82633A004352", "2026-08-21T00:00:00.000Z", REFUSING_OUTWARD_TRANSPORT_V1),
      /outward effect refused: vehicle\.vinDecode/u,
    );
  });
  assert.deepEqual(offMachine(seen), []);
  assert.deepEqual(seen.fetches, [], "a refused route reached the transport at all");
});

/* -------------------------------------------------------------------------- */
/* Local vision is local; remote vision is a capability                        */
/* -------------------------------------------------------------------------- */

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("a loopback vision endpoint still reaches the local model", async () => {
  /*
   * The repair must not close the local path. This is the case the feature exists for: a model
   * running on this machine, reached without asking anyone's permission to talk to ourselves.
   */
  let reached = null;
  const result = await extractImageWithLocalVision({
    filename: "local.png", mimeType: "image/png", byteLength: ONE_PIXEL_PNG.byteLength, bytes: ONE_PIXEL_PNG,
    env: { AION_OLLAMA_BASE_URL: "http://127.0.0.1:11434", AION_VISION_MODEL: "moondream" },
    loopback: {
      async request(url) {
        reached = String(url);
        return { ok: true, json: async () => ({ response: "a white pixel" }) };
      },
    },
  });
  assert.equal(reached, "http://127.0.0.1:11434/api/generate", "the local vision call must still happen");
  assert.equal(result.code, "READY");
  assert.equal(result.extractedText, "a white pixel");
});

test("a non-loopback vision endpoint transmits no image without the capability", async () => {
  /*
   * Two environment variables were enough to make the Command Center base64 the Owner's photo and
   * POST it to a named host, through a function called `extractImageWithLocalVision`. The word
   * "local" was in the name and nowhere in the code.
   */
  const env = { AION_OLLAMA_BASE_URL: "https://vision.example.invalid:11434", AION_VISION_MODEL: "moondream" };
  const { seen } = await withNetworkObserved(async () => {
    let transportTouched = false;
    const result = await extractImageWithLocalVision({
      filename: "private.png", mimeType: "image/png", byteLength: ONE_PIXEL_PNG.byteLength, bytes: ONE_PIXEL_PNG,
      env,
      loopback: { async request() { transportTouched = true; throw new Error("must not be reached"); } },
    });
    assert.equal(transportTouched, false, "the loopback transport was used for a remote endpoint");
    assert.equal(result.code, "VISION_REMOTE_NOT_AUTHORIZED");
    assert.equal(result.extractedText, "", "no OCR may be invented when nothing was sent");
    assert.match(result.description, /not this machine/u);
  });
  assert.deepEqual(offMachine(seen), [], "the image left this machine");
  assert.deepEqual(seen.fetches, [], "a remote vision endpoint reached the transport");
});

test("a remote endpoint with a transport uses the declared route, and that route is disabled", async () => {
  /*
   * Remote inference is not forbidden, it is a capability. This proves the path exists and names
   * the right route — and that the route is off, so supplying a transport is not a way around the
   * boundary, only a way to reach it.
   */
  const asked = [];
  const result = await extractImageWithLocalVision({
    filename: "private.png", mimeType: "image/png", byteLength: ONE_PIXEL_PNG.byteLength, bytes: ONE_PIXEL_PNG,
    env: { AION_OLLAMA_BASE_URL: "https://vision.example.invalid:11434", AION_VISION_MODEL: "moondream" },
    outward: {
      request(routeId, url) {
        asked.push({ routeId, url });
        throw new Error(`outward effect refused: ${routeId} — not wired to the pre-action effect gate`);
      },
    },
  });
  assert.deepEqual(asked.map((a) => a.routeId), ["vision.remoteInference"]);
  assert.equal(result.code, "VISION_REMOTE_NOT_AUTHORIZED");
  assert.equal(result.extractedText, "");
});

test("the status report says which machine the configured endpoint is", () => {
  const local = imageUnderstandingStatus({ AION_OLLAMA_BASE_URL: "http://127.0.0.1:11434", AION_VISION_MODEL: "moondream" });
  assert.equal(local.code, "READY");
  assert.equal(local.endpointClass, "LOOPBACK");

  // Reporting a third-party endpoint as READY was the defect in miniature: configuration
  // readiness presented as a statement about permission.
  const remote = imageUnderstandingStatus({ AION_OLLAMA_BASE_URL: "https://vision.example.invalid", AION_VISION_MODEL: "moondream" });
  assert.equal(remote.code, "VISION_REMOTE_NOT_AUTHORIZED");
  assert.equal(remote.endpointClass, "REMOTE");
  assert.match(remote.message, /not on this machine/u);

  const unset = imageUnderstandingStatus({});
  assert.equal(unset.code, "IMAGE_EXTRACTION_PROVIDER_REQUIRED");
  assert.equal(unset.endpointClass, "UNUSABLE");
});

/* -------------------------------------------------------------------------- */
/* The boundary the connectors depend on                                       */
/* -------------------------------------------------------------------------- */

test("every route the package can name is declared by the application boundary", () => {
  for (const routeId of OUTWARD_ROUTE_IDS_V1) {
    assert.ok(Object.prototype.hasOwnProperty.call(OUTWARD_ROUTES_V1, routeId),
      `${routeId} can be requested but the boundary has never heard of it`);
  }
});

test("the two loopback implementations agree, so the duplicate cannot drift", () => {
  /*
   * `outward-transport.ts` carries its own copy rather than importing the guard, because making the
   * application's security boundary depend on a package's build output would let a stale `dist/`
   * change how the boundary behaves. The cost of a duplicate is drift, so this is the check that
   * makes drift a failure instead of a surprise.
   */
  const table = [
    "http://127.0.0.1:11434/api/chat", "http://localhost:1234/v1/models", "http://[::1]:8080/x",
    "https://api.example.com/v1/chat", "https://127.0.0.1.evil.example/x", "http://127.0.0.2:80/x",
    "not a url", "", "file:///etc/passwd", "ws://localhost:9000/socket",
  ];
  for (const candidate of table) {
    assert.equal(isLoopbackUrlV1(candidate), isLoopbackUrl(candidate), `disagreement on ${candidate}`);
  }
  assert.equal(classifyEndpointV1("http://127.0.0.1:11434"), "LOOPBACK");
  assert.equal(classifyEndpointV1("https://vision.example.invalid"), "REMOTE");
  assert.equal(classifyEndpointV1("ws://localhost:9000"), "UNUSABLE", "a non-HTTP scheme is not a vision endpoint");
  assert.equal(classifyEndpointV1(null), "UNUSABLE");
});

test("a granted capability would let the route work, and revoking it closes the route again", async () => {
  /*
   * The repair must leave the feature recoverable rather than deleted. With the route wired to an
   * authorizer that allows, the same connector reaches the transport it was always meant to use;
   * with the wiring cleared it refuses again. Neither half is worth much without the other.
   */
  const { seen } = await withNetworkObserved(async () => {
    let served = null;
    globalThis.fetch = async (url) => {
      served = String(url);
      return { ok: true, json: async () => ({ Results: [] }) };
    };
    try {
      registerOutwardRoute("vehicle.vinDecode", () => ({ allowed: true, reason: "test grant" }));
      const { outwardFetch } = await import("../../apps/aion/outward-effect-guard.mjs");
      const granted = { request: (routeId, url, init) => outwardFetch(routeId, url, init) };
      await decodeVinNhtsa("1HGCM82633A004352", "2026-08-21T00:00:00.000Z", granted);
      assert.match(String(served), /vpic\.nhtsa\.dot\.gov/u, "a granted route must reach its service");

      served = null;
      clearOutwardRoute("vehicle.vinDecode");
      await assert.rejects(
        () => decodeVinNhtsa("1HGCM82633A004352", "2026-08-21T00:00:00.000Z", granted),
        /outward effect refused/u,
        "clearing the wiring must close the route again",
      );
      assert.equal(served, null, "a cleared route still reached the transport");
    } finally {
      clearOutwardRoute("vehicle.vinDecode");
    }
  });
  // The stub above replaced the observer, so this asserts the observer saw no real attempt.
  assert.deepEqual(seen.sockets.filter((s) => !s.loopback), [], "a socket left this machine");
});
