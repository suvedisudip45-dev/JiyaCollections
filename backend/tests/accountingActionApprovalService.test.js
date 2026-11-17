import test from "node:test";
import assert from "node:assert/strict";
import {
  requestAccountingActionApproval,
  reviewAccountingActionApproval,
} from "../services/accountingActionApprovalService.js";

const createApprovalClient = () => {
  const state = {
    approval: null,
    events: [],
    accountCalls: [],
    financialAccount: {
      id: "treasury-1",
      accountType: "BANK",
      accountingAccountId: "gl-old",
      accountName: "Operating Bank",
    },
  };
  const tx = {
    accountingActionApproval: {
      findUnique: async ({ where }) => {
        if (where.requestKey) return state.approval?.requestKey === where.requestKey ? state.approval : null;
        if (where.id) return state.approval?.id === where.id ? { ...state.approval, events: [...state.events] } : null;
        return null;
      },
      create: async ({ data }) => {
        state.approval = { id: "approval-1", ...data, status: "PENDING", createdAt: new Date() };
        return state.approval;
      },
      updateMany: async ({ where, data }) => {
        if (state.approval?.id !== where.id || state.approval.status !== where.status) return { count: 0 };
        state.approval = { ...state.approval, ...data };
        return { count: 1 };
      },
    },
    accountingActionApprovalEvent: {
      create: async ({ data }) => {
        const event = { id: `event-${state.events.length + 1}`, ...data, createdAt: new Date() };
        state.events.push(event);
        return event;
      },
    },
    systemAuditOutbox: {
      create: async ({ data }) => ({ id: data.id }),
    },
    account: {
      findUnique: async (args) => {
        state.accountCalls.push(["findUnique", args]);
        if (args.where.id === "gl-bank") {
          return {
            id: "gl-bank",
            accountCode: "1120",
            accountName: "Bank",
            accountType: "ASSET",
            normalBalance: "DEBIT",
            isActive: true,
            subAccounts: [],
          };
        }
        return null;
      },
      create: async ({ data }) => {
        state.accountCalls.push(["create", data]);
        return { id: "account-1", ...data };
      },
    },
    financialAccount: {
      findUnique: async ({ where }) => state.financialAccount?.id === where.id ? { ...state.financialAccount } : null,
      updateMany: async ({ where, data }) => {
        if (state.financialAccount?.id !== where.id ||
            state.financialAccount.accountingAccountId !== where.accountingAccountId) return { count: 0 };
        state.financialAccount = { ...state.financialAccount, ...data };
        return { count: 1 };
      },
      create: async ({ data }) => {
        state.financialAccount = { id: "treasury-created", ...data };
        return state.financialAccount;
      },
    },
  };
  return {
    state,
    client: { $transaction: async (callback) => callback(tx) },
  };
};

const coaPayload = {
  accountCode: "6450",
  accountName: "Approved Test Account",
  accountType: "EXPENSE",
  reason: "Required for the approved management reporting structure.",
};

test("maker cannot review their own accounting action", async () => {
  const { client } = createApprovalClient();
  const submitted = await requestAccountingActionApproval({
    actionType: "COA_CREATE",
    requestKey: "maker-checker-self-review",
    payload: coaPayload,
    actor: { accountId: "maker-1", role: "ADMIN" },
    client,
  });

  await assert.rejects(
    reviewAccountingActionApproval({
      approvalId: submitted.approvalRequest.id,
      decision: "APPROVE",
      reason: "Reviewed the account request.",
      actor: { accountId: "maker-1", role: "ADMIN" },
      client,
    }),
    (error) => error.code === "MAKER_CANNOT_REVIEW",
  );
});

test("rejecting an accounting request does not execute its accounting change", async () => {
  const { client, state } = createApprovalClient();
  const submitted = await requestAccountingActionApproval({
    actionType: "COA_CREATE",
    requestKey: "maker-checker-reject",
    payload: coaPayload,
    actor: { accountId: "maker-2", role: "ADMIN" },
    client,
  });

  const result = await reviewAccountingActionApproval({
    approvalId: submitted.approvalRequest.id,
    decision: "REJECT",
    reason: "The account is not part of the approved chart.",
    actor: { accountId: "reviewer-2", role: "ADMIN" },
    client,
  });

  assert.equal(result.approvalRequest.status, "REJECTED");
  assert.deepEqual(state.accountCalls, []);
});

test("an independent approval executes the chart change and records both actors", async () => {
  const { client, state } = createApprovalClient();
  const submitted = await requestAccountingActionApproval({
    actionType: "COA_CREATE",
    requestKey: "maker-checker-approve",
    payload: coaPayload,
    actor: { accountId: "maker-3", role: "ADMIN" },
    client,
  });

  const result = await reviewAccountingActionApproval({
    approvalId: submitted.approvalRequest.id,
    decision: "APPROVE",
    reason: "Approved against the management authorization.",
    actor: { accountId: "reviewer-3", role: "ADMIN" },
    client,
  });

  assert.equal(result.approvalRequest.status, "APPROVED");
  assert.equal(result.approvalRequest.makerAccountId, "maker-3");
  assert.equal(result.approvalRequest.reviewerAccountId, "reviewer-3");
  assert.equal(state.accountCalls.filter(([method]) => method === "create").length, 1);
  assert.equal(state.events.length, 2);
});

test("reusing a request key with changed accounting details is rejected", async () => {
  const { client } = createApprovalClient();
  await requestAccountingActionApproval({
    actionType: "COA_CREATE",
    requestKey: "maker-checker-payload-conflict",
    payload: coaPayload,
    actor: { accountId: "maker-4", role: "ADMIN" },
    client,
  });

  await assert.rejects(
    requestAccountingActionApproval({
      actionType: "COA_CREATE",
      requestKey: "maker-checker-payload-conflict",
      payload: { ...coaPayload, accountName: "Different Account" },
      actor: { accountId: "maker-4", role: "ADMIN" },
      client,
    }),
    (error) => error.code === "IDEMPOTENCY_KEY_REUSED",
  );
});

test("Treasury GL mapping is unchanged until an independent Admin approves it", async () => {
  const { client, state } = createApprovalClient();
  const submitted = await requestAccountingActionApproval({
    actionType: "TREASURY_GL_MAPPING",
    requestKey: "treasury-mapping-approval",
    payload: {
      financialAccountId: "treasury-1",
      accountingAccountId: "gl-bank",
      reason: "Align the operating bank account with the approved bank control account.",
    },
    actor: { accountId: "treasury-maker", role: "ADMIN" },
    client,
  });

  assert.equal(state.financialAccount.accountingAccountId, "gl-old");
  await reviewAccountingActionApproval({
    approvalId: submitted.approvalRequest.id,
    decision: "APPROVE",
    reason: "Verified against the bank account documentation.",
    actor: { accountId: "treasury-reviewer", role: "ADMIN" },
    client,
  });
  assert.equal(state.financialAccount.accountingAccountId, "gl-bank");
});

test("Treasury account creation and its GL mapping wait for independent approval", async () => {
  const { client, state } = createApprovalClient();
  const submitted = await requestAccountingActionApproval({
    actionType: "TREASURY_ACCOUNT_CREATE",
    requestKey: "treasury-account-creation-approval",
    payload: {
      accountName: "New Operating Bank",
      accountType: "BANK",
      bankName: "Example Bank",
      accountNumber: "123456",
      accountingAccountId: "gl-bank",
      reason: "Establish a dedicated operating account for approved business receipts.",
    },
    actor: { accountId: "treasury-create-maker", role: "ADMIN" },
    client,
  });

  assert.equal(state.financialAccount.id, "treasury-1");
  await reviewAccountingActionApproval({
    approvalId: submitted.approvalRequest.id,
    decision: "APPROVE",
    reason: "Verified account setup and mapped GL classification.",
    actor: { accountId: "treasury-create-reviewer", role: "ADMIN" },
    client,
  });
  assert.equal(state.financialAccount.id, "treasury-created");
  assert.equal(state.financialAccount.accountingAccountId, "gl-bank");
  assert.equal(state.financialAccount.currentBalance, 0);
});

test("NCM remittance confirmation is queued with its selected settlements and deposit details", async () => {
  const { client } = createApprovalClient();
  const submitted = await requestAccountingActionApproval({
    actionType: "NCM_SETTLEMENT_CONFIRM",
    requestKey: "ncm-remittance-review",
    payload: {
      settlementIds: ["settlement-1", "settlement-2"],
      financialAccountId: "treasury-1",
      actualNetDeposit: "1250.00",
      reference: "BANK-REF-2026-01",
      notes: "Carrier remittance for the selected COD orders.",
      reason: "Reconcile the carrier deposit against the selected NCM COD orders.",
    },
    actor: { accountId: "ncm-maker", role: "ADMIN" },
    client,
  });

  assert.equal(submitted.approvalRequest.actionType, "NCM_SETTLEMENT_CONFIRM");
  assert.equal(submitted.approvalRequest.status, "PENDING");
});

test("distributor refund netting is queued instead of executing during the request", async () => {
  const { client } = createApprovalClient();
  const submitted = await requestAccountingActionApproval({
    actionType: "DISTRIBUTOR_REFUND_NETTING",
    requestKey: "distributor-refund-netting-review",
    payload: {
      distributorId: "distributor-1",
      amount: "50.00",
      reason: "Apply the separately approved agreement to the open COD balance.",
    },
    actor: { accountId: "netting-maker", role: "ADMIN" },
    client,
  });

  assert.equal(submitted.approvalRequest.actionType, "DISTRIBUTOR_REFUND_NETTING");
  assert.equal(submitted.approvalRequest.status, "PENDING");
});

test("NCM variance resolution requires a reason before it can enter the approval queue", async () => {
  const { client, state } = createApprovalClient();
  await assert.rejects(
    requestAccountingActionApproval({
      actionType: "NCM_VARIANCE_RESOLUTION",
      requestKey: "ncm-variance-missing-reason",
      payload: {
        batchId: "batch-1",
        action: "COLLECT_SHORTFALL",
        amount: "75.00",
        financialAccountId: "treasury-1",
        reference: "BANK-REF-2026-02",
        notes: "",
      },
      actor: { accountId: "ncm-maker-2", role: "ADMIN" },
      client,
    }),
    (error) => error.code === "ACCOUNTING_APPROVAL_ERROR",
  );
  assert.equal(state.approval, null);
});

test("supplier-credit, loan-repayment, and share-buyback actions enter the approval queue", async () => {
  const requests = [
    {
      actionType: "MANUFACTURER_CREDIT_APPLICATION",
      payload: {
        manufacturerId: "manufacturer-1",
        creditDocumentId: "credit-1",
        billDocumentId: "bill-1",
        amount: "20.00",
        reason: "Apply the verified return credit to this bill.",
      },
    },
    {
      actionType: "COLLABORATION_CREDIT_APPLICATION",
      payload: {
        creditDocumentId: "partner-credit-1",
        invoiceDocumentId: "partner-invoice-1",
        amount: "15.00",
        reason: "Apply the source-linked credit to this later invoice.",
      },
    },
    {
      actionType: "LOAN_REPAYMENT",
      payload: {
        liabilityId: "loan-1",
        repaymentAmount: "110.00",
        principalPortion: "100.00",
        interestPortion: "10.00",
        fromAccountId: "treasury-1",
        reason: "Repay the approved principal and interest amounts.",
      },
    },
    {
      actionType: "SHARE_BUYBACK",
      payload: {
        sellerPartnerId: "shareholder-1",
        sharesToTransfer: "10",
        sharePrice: "100",
        fromTreasuryAccountId: "treasury-1",
        reason: "Retire the approved share repurchase.",
      },
    },
  ];

  for (const [index, request] of requests.entries()) {
    const { client } = createApprovalClient();
    const submitted = await requestAccountingActionApproval({
      ...request,
      requestKey: `additional-financial-action-${index}`,
      actor: { accountId: `maker-${index}`, role: "ADMIN" },
      client,
    });
    assert.equal(submitted.approvalRequest.actionType, request.actionType);
    assert.equal(submitted.approvalRequest.status, "PENDING");
  }
});

test("supplier returns require a reason and enter the approval queue", async () => {
  const { client, state } = createApprovalClient();
  const payload = {
    requestKey: "supplier-return-request",
    supplierName: "Example Textiles",
    supplierReference: "RET-2026-001",
    settlementType: "CREDIT_NOTE_OFFSET_PAYABLE",
    reason: "Return defective fabric from the inspected shipment.",
    items: [{ productId: "product-1", name: "Cotton fabric", quantity: 2, unitCostPrice: "125.00" }],
  };

  await assert.rejects(
    requestAccountingActionApproval({
      actionType: "SUPPLIER_RETURN_CREATE",
      requestKey: "supplier-return-missing-reason",
      payload: { ...payload, reason: "" },
      actor: { accountId: "supplier-return-maker", role: "ADMIN" },
      client,
    }),
    (error) => error.code === "ACCOUNTING_APPROVAL_ERROR",
  );
  assert.equal(state.approval, null);

  const submitted = await requestAccountingActionApproval({
    actionType: "SUPPLIER_RETURN_CREATE",
    requestKey: payload.requestKey,
    payload,
    actor: { accountId: "supplier-return-maker", role: "ADMIN" },
    client,
  });

  assert.equal(submitted.approvalRequest.actionType, "SUPPLIER_RETURN_CREATE");
  assert.equal(submitted.approvalRequest.status, "PENDING");
  assert.equal(state.events[0].eventType, "SUBMITTED");
});
