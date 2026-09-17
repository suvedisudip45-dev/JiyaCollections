import { logger } from "../utils/logger.js";

const DEFAULT_BASE_URL = "https://demo.nepalcanmove.com";
const REQUEST_TIMEOUT_MS = 8000;

const getConfig = () => ({
  baseUrl: (process.env.NCM_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ""),
  token: process.env.NCM_API_TOKEN || "",
});

const sanitizeUrl = (url) => url.replace(/([?&]token=)[^&]+/i, "$1[REDACTED]");

const requestNcm = async (path, { method = "GET", query, body } = {}) => {
  const { baseUrl, token } = getConfig();
  if (!token) throw new Error("NCM_API_TOKEN is not configured");

  const url = new URL(`${baseUrl}${path}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
export const getShippingRate = ({ creation, destination, type }) =>
  requestNcm("/api/v1/shipping-rate", { query: { creation, destination, type } });
export const createOrder = (payload) => requestNcm("/api/v1/order/create", { method: "POST", body: payload });
export const getOrder = (orderId) => requestNcm("/api/v1/order", { query: { id: orderId } });
export const getOrderStatus = (orderId) =>
  requestNcm("/api/v1/order/status", { query: { id: orderId } });
export const getBulkOrderStatuses = (orders) =>
  requestNcm("/api/v1/orders/statuses", { method: "POST", body: { orders } });
export const getOrderComments = (orderId) =>
  requestNcm("/api/v1/order/comment", { query: { id: orderId } });
export const requestOrderReturn = ({ pk, comment }) =>
  requestNcm("/api/v2/vendor/order/return", { method: "POST", body: { pk, comment } });
export const getOrderLabel = (orderId) => requestNcm(`/api/v2/vendor/order/label/${orderId}`);

export { requestNcm };
