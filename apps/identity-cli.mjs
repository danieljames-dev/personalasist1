#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import {
  exportLocalIdentityStateV1,
  FileIdentityStateRepository,
  identityStatusV1,
  initializeLocalIdentityV1,
  RandomUuidIdentityIdGenerator,
  SystemIdentityClock,
  validateLocalIdentityStateV1,
} from "../packages/identity/dist/index.js";
import { authorizeLocalPath, recheckAuthorizedPath } from "../packages/privacy-boundary/dist/index.js";

const HELP = `AION local Identity v1

Usage:
  identity-cli.mjs initialize --root <absolute-private-identity-root>
  identity-cli.mjs status     --root <absolute-private-identity-root>
  identity-cli.mjs export     --root <absolute-private-identity-root> --output-root <absolute-approved-private-export-root> --output <absolute-output-file>

Operations are explicit, local-only, and never print complete identifiers.`;

function parseArguments(argv) {
  const [command, ...tokens] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") return { command: "help", values: new Map() };
  if (!new Set(["initialize", "status", "export"]).has(command)) throw new Error("Unsupported Identity operation.");
  const values = new Map();
  for (let index = 0; index < tokens.length; index += 2) {
    const key = tokens[index];
    const value = tokens[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--") || values.has(key)) {
      throw new Error("Identity arguments are malformed.");
    }
    values.set(key, value);
  }
  const allowed = command === "export" ? new Set(["--root", "--output-root", "--output"]) : new Set(["--root"]);
  for (const key of values.keys()) if (!allowed.has(key)) throw new Error("Unsupported Identity argument.");
  for (const required of allowed) if (!values.has(required)) throw new Error("A required explicit Identity path argument is missing.");
  return { command, values };
}

function pathBoundary() {
  const apply = (request, recheck) => {
    const privacyRequest = {
      version: "1",
      operation: request.operation,
      approvedRoot: {
        version: "1",
        reference: request.approvedRootReference,
        absolutePath: request.approvedRootAbsolutePath,
      },
      requestedPath: { version: "1", absolutePath: request.requestedAbsolutePath },
    };
    const result = recheck ? recheckAuthorizedPath(privacyRequest) : authorizeLocalPath(privacyRequest);
    return result.authorized
      ? { authorized: true, resolvedPath: result.resolvedPath }
      : { authorized: false, reason: result.error.reason };
  };
  return {
    authorize: (request) => apply(request, false),
    recheck: (request) => apply(request, true),
  };
}

export async function runIdentityCli(argv, io = console) {
  let parsed;
  try { parsed = parseArguments(argv); } catch (error) {
    io.error(error instanceof Error ? error.message : "Identity arguments are invalid.");
    return 2;
  }
  if (parsed.command === "help") {
    io.log(HELP);
    return 0;
  }

  const root = parsed.values.get("--root");
  const repository = new FileIdentityStateRepository({
    approvedRootAbsolutePath: root,
    approvedRootReference: "private-identity",
    pathBoundary: pathBoundary(),
  });
  try {
    if (parsed.command === "initialize") {
      const result = await initializeLocalIdentityV1(repository, new RandomUuidIdentityIdGenerator(), new SystemIdentityClock());
      io.log(result.outcome === "initialized" ? "Identity initialized." : "Identity already initialized; existing references preserved.");
      return 0;
    }
    if (parsed.command === "status") {
      io.log(JSON.stringify(identityStatusV1(await repository.load()), null, 2));
      return 0;
    }
    const state = validateLocalIdentityStateV1(await repository.load());
    await exportLocalIdentityStateV1({
      state,
      approvedRootAbsolutePath: parsed.values.get("--output-root"),
      approvedRootReference: "private-identity-export",
      destinationAbsolutePath: parsed.values.get("--output"),
      pathBoundary: pathBoundary(),
    });
    io.log("Identity export completed.");
    return 0;
  } catch (error) {
    io.error(error && typeof error === "object" && "code" in error ? `Identity operation failed closed: ${error.code}.` : "Identity operation failed closed.");
    return 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) process.exitCode = await runIdentityCli(process.argv.slice(2));
