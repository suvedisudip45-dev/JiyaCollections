import { prisma } from "../config/db.js";
import { postCustomerPaymentAccounting } from "./accountingPostingEngine.js";
import { accountingDecimal } from "./accountingDecimal.js";
import { pricingSnapshotAmounts } from "./checkoutPricingService.js";
import { formatCollectionAmount } from "./distributorDeliveryOtpService.js";

const accountingFailure = (message, code) => Object.assign(new Error(message), { code });

export const postOrderCustomerPaymentAccounting = async (
  order,
  { client = prisma, postAccounting = postCustomerPaymentAccounting } = {},
) => {
  if (!order?.id) {
    throw accountingFailure("Order ID is required to post a customer payment.", "CUSTOMER_PAYMENT_ORDER_REQUIRED");
  }
  const amount = accountingDecimal(
    pricingSnapshotAmounts(order).finalPayableTotal,
    "Order amount",
  );
  if (amount.isNegative()) {
    throw accountingFailure("Order amount must be a non-negative finite value.", "CUSTOMER_PAYMENT_AMOUNT_INVALID");
  }
  if (amount.isZero()) return null;

  const existing = await client.journalEntry.findFirst({
    where: {
      sourceType: "CUSTOMER_PAYMENT",
      sourceId: String(order.id),
      status: { in: ["POSTED", "REVERSED"] },
    },
    select: { id: true, status: true },
  });
  if (existing?.status === "POSTED") return existing;
  if (existing?.status === "REVERSED") {
    throw accountingFailure(
      "This order already has a reversed customer-payment journal; reconcile the correction before recording another receipt.",
      "CUSTOMER_PAYMENT_JOURNAL_REVERSED",
    );
  }

  return postAccounting({
    ...order,
    amount: amount.toString(),
    client,
    idempotencyKey: `CUSTOMER_PAYMENT:ORDER:${order.id}`,
  });
};

export const recordDeliveredOrderCashReceipt = async (
  orderId,
  { client = prisma, postAccounting = postCustomerPaymentAccounting } = {},
) => {
  if (!orderId) {
    throw accountingFailure("Order ID is required to record a cash receipt.", "CUSTOMER_PAYMENT_ORDER_REQUIRED");
  }

  const execute = async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw accountingFailure("Order not found.", "ORDER_NOT_FOUND");
    if (order.status !== "Delivered") {
      throw accountingFailure("Order not delivered yet.", "ORDER_NOT_DELIVERED");
    }
    if (String(order.paymentMethod || "COD").trim().toUpperCase() !== "COD") {
      throw accountingFailure("Only COD collection can be recorded through this workflow.", "CUSTOMER_PAYMENT_NOT_COD");
    }

    const collection = await tx.distributorCashEvent.findFirst({
      where: {
        orderId,
        eventType: "CUSTOMER_COLLECTION",
        status: { in: ["VERIFIED", "POSTED"] },
      },
      orderBy: { occurredAt: "desc" },
      select: { amount: true },
    });
    if (!collection) {
      throw accountingFailure(
        "A verified COD collection event is required before recording customer payment.",
        "CUSTOMER_COLLECTION_EVIDENCE_REQUIRED",
      );
    }
    if (!accountingDecimal(collection.amount, "Collected COD amount").equals(formatCollectionAmount(order))) {
      throw accountingFailure(
        "The verified COD collection does not match the order amount.",
        "CUSTOMER_COLLECTION_AMOUNT_MISMATCH",
      );
    }

    const updatedOrder = await tx.order.update({
      where: { id: orderId },
      data: { payment: true },
    });
    await postOrderCustomerPaymentAccounting(updatedOrder, { client: tx, postAccounting });
    return updatedOrder;
  };

  for (let attempt = 0; ; attempt += 1) {
    try {
      return typeof client.$transaction === "function"
        ? await client.$transaction(execute, { isolationLevel: "Serializable" })
        : await execute(client);
    } catch (error) {
      if (error?.code !== "P2034" || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
};
