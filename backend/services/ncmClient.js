import { logger } from "../utils/logger.js";

const DEFAULT_BASE_URL = "https://demo.nepalcanmove.com";
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

const getConfig = () => ({
  baseUrl: (process.env.NCM_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ""),
  token: process.env.NCM_API_TOKEN || "",
});

const sanitizeUrl = (url) => url.replace(/([?&]token=)[^&]+/i, "$1[REDACTED]");

const requestNcm = async (path, { method = "GET", query, body } = {}) => {
  const { baseUrl, token } = getConfig();
  const timeoutMs = Number(process.env.NCM_API_TIMEOUT_MS || DEFAULT_REQUEST_TIMEOUT_MS);
  if (!token) throw new Error("NCM_API_TOKEN is not configured");

  const url = new URL(`${baseUrl}${path}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const payloadForLog = body ? JSON.parse(JSON.stringify(body)) : null;
    logger.info("NCM request started", {
      method,
      url: sanitizeUrl(url.toString()),
      requestBody: payloadForLog,
    });

    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Token ${token}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text.slice(0, 2000) };
    }

    if (!response.ok) {
      const error = new Error(`NCM request failed with HTTP ${response.status}`);
      error.code = `NCM_HTTP_${response.status}`;
      error.httpStatus = response.status;
      error.response = data;

      logger.error("NCM request failed", {
        method,
        url: sanitizeUrl(url.toString()),
        httpStatus: response.status,
        requestBody: payloadForLog,
        responseBody: data,
      });
      throw error;
    }

    logger.info("NCM request succeeded", {
      method,
      url: sanitizeUrl(url.toString()),
      httpStatus: response.status,
      requestBody: payloadForLog,
      responseBody: data,
    });

    return { data, httpStatus: response.status, url: sanitizeUrl(url.toString()) };
  } catch (error) {
    logger.error("NCM request exception", {
      method,
      url: sanitizeUrl(url.toString()),
      requestBody: body ? JSON.parse(JSON.stringify(body)) : null,
      errorName: error.name,
      errorCode: error.code,
      errorMessage: error.message,
      errorResponse: error.response || null,
    });
    if (error.name === "AbortError") {
      const timeoutError = new Error("NCM request timed out");
      timeoutError.code = "NCM_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export const getBranches = () => requestNcm("/api/v2/branches");
export const getAssignedBranches = () => requestNcm("/api/v2/vendor/assigned-branches");

export const getNcmBranchRows = (response) => {
  const payload = response?.data ?? response;
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.branches)) return payload.branches;
  return [];
};

export const getNcmBranchName = (branch) => String(
  typeof branch === "string"
    ? branch
    : branch?.name || branch?.branch_name || branch?.branchName || branch?.branch || branch?.code || ""
).trim().toUpperCase();

export const getNcmCoveredAreas = (branch) => {
  const raw = branch?.areas_covered ?? branch?.covered_areas ?? branch?.coveredAreas ?? [];
  const values = Array.isArray(raw) ? raw : String(raw || "").split(/[,;|]/);
  return [...new Set(values
    .map((value) => typeof value === "object" ? value?.name || value?.area || value?.title : value)
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean))].sort();
};

export const shippingRateTypeForNcm = (deliveryType = "Door2Door") => ({
  Door2Door: "Pickup/Collect",
  Branch2Door: "Send Branch2Door",
  Door2Branch: "D2B",
  Branch2Branch: "B2B",
}[deliveryType] || "Pickup/Collect");
export const getShippingRate = ({ creation, destination, type }) =>
  requestNcm("/api/v1/shipping-rate", {
    query: { creation, destination, type: shippingRateTypeForNcm(type) },
  });
export const createOrder = (payload) => requestNcm("/api/v1/order/create", { method: "POST", body: payload });
export const getOrder = (orderId) => requestNcm("/api/v1/order", { query: { id: orderId } });
export const getOrderStatus = (orderId) =>
  requestNcm("/api/v1/order/status", { query: { id: orderId } });
export const getBulkOrderStatuses = (orders) =>
  requestNcm("/api/v1/orders/statuses", { method: "POST", body: { orders } });
export const getOrderComments = (orderId) =>
  requestNcm("/api/v1/order/comment", { query: { id: orderId } });
export const getBulkOrderComments = () => requestNcm("/api/v1/order/getbulkcomments");
export const createOrderComment = ({ orderid, comments }) =>
  requestNcm("/api/v1/comment", { method: "POST", body: { orderid, comments } });
export const requestOrderReturn = ({ pk, comment }) =>
  requestNcm("/api/v2/vendor/order/return", { method: "POST", body: { pk, comment } });
export const createExchangeOrder = ({ pk }) =>
  requestNcm("/api/v2/vendor/order/exchange-create", { method: "POST", body: { pk } });
export const redirectOrder = (payload) =>
  requestNcm("/api/v2/vendor/order/redirect", { method: "POST", body: payload });
export const getOrderLabel = (orderId) => requestNcm(`/api/v2/vendor/order/label/${orderId}`);
export const getOrderLabels = (ids) => requestNcm("/api/v2/vendor/order/label/", { method: "POST", body: { ids } });
export const configureWebhook = ({ webhook_url }) =>
  requestNcm("/api/v2/vendor/webhook", { method: "POST", body: { webhook_url } });
export const testWebhook = ({ webhook_url }) =>
  requestNcm("/api/v2/vendor/webhook/test", { method: "POST", body: { webhook_url } });
export const createVendorTicket = (payload) =>
  requestNcm("/api/v2/vendor/ticket/create/new", { method: "POST", body: payload });
export const createCodTransferTicket = ({ bankName, bankAccountName, bankAccountNumber }) =>
  requestNcm("/api/v2/vendor/ticket/cod/create", {
    method: "POST",
    body: { bankName, bankAccountName, bankAccountNumber },
  });
export const closeVendorTicket = (ticketId) =>
  requestNcm(`/api/v2/vendor/ticket/close/${ticketId}`, { method: "POST", body: { pk: ticketId } });
export const getTicketDetail = (ticketId) => requestNcm(`/api/v1/tickets/${ticketId}/detail`);
export const createTicketResponse = (ticketId, message) =>
  requestNcm(`/api/v1/vendor/tickets/${ticketId}/response`, { method: "POST", body: { message } });
export const getVendorCustomers = (query) => requestNcm("/api/v2/vendor/customers", { query });
export const getVendorCustomerDetail = (customerId) => requestNcm(`/api/v2/vendor/customers/${customerId}/detail`);
export const getCustomerRatings = (phone) => requestNcm("/api/v2/vendor/ratings", { query: { phone } });

export { requestNcm };
