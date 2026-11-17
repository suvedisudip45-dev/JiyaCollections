import assert from "node:assert/strict";
import test from "node:test";
import { recordPaperSalesInvoice } from "../services/salesInvoiceService.js";

test("unregistered business cannot record a statutory paper invoice", async () => {
  let updated = false;
  const invoice = {
    id: "invoice-1",
    issueChannel: "PAPER",
    status: "PENDING_PAPER_DETAILS",
    documentType: "PAN_BILL",
    taxPoint: new Date("2026-11-14T18:15:00.000Z"),
  };
  const client = {
    $transaction: async (callback) => callback(client),
    salesInvoice: {
      findUnique: async () => invoice,
      update: async () => {
        updated = true;
        return invoice;
      },
    },
    taxRegistrationVersion: { findFirst: async () => null },
  };

  await assert.rejects(
    recordPaperSalesInvoice({
      id: invoice.id,
      invoiceNumber: "PAN-001",
      issueDate: new Date("2026-11-14T18:15:00.000Z"),
      client,
    }),
    { code: "STATUTORY_BILLING_UNAVAILABLE" },
  );
  assert.equal(updated, false);
});
