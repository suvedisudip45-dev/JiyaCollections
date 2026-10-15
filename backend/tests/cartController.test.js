import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../config/db.js";
import { getUserCart } from "../controllers/cartController.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

test("getUserCart removes products that are no longer available in the storefront", async (t) => {
  const storedCart = {
    "active-product": { "S-Black": 1 },
    "removed-product": { "M-White": 2 },
  };
  let persistedCart;
  stubMethod(t, prisma.user, "findUnique", async () => ({ id: "customer-1", cartData: storedCart }));
  stubMethod(t, prisma.product, "findMany", async ({ where, select }) => {
    assert.deepEqual(where.id.in, ["active-product", "removed-product"]);
    assert.equal(where.published, true);
    assert.equal(where.deletedAt, null);
    assert.deepEqual(select, { id: true });
    return [{ id: "active-product" }];
  });
  stubMethod(t, prisma.user, "update", async ({ data }) => {
    persistedCart = data.cartData;
    return {};
  });

  let response;
  await getUserCart({ body: { userId: "customer-1" } }, {
    json: (body) => { response = body; },
  });

  assert.deepEqual(response, {
    success: true,
    cartData: { "active-product": { "S-Black": 1 } },
  });
  assert.deepEqual(persistedCart, response.cartData);
});
