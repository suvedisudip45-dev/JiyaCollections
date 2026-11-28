import test from "node:test";
import assert from "node:assert/strict";
import {
  listNcmSupportTickets,
  markNcmSupportTicketClosed,
  recordNcmSupportTicketReply,
  saveNcmSupportTicket,
} from "../services/ncmSupportTicketService.js";

const createTicketClient = () => {
  const rows = new Map();
  return {
    rows,
    ncmSupportTicket: {
      upsert: async ({ where, create, update }) => {
        const existing = rows.get(where.ncmTicketId);
        const row = { ...(existing || create), ...(existing ? update : {}) };
        rows.set(where.ncmTicketId, row);
        return row;
      },
      findMany: async ({ where, select, skip, take }) => {
        let records = [...rows.values()];
        if (typeof where.status === "string") records = records.filter((row) => row.status === where.status);
        else if (where.status?.not) records = records.filter((row) => row.status !== where.status.not);
        if (where.OR) {
          records = records.filter((row) => where.OR.some((condition) => (
            condition.ncmTicketId
              ? row.ncmTicketId === condition.ncmTicketId
              : Object.entries(condition).some(([field, matcher]) => (
                String(row[field] || "").includes(matcher.contains)
              ))
          )));
        }
        records = records.slice(skip, skip + take);
        return records.map((row) => Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])));
      },
      count: async ({ where }) => {
        let records = [...rows.values()];
        if (typeof where.status === "string") records = records.filter((row) => row.status === where.status);
        else if (where.status?.not) records = records.filter((row) => row.status !== where.status.not);
        if (where.OR) {
          records = records.filter((row) => where.OR.some((condition) => (
            condition.ncmTicketId
              ? row.ncmTicketId === condition.ncmTicketId
              : Object.entries(condition).some(([field, matcher]) => (
                String(row[field] || "").includes(matcher.contains)
              ))
          )));
        }
        return records.length;
      },
    },
  };
};

test("ticket response payload is unwrapped and saved with latest response metadata", async () => {
  const client = createTicketClient();
  const ticket = await saveNcmSupportTicket({
    success: true,
    data: {
      success: true,
      ticket: {
        id: 1100,
        ticket_type: "General",
        message: "Need help",
        added_on: "2026-10-15T16:24:39.228575Z",
        status: false,
        comment: "NCM is checking this ticket",
        branch: "",
        vendor: { id: 2, name: "Demo Vendor" },
        assigned_to: { id: null, name: null },
        closed_by: { id: null, name: null },
      },
      responses: [
        {
          id: 22,
          message: "older reply",
          added_on: "2026-10-15T16:25:16.695689Z",
          vendor_display: true,
          added_by: { id: 2, name: "Demo Vendor" },
        },
        {
          id: 23,
          message: "latest reply",
          added_on: "2026-10-15T16:27:59.557298Z",
          vendor_display: true,
          added_by: { id: 2, name: "Demo Vendor" },
        },
      ],
    },
  }, {}, client);

  assert.equal(ticket.ncmTicketId, 1100);
  assert.equal(ticket.status, "OPEN");
  assert.equal(ticket.vendorName, "Demo Vendor");
  assert.equal(ticket.latestResponse, "latest reply");
  assert.equal(ticket.latestResponseAt.toISOString(), "2026-10-15T16:27:59.557Z");
  assert.equal(ticket.latestComment, "NCM is checking this ticket");
});

test("documented NCM ticket creation response with scalar ticket ID is saved locally", async () => {
  const client = createTicketClient();
  const createdAt = new Date("2026-10-15T16:24:39.228Z");
  const ticket = await saveNcmSupportTicket({
    message: "Ticket created",
    ticket: 123,
  }, {
    ticketType: "General",
    message: "Need help",
    addedOn: createdAt,
  }, client);

  assert.equal(ticket.ncmTicketId, 123);
  assert.equal(ticket.ticketType, "General");
  assert.equal(ticket.message, "Need help");
  assert.equal(ticket.addedOn, createdAt);
  assert.deepEqual([...client.rows.keys()], [123]);
  const codTicket = await saveNcmSupportTicket({
    message: "COD ticket created",
    ticket: 124,
  }, {
    ticketType: "COD Transfer",
    message: "COD transfer request",
  }, client);
  assert.equal(codTicket.ncmTicketId, 124);
  assert.equal(codTicket.ticketType, "COD Transfer");
  const active = await listNcmSupportTickets({ status: "active" }, client);
  assert.deepEqual(active.tickets.map((savedTicket) => savedTicket.ncmTicketId), [123, 124]);
});

test("reply and close actions update local activity without erasing ticket fields", async () => {
  const client = createTicketClient();
  await saveNcmSupportTicket({
    ticket: {
      id: 42,
      ticket_type: "Return",
      message: "Return request",
      status: false,
      vendor: { name: "Vendor" },
    },
  }, {}, client);
  const replyDate = new Date("2026-10-15T17:00:00Z");
  await recordNcmSupportTicketReply(42, "We are following up", { now: replyDate }, client);

  assert.equal(client.rows.get(42).message, "Return request");
  assert.equal(client.rows.get(42).ticketType, "Return");
  assert.equal(client.rows.get(42).latestResponse, "We are following up");

  const closedDate = new Date("2026-10-15T18:00:00Z");
  await markNcmSupportTicketClosed(42, { now: closedDate }, client);
  assert.equal(client.rows.get(42).status, "CLOSED");
  assert.equal(client.rows.get(42).closedOn, closedDate);
  assert.equal(client.rows.get(42).message, "Return request");
});

test("active and closed ticket lists are database-only and return basic fields", async () => {
  const client = createTicketClient();
  await saveNcmSupportTicket({ ticket: { id: 1, ticket_type: "General", message: "Active help", status: false } }, {}, client);
  await saveNcmSupportTicket({ ticket: { id: 2, ticket_type: "Return", message: "Closed return", status: true } }, {}, client);

  const active = await listNcmSupportTickets({ status: "active" }, client);
  const closed = await listNcmSupportTickets({ status: "closed" }, client);

  assert.deepEqual(active.tickets.map((ticket) => ticket.ncmTicketId), [1]);
  assert.deepEqual(closed.tickets.map((ticket) => ticket.ncmTicketId), [2]);
  assert.equal(active.source, "local");
  assert.equal(Object.hasOwn(active.tickets[0], "latestResponse"), false);
});

test("invalid ticket list filters are rejected", async () => {
  await assert.rejects(
    () => listNcmSupportTickets({ status: "pending" }, {}),
    /status must be active, closed, or all/,
  );
  await assert.rejects(
    () => listNcmSupportTickets({ limit: "1000" }, {}),
    /limit must be an integer/,
  );
});
