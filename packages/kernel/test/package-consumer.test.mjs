import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AionKernelV1,
  KERNEL_API_VERSION_V1,
} from "@aion/kernel/kernel/v1";

test("published versioned export is consumable", async () => {
  assert.equal(KERNEL_API_VERSION_V1, "1.0");
  const kernel = new AionKernelV1();
  await kernel.start();
  assert.equal(kernel.snapshot().state, "running");
  await kernel.stop();
});

