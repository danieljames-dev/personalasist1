/**
 * Installed elevated broker service entry (Node) — R6.5.2.
 * Private trust material only; Owner approval via elevated helper inbox.
 */

import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createActivatedRuntime, BROKER_SERVICE_NAME } from "./installed-runtime.js";

const MACHINE_ROLE = process.env.AION_MACHINE_ROLE ?? "DESKTOP TARGET CANDIDATE / NON-PRIMARY";
const REPO_ROOT = process.env.AION_REPOSITORY_ROOT ?? "C:\\AION-HQ";
const UI_PORT = Number(process.env.AION_OWNER_UI_PORT ?? "17865");
const STATE_LOG =
  process.env.AION_BROKER_LOG ??
  "C:\\ProgramData\\AION\\ElevatedOperatorBroker\\public\\audit\\service.log";

function log(line: string): void {
  try {
    mkdirSync(join(STATE_LOG, ".."), { recursive: true });
    appendFileSync(STATE_LOG, `${new Date().toISOString()} ${line}\n`, "utf8");
  } catch {
    /* never throw from logger */
  }
}

async function main(): Promise<void> {
  log(`service-main start name=${BROKER_SERVICE_NAME} pid=${process.pid}`);
  const runtime = createActivatedRuntime({
    repositoryRoot: REPO_ROOT,
    machineRole: MACHINE_ROLE,
    uiPort: UI_PORT,
  });

  runtime.broker.verifyIntegrity();
  log("integrity ok");

  const pipeInfo = await runtime.pipe.listen();
  log(`pipe listening ${pipeInfo.pipePath}`);

  const uiInfo = await runtime.ui.listenLoopbackOnly();
  log(`owner-ui ${uiInfo.baseUrl}`);

  // Poll elevated Owner approval inbox
  const inboxTimer = setInterval(() => {
    try {
      const n = runtime.processApprovalInbox();
      if (n > 0) log(`owner-approval-inbox processed=${n}`);
    } catch (e) {
      log(`inbox error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, 400);

  try {
    writeFileSync(
      join(runtime.paths.publicRoot, "runtime-ready.v1.json"),
      `${JSON.stringify(
        {
          ok: true,
          service: BROKER_SERVICE_NAME,
          pipe: pipeInfo.pipePath,
          ownerUi: uiInfo.baseUrl,
          activationMode: runtime.host.activationMode,
          installed: true,
          activated: true,
          trustBoundary: "r652-private-owner-helper",
          founderFallbackAvailable: true,
          serviceAccountExpected: "NT SERVICE\\AionElevatedBroker",
          pid: process.pid,
          utc: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  } catch (e) {
    log(`ready-marker failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const shutdown = async (signal: string) => {
    log(`shutdown ${signal}`);
    clearInterval(inboxTimer);
    try {
      await runtime.ui.close();
    } catch {
      /* ignore */
    }
    try {
      await runtime.pipe.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await new Promise(() => {
    /* run until signal */
  });
}

main().catch((error) => {
  log(`fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
