import test from "node:test";
import assert from "node:assert/strict";
import {
  invalidatePrismaQueryCache,
  prismaQueryCacheMiddleware,
} from "../utils/prismaQueryCache.js";

const makeParams = (overrides = {}) => ({
  model: "Product",
  action: "findMany",
  args: { where: { isActive: true } },
  ...overrides,
});

test("caches eligible reads and returns isolated result copies", async () => {
  invalidatePrismaQueryCache();
  let calls = 0;
  const next = async () => [{ id: "product-1", nested: { value: 1 } }];

  const first = await prismaQueryCacheMiddleware(makeParams(), async () => {
    calls += 1;
    return next();
  });
  first[0].nested.value = 99;
  const second = await prismaQueryCacheMiddleware(makeParams(), async () => {
    calls += 1;
    return next();
  });

  assert.equal(calls, 1);
  assert.equal(second[0].nested.value, 1);
});

test("does not cache order or authentication model reads", async () => {
  invalidatePrismaQueryCache();
  let calls = 0;
  const next = async () => {
    calls += 1;
    return [];
  };

  await prismaQueryCacheMiddleware(makeParams({ model: "Order" }), next);
  await prismaQueryCacheMiddleware(makeParams({ model: "Order" }), next);
  await prismaQueryCacheMiddleware(makeParams({ model: "User" }), next);
  await prismaQueryCacheMiddleware(makeParams({ model: "User" }), next);

  assert.equal(calls, 4);
});

test("bypasses transaction reads and invalidates after writes", async () => {
  invalidatePrismaQueryCache();
  let calls = 0;
  const next = async () => {
    calls += 1;
    return [{ id: "product-1" }];
  };

  await prismaQueryCacheMiddleware(makeParams(), next);
  await prismaQueryCacheMiddleware(makeParams({ runInTransaction: true }), next);
  await prismaQueryCacheMiddleware(makeParams({ action: "update" }), next);
  await prismaQueryCacheMiddleware(makeParams(), next);

  assert.equal(calls, 4);
});

test("distinguishes date-valued query arguments", async () => {
  invalidatePrismaQueryCache();
  let calls = 0;
  const next = async () => {
    calls += 1;
    return [];
  };

  await prismaQueryCacheMiddleware(
    makeParams({ args: { where: { createdAt: { gte: new Date("2026-01-01T00:00:00Z") } } } }),
    next,
  );
  await prismaQueryCacheMiddleware(
    makeParams({ args: { where: { createdAt: { gte: new Date("2026-01-02T00:00:00Z") } } } }),
    next,
  );

  assert.equal(calls, 2);
});
