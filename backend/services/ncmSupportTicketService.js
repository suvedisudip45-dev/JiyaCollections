import { prisma } from "../config/db.js";

const ticketError = (message) =>
  Object.assign(new Error(message), { statusCode: 400, code: "INVALID_NCM_TICKET_FILTER" });

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toText = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

const toIdText = (value) => (value === null || value === undefined ? null : String(value));

const normalizeStatus = (status, closedOn) => {
  if (closedOn || status === true) return "CLOSED";
  if (status === false || status === null || status === undefined || status === "") return "OPEN";
  const normalized = String(status).trim().toUpperCase();
  if (["CLOSED", "CLOSE", "RESOLVED", "COMPLETE", "COMPLETED"].includes(normalized)) return "CLOSED";
  if (["OPEN", "ACTIVE", "PENDING", "IN_PROGRESS"].includes(normalized)) return "OPEN";
  return normalized.slice(0, 32);
};

const unwrapTicketPayload = (payload) => {
  let current = payload;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    if (current.ticket && typeof current.ticket === "object") {
      return {
        ticket: current.ticket,
        responses: Array.isArray(current.responses) ? current.responses : [],
      };
    }
    if (current.ticket !== null && current.ticket !== undefined) {
      return {
        ticket: { id: current.ticket },
        responses: Array.isArray(current.responses) ? current.responses : [],
      };
    }
    if (current.ticket_id !== null && current.ticket_id !== undefined) {
      return {
        ticket: { ...current, id: current.ticket_id },
        responses: Array.isArray(current.responses) ? current.responses : [],
      };
    }
    if (
      (current.id !== undefined || current.pk !== undefined || current.ticket_id !== undefined)
      && (
        current.ticket_type !== undefined
        || current.message !== undefined
        || current.status !== undefined
        || current.closed_on !== undefined
      )
    ) {
      return {
        ticket: current,
        responses: Array.isArray(current.responses) ? current.responses : [],
      };
    }
    if (current.data && typeof current.data === "object") {
      current = current.data;
      continue;
    }
    break;
  }
  return { ticket: null, responses: [] };
};

const newestByDate = (entries) => [...entries]
  .filter((entry) => entry && typeof entry === "object")
  .sort((left, right) => (
    (toDate(right.added_on || right.created_at || right.date)?.getTime() || 0)
    - (toDate(left.added_on || left.created_at || left.date)?.getTime() || 0)
  ))[0] || null;

const buildSnapshot = (ticket, responses, fallback = {}) => {
  const rawId = ticket?.id ?? ticket?.pk ?? ticket?.ticket_id ?? fallback.ncmTicketId;
  const ncmTicketId = Number(rawId);
  if (!Number.isSafeInteger(ncmTicketId) || ncmTicketId < 1) {
    throw Object.assign(new Error(
      "NCM accepted the ticket operation but returned no valid ticket ID; verify the ticket in NCM before retrying.",
    ), {
      statusCode: 502,
      code: "NCM_TICKET_ID_MISSING_AFTER_SUCCESS",
      outcomeUnknown: true,
    });
  }

  const addedOn = toDate(ticket?.added_on ?? ticket?.created_at ?? fallback.addedOn);
  const closedOn = toDate(ticket?.closed_on ?? fallback.closedOn);
  const latestResponse = newestByDate(responses);
  const comment = ticket?.comment;
  const commentMessage = comment && typeof comment === "object"
    ? comment.message ?? comment.comment ?? comment.body
    : comment;
  const latestResponseAt = toDate(latestResponse?.added_on || latestResponse?.created_at || latestResponse?.date);
  const latestCommentAt = toDate(ticket?.comment_added_on || ticket?.comment_at || fallback.latestCommentAt);
  const activityDates = [addedOn, closedOn, latestResponseAt, latestCommentAt].filter(Boolean);
  const lastActivityAt = activityDates.length
    ? new Date(Math.max(...activityDates.map((date) => date.getTime())))
    : toDate(fallback.lastActivityAt) || new Date();
  const assignedTo = ticket?.assigned_to || {};
  const closedBy = ticket?.closed_by || {};
  const vendor = ticket?.vendor || {};

  return {
    ncmTicketId,
    ticketType: String(ticket?.ticket_type || fallback.ticketType || "UNKNOWN").slice(0, 80),
    message: toText(ticket?.message) ?? fallback.message ?? "",
    status: normalizeStatus(ticket?.status ?? fallback.status, closedOn),
    addedOn,
    closedOn,
    branch: toText(ticket?.branch?.name ?? ticket?.branch_name ?? ticket?.branch ?? fallback.branch)?.slice(0, 200) ?? null,
    attachment: toText(ticket?.attachment ?? fallback.attachment),
    vendorId: toIdText(vendor.id ?? ticket?.vendor_id ?? fallback.vendorId),
    vendorName: toText(vendor.name ?? ticket?.vendor_name ?? fallback.vendorName)?.slice(0, 200) ?? null,
    assignedToId: toIdText(assignedTo.id ?? ticket?.assigned_to_id ?? fallback.assignedToId),
    assignedToName: toText(assignedTo.name ?? ticket?.assigned_to_name ?? fallback.assignedToName)?.slice(0, 200) ?? null,
    closedById: toIdText(closedBy.id ?? ticket?.closed_by_id ?? fallback.closedById),
    closedByName: toText(closedBy.name ?? ticket?.closed_by_name ?? fallback.closedByName)?.slice(0, 200) ?? null,
    latestComment: toText(commentMessage ?? fallback.latestComment),
    latestCommentAt,
    latestResponse: toText(latestResponse?.message ?? fallback.latestResponse),
    latestResponseAt: latestResponseAt || toDate(fallback.latestResponseAt),
    lastActivityAt,
    lastSyncedAt: new Date(),
    ...(fallback.recordedByAccountId ? { recordedByAccountId: fallback.recordedByAccountId } : {}),
  };
};

const upsertSnapshot = async (data, client) => client.ncmSupportTicket.upsert({
  where: { ncmTicketId: data.ncmTicketId },
  create: data,
  update: Object.fromEntries(Object.entries(data).filter(([key]) => key !== "recordedByAccountId")),
});

export const saveNcmSupportTicket = async (payload, fallback = {}, client = prisma) => {
  const { ticket, responses } = unwrapTicketPayload(payload);
  const snapshot = buildSnapshot(ticket, responses, fallback);
  return upsertSnapshot(snapshot, client);
};

export const recordNcmSupportTicketReply = async (
  ncmTicketId,
  message,
  { actorId, now = new Date() } = {},
  client = prisma,
) => {
  const id = Number(ncmTicketId);
  if (!Number.isSafeInteger(id) || id < 1) throw ticketError("ticketId must be a positive integer.");
  const data = {
    ncmTicketId: id,
    ticketType: "UNKNOWN",
    message: "",
    status: "OPEN",
    latestResponse: message,
    latestResponseAt: now,
    lastActivityAt: now,
    lastSyncedAt: now,
    ...(actorId ? { recordedByAccountId: actorId } : {}),
  };
  return client.ncmSupportTicket.upsert({
    where: { ncmTicketId: id },
    create: data,
    update: {
      latestResponse: message,
      latestResponseAt: now,
      lastActivityAt: now,
      lastSyncedAt: now,
    },
  });
};

export const markNcmSupportTicketClosed = async (
  ncmTicketId,
  { actorId, now = new Date() } = {},
  client = prisma,
) => {
  const id = Number(ncmTicketId);
  if (!Number.isSafeInteger(id) || id < 1) throw ticketError("ticketId must be a positive integer.");
  const data = {
    ncmTicketId: id,
    ticketType: "UNKNOWN",
    message: "",
    status: "CLOSED",
    closedOn: now,
    lastActivityAt: now,
    lastSyncedAt: now,
    ...(actorId ? { recordedByAccountId: actorId } : {}),
  };
  return client.ncmSupportTicket.upsert({
    where: { ncmTicketId: id },
    create: data,
    update: {
      status: "CLOSED",
      closedOn: now,
      lastActivityAt: now,
      lastSyncedAt: now,
    },
  });
};

export const listNcmSupportTickets = async (query = {}, client = prisma) => {
  const status = String(query.status || "active").toLowerCase();
  if (!["active", "closed", "all"].includes(status)) {
    throw ticketError("status must be active, closed, or all.");
  }
  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 20);
  if (!Number.isSafeInteger(page) || page < 1) throw ticketError("page must be a positive integer.");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw ticketError("limit must be an integer between 1 and 100.");
  }
  const search = String(query.search || "").trim().slice(0, 100);
  const where = {
    ...(status === "active" ? { status: { not: "CLOSED" } } : {}),
    ...(status === "closed" ? { status: "CLOSED" } : {}),
    ...(search ? {
      OR: [
        { message: { contains: search } },
        { branch: { contains: search } },
        { vendorName: { contains: search } },
        { ticketType: { contains: search } },
        ...(Number.isSafeInteger(Number(search)) ? [{ ncmTicketId: Number(search) }] : []),
      ],
    } : {}),
  };
  const [tickets, total] = await Promise.all([
    client.ncmSupportTicket.findMany({
      where,
      select: {
        ncmTicketId: true,
        ticketType: true,
        status: true,
        message: true,
        addedOn: true,
        closedOn: true,
        branch: true,
        vendorName: true,
        lastActivityAt: true,
        lastSyncedAt: true,
      },
      orderBy: [{ lastActivityAt: "desc" }, { updatedAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    client.ncmSupportTicket.count({ where }),
  ]);
  return {
    success: true,
    tickets,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    source: "local",
  };
};
