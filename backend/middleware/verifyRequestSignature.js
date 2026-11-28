import { legacySignature, signaturesMatch } from "../utils/hmac.js";
import { logger } from "../utils/logger.js";

const WEBHOOK_PATHS = new Set(
  [
    "/api/delivery",
    "/api/delivery/webhook/ncm",
    "/api/delivery/ncm",
    "/api/delivery/webhook/ncm/order-status",
    "/api/delivery/webhook/ncm/order-comment",
    "/api/delivery/ncm-webhook",
    "/api/delivery/webhook",
    "/api/ncm-webhook",
    "/api/ncm-webhook/webhook/ncm",
    "/api/ncm-webhook/ncm",
    "/api/ncm-webhook/webhook/ncm/order-status",
    "/api/ncm-webhook/webhook/ncm/order-comment",
    "/api/ncm-webhook/ncm-webhook",
    "/api/ncm-webhook/webhook",
  ].map((path) => path.toLowerCase())
);

const isNcmWebhookRequest = (req) => {
  if (req.method !== "POST") return false;
  const path = String(req.path || "").replace(/\/+$/, "").toLowerCase() || "/";
  return WEBHOOK_PATHS.has(path);
};

const hasRequestBody = (req) => {
  const contentLength = Number(req.get?.("content-length") || req.headers?.["content-length"] || 0);
  const transferEncoding = req.get?.("transfer-encoding") || req.headers?.["transfer-encoding"];
  return contentLength > 0 || Boolean(transferEncoding);
};

const getSignatureBody = (req) => {
  if (!hasRequestBody(req) || req.is?.("multipart/form-data")) return undefined;
  if (typeof req.rawBody === "string") return req.rawBody;
  return req.body;
};

const getRequestDiagnostics = (req) => {
  const rawBody = getSignatureBody(req);
  const bodyText = rawBody === undefined || rawBody === null
    ? ""
    : typeof rawBody === "string"
      ? rawBody
      : Buffer.isBuffer(rawBody)
        ? rawBody.toString("utf8")
        : JSON.stringify(rawBody);

  return {
    correlationId: req.correlationId || null,
    method: req.method,
    path: String(req.path || req.url || "").split("?")[0],
    origin: req.get?.("origin") || null,
    contentType: req.get?.("content-type") || null,
    contentLength: req.get?.("content-length") || null,
    bodyBytes: Buffer.byteLength(bodyText || "", "utf8"),
    queryParameterCount: new URLSearchParams(String(req.originalUrl || req.url || "").split("?")[1] || "").size,
  };
};

const getReceivedSignature = (req) => {
  const requestSignature = req.get?.("request-signature") || req.headers?.["request-signature"];
  if (typeof requestSignature === "string" && requestSignature) {
    return { value: requestSignature, header: "Request-Signature" };
  }

  const alternateSignature = req.get?.("x-request-signature") || req.headers?.["x-request-signature"];
  if (typeof alternateSignature === "string" && alternateSignature) {
    return { value: alternateSignature, header: "x-request-signature" };
  }

  return { value: "", header: null };
};

export const verifyRequestSignature = (req, res, next) => {
  if (req.method === "OPTIONS") return next();

  const path = String(req.path || "").toLowerCase();
  if (path !== "/api" && !path.startsWith("/api/")) return next();
  if (isNcmWebhookRequest(req)) return next();

  const secret = String(process.env.HMAC_SECRET || "").trim();
  if (!secret) {
    logger.error("HMAC verification is not configured", getRequestDiagnostics(req));
    return res.status(503).json({
      success: false,
      message: "Request signature verification is not configured.",
      code: "HMAC_NOT_CONFIGURED",
    });
  }

  const { value: receivedSignature, header: signatureHeader } = getReceivedSignature(req);

  if (typeof receivedSignature !== "string" || !receivedSignature) {
    logger.warn("HMAC signature missing", getRequestDiagnostics(req));
    return res.status(401).json({
      success: false,
      message: "A valid request signature is required.",
      code: "HMAC_SIGNATURE_REQUIRED",
    });
  }

  const body = getSignatureBody(req);
  const expectedSignature = legacySignature({
    method: req.method,
    canonicalUrl: req.originalUrl || req.url,
    body,
    secret,
  });

  if (!signaturesMatch(receivedSignature, expectedSignature)) {
    logger.warn("HMAC signature mismatch", {
      ...getRequestDiagnostics(req),
      signatureHeader,
      receivedSignatureLength: receivedSignature.length,
      expectedSignatureLength: expectedSignature.length,
    });
    return res.status(401).json({
      success: false,
      message: "Request signature is invalid.",
      code: "HMAC_SIGNATURE_INVALID",
    });
  }

  return next();
};

export default verifyRequestSignature;
