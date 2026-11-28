import assert from "node:assert/strict";
import test from "node:test";
import { createReadinessHandler, livenessHandler } from "../services/runtimeStatus.js";

const makeResponse = () => ({
  statusCode: 200,
  body: null,
  status(statusCode) {
    this.statusCode = statusCode;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("liveness does not depend on database availability", () => {
  const response = makeResponse();

  livenessHandler({}, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { live: true });
});

test("readiness stays unavailable until startup initialization completes", async () => {
  let queried = false;
  const response = makeResponse();
  const handler = createReadinessHandler({
    database: { $queryRaw: async () => { queried = true; } },
    getStatus: () => ({ initialized: false, stockProjection: "not_started" }),
  });

  await handler({}, response);

  assert.equal(response.statusCode, 503);
  assert.equal(response.body.status, "starting");
  assert.equal(queried, false);
});

test("readiness checks the database and reports stock projection degradation", async () => {
  let query = "";
  const response = makeResponse();
  const handler = createReadinessHandler({
    database: {
      $queryRaw: async (strings) => {
        query = strings.join("");
      },
    },
    getStatus: () => ({ initialized: true, stockProjection: "failed" }),
  });

  await handler({}, response);

  assert.equal(query, "SELECT 1");
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    ready: true,
    status: "degraded",
    dependencies: { database: "ok" },
    stockProjection: "failed",
  });
});

test("readiness fails and logs safely when the database check fails", async () => {
  const warnings = [];
  const response = makeResponse();
  const handler = createReadinessHandler({
    database: { $queryRaw: async () => { throw Object.assign(new Error("details"), { code: "DB_DOWN" }); } },
    getStatus: () => ({ initialized: true, stockProjection: "ready" }),
    log: { warn: (...args) => warnings.push(args) },
  });

  await handler({}, response);

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, {
    ready: false,
    status: "not_ready",
    dependencies: { database: "unavailable" },
    stockProjection: "ready",
  });
  assert.equal(warnings[0][1].errorCode, "DB_DOWN");
  assert.equal(JSON.stringify(warnings).includes("details"), false);
});
