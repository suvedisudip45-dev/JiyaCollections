import { createHash, timingSafeEqual } from "node:crypto";

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

const readBodyText = (body) => {
  if (body === undefined || body === null) return "";
  if (Buffer.isBuffer(body)) return body.toString("utf8");
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof body === "object") return JSON.stringify(body);
  return String(body);
};

export const canonicalizeBodyText = (body) => {
  const text = readBodyText(body).trim();
  return text === "" ? '""' : text;
};

export const legacySignature = ({ method, canonicalUrl, body, secret }) => {
  const normalizedMethod = String(method || "").trim().toUpperCase();
  const normalizedUrl = canonicalizeRequestUrl(canonicalUrl);
  const canonicalBody = canonicalizeBodyText(body);
  const canonical = `${normalizedMethod}|${normalizedUrl}|${canonicalBody}`;
  const upperHexDigest = createHash("sha256")
    .update(`${canonical}${secret ?? ""}`, "utf8")
    .digest("hex")
    .toUpperCase();

  return Buffer.from(upperHexDigest, "utf8").toString("base64");
};

export const signaturesMatch = (received, expected) => {
  if (typeof received !== "string" || typeof expected !== "string") {
    return false;
  }

  const receivedBytes = Buffer.from(received, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");

  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
};
