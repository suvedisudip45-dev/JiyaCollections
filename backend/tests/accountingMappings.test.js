import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureStandardChartOfAccounts,
  ensureStandardAccountMappings,
  STANDARD_CHART_OF_ACCOUNTS,
  STANDARD_ACCOUNT_MAPPINGS,
} from "../services/accountingPostingEngine.js";

const createMappingHarness = (missingAccountCode = null) => {
  const accounts = new Map(STANDARD_ACCOUNT_MAPPINGS
    .filter((item) => item.accountCode !== missingAccountCode)
    .map((item) => [item.accountCode, { id: `account-${item.accountCode}`, accountCode: item.accountCode }]));
  const mappings = new Map();
  const client = {
    account: {
      findUnique: async ({ where }) => accounts.get(where.accountCode) || null,
    },
    accountingAccountMapping: {
      upsert: async ({ where, create, update }) => {
        const existing = mappings.get(where.mappingKey);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const mapping = { id: `mapping-${mappings.size + 1}`, ...create };
        mappings.set(where.mappingKey, mapping);
        return mapping;
      },
    },
  };
  return { client, mappings };
};

test("standard semantic account mappings seed idempotently", async () => {
  const { client, mappings } = createMappingHarness();
  const first = await ensureStandardAccountMappings(client);
  const second = await ensureStandardAccountMappings(client);

  assert.equal(first.length, STANDARD_ACCOUNT_MAPPINGS.length);
  assert.equal(second.length, STANDARD_ACCOUNT_MAPPINGS.length);
  assert.equal(mappings.size, STANDARD_ACCOUNT_MAPPINGS.length);
  assert.equal(mappings.get("MANUFACTURER_PAYABLE").accountId, "account-2160");
  assert.equal(mappings.get("NCM_COD_RECEIVABLE").accountId, "account-1170");
});

test("existing admin account remaps are not overwritten by standard mapping seeding", async () => {
  const { client, mappings } = createMappingHarness();
  mappings.set("MANUFACTURER_PAYABLE", {
    id: "custom-mapping",
    mappingKey: "MANUFACTURER_PAYABLE",
    accountId: "admin-selected-account",
  });

  await ensureStandardAccountMappings(client);
  assert.equal(mappings.get("MANUFACTURER_PAYABLE").accountId, "admin-selected-account");
});

test("standard mapping seeding fails clearly when a required account is missing", async () => {
  const { client } = createMappingHarness("2180");
  await assert.rejects(() => ensureStandardAccountMappings(client), /Required system account 2180/);
});

test("standard COA seeding repairs partial setup and preserves configured mappings", async () => {
  const accounts = new Map();
  const mappings = new Map();
  const client = {
    account: {
      count: async () => accounts.size,
      findUnique: async ({ where }) => accounts.get(where.accountCode) || null,
      upsert: async ({ where, create, update }) => {
        const existing = accounts.get(where.accountCode);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const account = { id: `account-${where.accountCode}`, ...create };
        accounts.set(where.accountCode, account);
        return account;
      },
      findMany: async () => [...accounts.values()].sort((left, right) => left.accountCode.localeCompare(right.accountCode)),
    },
    accountingAccountMapping: {
      upsert: async ({ where, create, update }) => {
        const existing = mappings.get(where.mappingKey);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const mapping = { id: `mapping-${mappings.size + 1}`, ...create };
        mappings.set(where.mappingKey, mapping);
        return mapping;
      },
    },
  };
  accounts.set("1000", { id: "account-1000", accountCode: "1000", accountType: "ASSET", normalBalance: "DEBIT" });
  mappings.set("MANUFACTURER_PAYABLE", { id: "custom", mappingKey: "MANUFACTURER_PAYABLE", accountId: "custom-ap-control" });

  const chart = await ensureStandardChartOfAccounts(client);
  assert.equal(chart.length, STANDARD_CHART_OF_ACCOUNTS.length);
  assert.equal(accounts.get("2160").parentAccountId, accounts.get("2100").id);
  assert.equal(mappings.size, STANDARD_ACCOUNT_MAPPINGS.length);
  assert.equal(mappings.get("MANUFACTURER_PAYABLE").accountId, "custom-ap-control");
});