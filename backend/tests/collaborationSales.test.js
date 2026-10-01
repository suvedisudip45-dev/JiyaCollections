import assert from "node:assert/strict";
import test from "node:test";

import {
  accrueCollaborationSalesForOrder,
  applyCollaborationReturnAdjustments,
  calculateCollaborationFeeAmounts,
  createCollaborationSalesForOrder,
} from "../services/collaborationSalesService.js";

const acceptedTerms = {
  status: "ACCEPTED",
  fixedFeePerUnit: "25.00",
  vatTreatment: "VAT_EXCLUSIVE",
};

const collaborationLink = {
  id: "collaboration-1",
  productId: "product-1",
  partnerId: "partner-1",
  activeTermsVersion: 2,
};

test("order collaboration sale snapshots freeze accepted partner terms and remain pending until delivery", async () => {
  let createdRows = [];
  const client = {
    collaborationProduct: { findMany: async () => [collaborationLink] },
    collaborationTermsVersion: { findUnique: async () => acceptedTerms },
    collaborationSale: { createMany: async ({ data, skipDuplicates }) => {
      createdRows = data;
      assert.equal(skipDuplicates, true);
      return { count: data.length };
    } },
  };

  const count = await createCollaborationSalesForOrder({
    order: { id: "order-1", status: "Order Placed", fulfillmentStatus: "PENDING_ASSIGNMENT" },
    items: [{ productId: "product-1", quantity: 2, size: "M", color: "White", purchasedUnitPrice: 1800, originalUnitPrice: 2000 }],
    client,
  });

  assert.equal(count, 1);
  assert.equal(createdRows[0].termsVersion, 2);
  assert.equal(Number(createdRows[0].partnerFeePerUnit), 25);
  assert.equal(createdRows[0].unitSellingPrice.toString(), "1800");
  assert.equal(createdRows[0].unitDiscount.toString(), "200");
  assert.equal(createdRows[0].color, "White");
  assert.equal(createdRows[0].status, "PENDING_DELIVERY");
});

test("directly delivered collaboration orders accrue immediately", async () => {
  let createdRows = [];
  const client = {
    collaborationProduct: { findMany: async () => [collaborationLink] },
    collaborationTermsVersion: { findUnique: async () => ({ ...acceptedTerms, vatTreatment: "EXEMPT" }) },
    collaborationSale: { createMany: async ({ data }) => {
      createdRows = data;
      return { count: data.length };
    } },
  };

  await createCollaborationSalesForOrder({
    order: { id: "order-delivered", status: "Delivered", fulfillmentStatus: "delivered" },
    items: [{ productId: "product-1", quantity: 1, purchasedUnitPrice: 900 }],
    client,
  });

  assert.equal(createdRows[0].status, "ACCRUED");
  assert.ok(createdRows[0].deliveredAt instanceof Date);
  assert.ok(createdRows[0].accruedAt instanceof Date);
});

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
