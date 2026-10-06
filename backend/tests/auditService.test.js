import test from "node:test";
import assert from "node:assert/strict";
import { diffStates, recordSystemAudit } from "../services/auditService.js";

test("audit diffs contain only changed values and redact sensitive fields", () => {
  const result = diffStates(
    { displayName: "Old name", passwordHash: "before-secret", nested: { unchanged: true, count: 1 } },
    { displayName: "New name", passwordHash: "after-secret", nested: { unchanged: true, count: 2 } }
  );

  assert.deepEqual(result, {
    beforeState: {
      displayName: "Old name",
      passwordHash: "[REDACTED]",
      nested: { count: 1 },
    },
    afterState: {
      displayName: "New name",
      passwordHash: "[REDACTED]",
      nested: { count: 2 },
    },
  });
});

test("audit diffs omit undefined fields when a property is added or removed", () => {
  const result = diffStates({ removedValue: "old" }, { addedValue: "new" });
  assert.deepEqual(result, {
    beforeState: { removedValue: "old" },
    afterState: { addedValue: "new" },
  });
});

test("audit outbox writes carry redacted, normalized event context", async () => {
  let created;
  const client = {
    systemAuditOutbox: {
      create: async (request) => {
        created = request.data;
        return { id: request.data.id };
      },
    },
  };

  await recordSystemAudit({
    actorId: "account-1",
    actorRole: "ADMIN",
    portalSource: "admin",
    correlationId: "request-1",
  }, {
    action: "UPDATED",
    entityType: "Account",
    entityId: "target-1",
    beforeState: { apiToken: "old" },
    afterState: { apiToken: "new" },
  }, { client });

  assert.equal(created.event.actorId, "account-1");
  assert.equal(created.event.portalSource, "admin");
  assert.equal(created.event.correlationId, "request-1");
  assert.deepEqual(created.event.beforeState, { apiToken: "[REDACTED]" });
  assert.deepEqual(created.event.afterState, { apiToken: "[REDACTED]" });
});
