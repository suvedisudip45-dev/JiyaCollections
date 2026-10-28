import assert from "node:assert/strict";
import test from "node:test";

import {
  accrueCollaborationSalesForOrder,
  applyCollaborationReturnAdjustments,
  calculateCollaborationFeeAmounts,
} from "../services/collaborationSalesService.js";

test("delivery accrual only updates pending sale rows", async () => {
  let update;
  const count = await accrueCollaborationSalesForOrder({
    orderId: "order-1",
    deliveredAt: new Date("2026-09-10T00:00:00.000Z"),
    client: { collaborationSale: { updateMany: async (value) => { update = value; return { count: 1 }; } } },
  });

  assert.equal(count, 1);
  assert.deepEqual(update.where, { orderId: "order-1", status: "PENDING_DELIVERY" });
  assert.equal(update.data.status, "ACCRUED");
});

test("partial and full returns update retained sale quantities without exceeding sold units", async () => {
  const sale = {
    id: "sale-1",
    productId: "product-1",
    size: "M",
    color: "White",
    quantity: 3,
    quantityReturned: 0,
    status: "ACCRUED",
  };
  const client = {
    collaborationSale: {
      findMany: async () => [sale],
      update: async ({ data }) => {
        Object.assign(sale, data);
        return { ...sale };
      },
    },
  };

  const partial = await applyCollaborationReturnAdjustments({
    orderId: "order-1",
    items: [{ productId: "product-1", size: "M", color: "White", quantity: 1 }],
    client,
  });
  assert.equal(partial[0].sale.quantityReturned, 1);
  assert.equal(partial[0].sale.status, "PARTIALLY_REVERSED");

  const full = await applyCollaborationReturnAdjustments({
    orderId: "order-1",
    items: [{ productId: "product-1", size: "M", color: "White", quantity: 2 }],
    client,
  });
  assert.equal(full[0].sale.quantityReturned, 3);
  assert.equal(full[0].sale.status, "REVERSED");

  await assert.rejects(
    applyCollaborationReturnAdjustments({
      orderId: "order-1",
      items: [{ productId: "product-1", size: "M", color: "White", quantity: 1 }],
      client,
    }),
    /exceeds sold collaboration quantity/
  );
});

test("collaboration fee invoices apply VAT-exclusive, VAT-inclusive, or exempt terms", () => {
  const exclusive = calculateCollaborationFeeAmounts(100, 2, "VAT_EXCLUSIVE", 13);
  assert.equal(exclusive.netAmount.toString(), "200");
  assert.equal(exclusive.vatAmount.toString(), "26");
  assert.equal(exclusive.totalAmount.toString(), "226");

  const inclusive = calculateCollaborationFeeAmounts(113, 1, "VAT_INCLUSIVE", 13);
  assert.equal(inclusive.netAmount.toString(), "100");
  assert.equal(inclusive.vatAmount.toString(), "13");
  assert.equal(inclusive.totalAmount.toString(), "113");

  const exempt = calculateCollaborationFeeAmounts(100, 1, "EXEMPT", 13);
  assert.equal(exempt.netAmount.toString(), "100");
  assert.equal(exempt.vatAmount.toString(), "0");
  assert.equal(exempt.totalAmount.toString(), "100");
});
