import { createHash } from "node:crypto";
import { prisma } from "../config/db.js";
import { loadNotificationConfig } from "./config.js";

const normalizeIp = (value) => String(value || "").replace(/^::ffff:/i, "").trim();

const readField = (query, name, maxLength) => {
  const value = query?.[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
};

export const normalizeIncomingSms = (query, maxTextLength = 160) => {
  const fromNumber = readField(query, "from", 64);
  const toShortCode = readField(query, "to", 64);
  const keyword = query?.keyword === undefined ? null : readField(query, "keyword", 64);
  const text = readField(query, "text", maxTextLength);
  const providerMessageId = query?.message_id === undefined ? null : readField(query, "message_id", 191);
  if (!fromNumber || !toShortCode || !text || (query?.keyword !== undefined && !keyword) || (query?.message_id !== undefined && !providerMessageId)) return null;
  const normalized = { fromNumber, toShortCode, keyword, text, providerMessageId };
  normalized.payloadHash = createHash("sha256")
    .update([fromNumber, toShortCode, keyword || "", text].join("\u0000"))
    .digest("hex");
  return normalized;
};

export const createIncomingSmsHandler = ({ client = prisma, getConfig = loadNotificationConfig } = {}) => async (req, res) => {
  let config;
  try {
    config = getConfig();
  } catch {
    return res.status(503).type("text/plain").send("Unavailable");
  }
  if (!config.enabled || !config.inboundSms.enabled) {
    return res.status(404).type("text/plain").send("Unavailable");
  }

  const sourceIp = normalizeIp(req.socket?.remoteAddress);
  if (!sourceIp || !config.inboundSms.allowedIps.includes(sourceIp)) {
    return res.status(403).type("text/plain").send("Forbidden");
  }

  const incoming = normalizeIncomingSms(req.query, config.inboundSms.maxTextLength);
  if (!incoming) return res.status(400).type("text/plain").send("Invalid message");

  const now = new Date();
  const replayWindowStart = new Date(now.getTime() - 5 * 60 * 1000);
  try {
    const existing = await client.incomingSms.findFirst({
      where: incoming.providerMessageId
        ? { provider: "SPARROW", providerMessageId: incoming.providerMessageId }
        : { provider: "SPARROW", payloadHash: incoming.payloadHash, receivedAt: { gte: replayWindowStart } },
      select: { id: true },
    });
    if (existing) return res.status(200).type("text/plain").send("Duplicate");

    await client.incomingSms.create({
      data: {
        provider: "SPARROW",
        providerMessageId: incoming.providerMessageId,
        fromNumber: incoming.fromNumber,
        toShortCode: incoming.toShortCode,
        keyword: incoming.keyword,
        text: incoming.text,
        payloadHash: incoming.payloadHash,
        processingStatus: "RECEIVED",
        receivedAt: now,
      },
    });
    return res.status(202).type("text/plain").send("Received");
  } catch (error) {
    if (error?.code === "P2002") return res.status(200).type("text/plain").send("Duplicate");
    return res.status(503).type("text/plain").send("Unavailable");
  }
};
