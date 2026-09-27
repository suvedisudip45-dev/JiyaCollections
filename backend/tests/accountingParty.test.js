import assert from "node:assert/strict";
import test from "node:test";
import { ensureAccountingParty } from "../services/accountingPartyService.js";

const createPartyHarness = () => {
  const parties = new Map();
  const client = {
    accountingParty: {
      upsert: async ({ where, create, update }) => {
        const key = `${where.partyType_sourceEntityId.partyType}:${where.partyType_sourceEntityId.sourceEntityId}`;
        const existing = parties.get(key);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const party = { id: `party-${parties.size + 1}`, ...create };
        parties.set(key, party);
        return party;
      },
    },
  };
  return { client, parties };
};

test("accounting party resolution is stable by type and source identity", async () => {
  const { client, parties } = createPartyHarness();
  const first = await ensureAccountingParty({
    partyType: "manufacturer",
    sourceEntityId: "manufacturer-1",
    displayName: "Maker One",
  }, { client });
  const renamed = await ensureAccountingParty({
    partyType: "MANUFACTURER",
    sourceEntityId: "manufacturer-1",
    displayName: "Maker One Ltd.",
  }, { client });

  assert.equal(first.id, renamed.id);
  assert.equal(renamed.displayName, "Maker One Ltd.");
  assert.equal(parties.size, 1);
});

test("different party types cannot alias the same source ID", async () => {
  const { client, parties } = createPartyHarness();
  const manufacturer = await ensureAccountingParty({
    partyType: "MANUFACTURER",
    sourceEntityId: "shared-id",
    displayName: "Maker",
  }, { client });
  const vendor = await ensureAccountingParty({
    partyType: "VENDOR",
    sourceEntityId: "shared-id",
    displayName: "Vendor",
  }, { client });

  assert.notEqual(manufacturer.id, vendor.id);
  assert.equal(parties.size, 2);
});

test("invalid party types, missing identities, and unsupported currencies are rejected", async () => {
  const { client } = createPartyHarness();
  await assert.rejects(() => ensureAccountingParty({ partyType: "UNKNOWN", sourceEntityId: "1", displayName: "x" }, { client }), /Unsupported/);
  await assert.rejects(() => ensureAccountingParty({ partyType: "VENDOR", sourceEntityId: "", displayName: "x" }, { client }), /source entity ID/);
  await assert.rejects(() => ensureAccountingParty({ partyType: "VENDOR", sourceEntityId: "1", displayName: "x", currency: "USD" }, { client }), /Only NPR/);
});