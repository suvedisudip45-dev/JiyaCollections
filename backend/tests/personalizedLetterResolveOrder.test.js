import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../config/db.js";
import { resolveOrderReference } from "../services/personalizedLetterService.js";

test("resolveOrderReference accepts an actual order id and returns the matching order", async () => {
  const originalFindUnique = prisma.order.findUnique;
  prisma.order.findUnique = async ({ where }) => {
    if (where.id === "order-123") {
      return {
        id: "order-123",
        userId: "customer-456",
        manufacturerId: "manufacturer-123",
        status: "PROCESSING",
        amount: 1250,
      };
    }
    return null;
  };
  prisma.orderAssignment.findUnique = async () => null;

  try {
    const result = await resolveOrderReference("order-123", "manufacturer-123");
    assert.equal(result.orderId, "order-123");
    assert.equal(result.order.manufacturerId, "manufacturer-123");
  } finally {
    prisma.order.findUnique = originalFindUnique;
    prisma.orderAssignment.findUnique = async () => null;
  }
});

test("resolveOrderReference falls back to the assignment record when the caller provides an assignment id", async () => {
  const originalOrderFindUnique = prisma.order.findUnique;
  const originalAssignmentFindUnique = prisma.orderAssignment.findUnique;

  prisma.order.findUnique = async ({ where }) => {
    if (where.id === "order-456") {
      return {
        id: "order-456",
        userId: "customer-789",
        manufacturerId: "manufacturer-321",
        status: "PROCESSING",
        amount: 750,
      };
    }
    return null;
  };
  prisma.orderAssignment.findUnique = async ({ where }) => {
    if (where.id === "assignment-999") {
      return {
        id: "assignment-999",
        orderId: "order-456",
        manufacturerId: "manufacturer-321",
        status: "ASSIGNED",
      };
    }
    return null;
  };

  try {
    const result = await resolveOrderReference("assignment-999", "manufacturer-321");
    assert.equal(result.orderId, "order-456");
    assert.equal(result.assignment.id, "assignment-999");
  } finally {
    prisma.order.findUnique = originalOrderFindUnique;
    prisma.orderAssignment.findUnique = originalAssignmentFindUnique;
  }
});
