import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import distributorRouter from "../routes/distributorRoute.js";
import adminDistributorRateRouter, { adminDistributorFinanceRouter } from "../routes/adminDistributorRateRoute.js";

test("Distributor and Admin route routers are properly constructed", () => {
  assert.ok(distributorRouter);
  assert.ok(adminDistributorRateRouter);
  assert.ok(adminDistributorFinanceRouter);

  // Check stack route paths
  const distRoutes = distributorRouter.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods),
    }));

  assert.ok(distRoutes.some((r) => r.path === "/orders/assigned" && r.methods.includes("get")));
  assert.ok(distRoutes.some((r) => r.path === "/orders/:id/status" && r.methods.includes("patch")));
  assert.ok(distRoutes.some((r) => r.path === "/orders/:id/return" && r.methods.includes("post")));
  assert.ok(distRoutes.some((r) => r.path === "/finance/statement" && r.methods.includes("get")));
  assert.ok(distRoutes.some((r) => r.path === "/finance/ask-settlement" && r.methods.includes("post")));
  assert.ok(distRoutes.some((r) => r.path === "/rates" && r.methods.includes("get")));

  const adminRateRoutes = adminDistributorRateRouter.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods),
    }));

  assert.ok(adminRateRoutes.some((r) => r.path === "/" && r.methods.includes("post")));
  assert.ok(adminRateRoutes.some((r) => r.path === "/" && r.methods.includes("get")));

  const adminFinanceRoutes = adminDistributorFinanceRouter.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods),
    }));

  assert.ok(adminFinanceRoutes.some((r) => r.path === "/settle" && r.methods.includes("patch")));
  assert.ok(adminFinanceRoutes.some((r) => r.path === "/settle/:id" && r.methods.includes("patch")));
  assert.ok(adminFinanceRoutes.some((r) => r.path === "/settlements" && r.methods.includes("get")));
});
