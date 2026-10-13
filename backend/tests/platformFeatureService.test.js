import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PLATFORM_FEATURES, getPlatformFeatures, updatePlatformFeatures } from "../services/platformFeatureService.js";

test("platform features use enabled defaults when no config row exists", async () => {
  const client = {
    platformFeatureConfig: {
      findUnique: async () => null,
    },
  };

  assert.deepEqual(await getPlatformFeatures(client), DEFAULT_PLATFORM_FEATURES);
});

test("platform feature updates persist valid boolean settings only", async () => {
  let saved;
  const client = {
    platformFeatureConfig: {
      upsert: async (input) => {
        saved = input;
        return { ...DEFAULT_PLATFORM_FEATURES, ...input.create, ...input.update };
      },
    },
  };

  const result = await updatePlatformFeatures({
    loyaltyEnabled: false,
    lettersEnabled: true,
    ignored: false,
  }, client);

  assert.equal(result.loyaltyEnabled, false);
  assert.equal(result.lettersEnabled, true);
  assert.deepEqual(saved.update, { loyaltyEnabled: false, lettersEnabled: true });
});

test("platform feature updates reject requests without boolean settings", async () => {
  await assert.rejects(
    updatePlatformFeatures({ loyaltyEnabled: "false" }, { platformFeatureConfig: {} }),
    { code: "NO_VALID_FEATURE_SETTINGS", status: 400 }
  );
});
