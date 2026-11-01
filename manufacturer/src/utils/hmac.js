import axios from "axios";

const normalizeRequestBody = (body) => {
  if (body === undefined || body === null) return "";
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof FormData) return "";
  if (typeof body === "object") return JSON.stringify(body);
  return String(body);
};

export const canonicalizeRequestUrl = (urlLike = "") => {
  if (typeof urlLike !== "string" || !urlLike.trim()) return "/";

  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(urlLike)
    ? new URL(urlLike)
    : new URL(urlLike, "http://localhost");

  const path = String(candidate.pathname || "/").toLowerCase();
  const rawQuery = candidate.search ? candidate.search.slice(1) : "";

  if (!rawQuery) return path;

  const sortedPairs = rawQuery
    .split("&")
    .filter(Boolean)
    .map((pair) => pair.toLowerCase())
    .sort((left, right) => {
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    });

  return `${path}?${sortedPairs.join("&")}`;
};

export const canonicalizeBodyText = (body) => {
  const rawBodyText = normalizeRequestBody(body).trim();
  return rawBodyText === "" ? '""' : rawBodyText;
};

export const legacySignature = async ({ method, canonicalUrl, body, secret }) => {
  const normalizedMethod = String(method || "").trim().toUpperCase();
  const normalizedCanonicalUrl = canonicalizeRequestUrl(canonicalUrl);
  const canonicalBody = canonicalizeBodyText(body);
  const canonicalMessage = `${normalizedMethod}|${normalizedCanonicalUrl}|${canonicalBody}`;

  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) throw new Error("Web Crypto is required to sign API requests.");

  const digest = await cryptoApi.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${canonicalMessage}${secret ?? ""}`),
  );

  const hexDigest = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

  return btoa(hexDigest);
};

export const signaturesMatch = (received, expected) => {
  if (typeof received !== "string" || typeof expected !== "string") {
    return false;
  }

  const receivedBytes = new TextEncoder().encode(received);
  const expectedBytes = new TextEncoder().encode(expected);

  if (receivedBytes.length !== expectedBytes.length) return false;

  let differs = 0;
  for (let index = 0; index < receivedBytes.length; index += 1) {
    differs |= receivedBytes[index] ^ expectedBytes[index];
  }

  return differs === 0;
};

export const getRequestSignatureSecret = () => (
  import.meta.env.VITE_HMAC_SECRET ||
  import.meta.env.VITE_BACKEND_HMAC_SECRET ||
  import.meta.env.VITE_API_HMAC_SECRET ||
  ""
);

export const signRequestWithLegacyHmac = async (config) => {
  const secret = getRequestSignatureSecret();
  if (!config?.url) return config;
  if (!secret) throw new Error("VITE_HMAC_SECRET must match the backend HMAC_SECRET.");

  const baseURL = config.baseURL || import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";
  const target = axios.getUri({ ...config, baseURL });
  const targetPath = new URL(target, "http://localhost").pathname.replace(/\/+$/, "").toLowerCase() || "/";
  const webhookPaths = new Set([
    "/webhooks",
    "/webhooks/webhook/ncm",
    "/webhooks/ncm",
    "/webhooks/webhook/ncm/order-status",
    "/webhooks/webhook/ncm/order-comment",
    "/webhooks/ncm-webhook",
    "/webhooks/webhook",
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
  ]);
  if ((config.method || "GET").toUpperCase() === "POST" && webhookPaths.has(targetPath)) return config;

  const contentType = String(
    config.headers?.get?.("Content-Type") ||
    config.headers?.["Content-Type"] ||
    config.headers?.["content-type"] ||
    ""
  );
  const isMultipart = (
    (typeof FormData !== "undefined" && config.data instanceof FormData) ||
    /multipart\/form-data/i.test(contentType)
  );

  const signature = await legacySignature({
    method: config.method || "GET",
    canonicalUrl: target,
    body: isMultipart ? undefined : config.data,
    secret,
  });

  const headers = config.headers || {};
  headers["Request-Signature"] = signature;
  config.headers = headers;

  return config;
};
