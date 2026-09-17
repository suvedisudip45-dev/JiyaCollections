import test from "node:test";
import assert from "node:assert/strict";

const originalEnv = { ...process.env };

const loadCorsConfig = async () => {
  const { getAllowedOrigins, isOriginAllowed } = await import("../config/cors.js");
  return { getAllowedOrigins, isOriginAllowed };
};

test("CORS accepts origins from env and keeps localhost allowed", async () => {
  process.env.CORS_ALLOWED_ORIGINS = "https://shop.example.com, https://admin.example.com";
  process.env.ACCEPTED_URL = "https://accepted.example.com";
  process.env.FRONTEND_URL = "https://frontend.example.com";
  process.env.ADMIN_URL = "https://admin.example.com";
  process.env.MANUFACTURER_URL = "https://manufacturer.example.com";

  const { getAllowedOrigins, isOriginAllowed } = await loadCorsConfig();
  const allowed = getAllowedOrigins();

  assert.ok(allowed.includes("http://localhost:5173"));
  assert.ok(allowed.includes("https://shop.example.com"));
  assert.ok(allowed.includes("https://accepted.example.com"));
  assert.ok(isOriginAllowed("https://shop.example.com"));
  assert.ok(!isOriginAllowed("https://blocked.example.com"));

  Object.assign(process.env, originalEnv);
});
