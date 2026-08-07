import assert from "node:assert/strict";
import test from "node:test";
import { defaultMatchingConfigurationV1, validateJobMatchRequestV1, validateMatchingConfigurationV1 } from "../src/index.js";
import { configuration, matchRequest } from "./helpers.js";

test("default weights are visible exact integers totaling 10000 basis points", () => {
  const config = defaultMatchingConfigurationV1();
  assert.equal(Object.values(config.weights).reduce((sum, value) => sum + value, 0), 10000);
  assert.equal(Object.values(config.weights).every(Number.isSafeInteger), true);
  assert.deepEqual(validateMatchingConfigurationV1(config), config);
});

test("configuration and request contracts are closed, versioned, and reject hidden or fractional weights", () => {
  const config = configuration();
  assert.throws(() => validateMatchingConfigurationV1({ ...config, hiddenWeight: 1 }));
  assert.throws(() => validateMatchingConfigurationV1({ ...config, weights: { ...config.weights, requiredSkills: 2399.5, preferredSkills: 600.5 } }));
  assert.throws(() => validateJobMatchRequestV1({ ...matchRequest(), protectedAttribute: "synthetic" }));
});
