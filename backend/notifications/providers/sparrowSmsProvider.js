import { NotificationProviderError } from "../providerError.js";

const SPARROW_ERRORS = {
  1000: { category: "PERMANENT", message: "Sparrow rejected a request with missing fields." },
  1001: { category: "CONFIGURATION", message: "Sparrow rejected the sending IP configuration." },
  1002: { category: "CONFIGURATION", message: "Sparrow rejected the configured token." },
  1003: { category: "CONFIGURATION", message: "The Sparrow account is inactive." },
  1004: { category: "CONFIGURATION", message: "The Sparrow account is inactive." },
  1005: { category: "CONFIGURATION", message: "The Sparrow account has expired." },
  1006: { category: "CONFIGURATION", message: "The Sparrow account has expired." },
  1007: { category: "PERMANENT", message: "Sparrow rejected the recipient number." },
  1008: { category: "PERMANENT", message: "Sparrow rejected the sender identity." },
  1010: { category: "PERMANENT", message: "Sparrow rejected an empty message." },
  1011: { category: "PERMANENT", message: "Sparrow found no valid recipient." },
  1012: { category: "INSUFFICIENT_CREDIT", message: "The Sparrow account has no SMS credits." },
  1013: { category: "INSUFFICIENT_CREDIT", message: "The Sparrow account has insufficient SMS credits." },
};

const retryableCategories = new Set(["TRANSIENT", "RATE_LIMIT", "TIMEOUT"]);

const normalizeErrorCode = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
};

const readProviderBody = async (response) => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const assertHttps = (url) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new NotificationProviderError("Sparrow SMS URL is invalid.", {
      code: "SPARROW_URL_INVALID",
      category: "CONFIGURATION",
    });
  }
  if (parsed.protocol !== "https:") {
    throw new NotificationProviderError("Sparrow SMS requires HTTPS; request was not sent.", {
      code: "SPARROW_HTTPS_REQUIRED",
      category: "CONFIGURATION",
    });
  }
  return parsed;
};

export const classifySparrowError = (providerCode, httpStatus = null) => {
  const code = normalizeErrorCode(providerCode);
  if (SPARROW_ERRORS[code]) {
    return { code: String(code), ...SPARROW_ERRORS[code], retryable: retryableCategories.has(SPARROW_ERRORS[code].category) };
  }
  if (httpStatus === 429) {
    return { code: "HTTP_429", category: "RATE_LIMIT", retryable: true, message: "Sparrow rate-limited the request." };
  }
  if (httpStatus >= 500) {
    return { code: `HTTP_${httpStatus}`, category: "TRANSIENT", retryable: true, message: "Sparrow is temporarily unavailable." };
  }
  if (httpStatus && httpStatus >= 400) {
    return { code: `HTTP_${httpStatus}`, category: "PERMANENT", retryable: false, message: "Sparrow rejected the request." };
  }
  return { code: "SPARROW_UNKNOWN", category: "UNKNOWN", retryable: false, message: "Sparrow returned an unrecognized response." };
};

export const createSparrowSmsProvider = ({ config, fetchImpl = globalThis.fetch }) => {
  const send = async ({ to, text }) => {
    if (!config.enabled) {
      throw new NotificationProviderError("SMS sending is disabled.", { code: "SMS_DISABLED", category: "CONFIGURATION" });
    }
    const endpoint = assertHttps(config.baseUrl);
    if (typeof fetchImpl !== "function") {
      throw new NotificationProviderError("Fetch is unavailable in this Node.js runtime.", { code: "FETCH_UNAVAILABLE", category: "CONFIGURATION" });
    }
    if (!String(to || "").trim() || !String(text || "").trim()) {
      throw new NotificationProviderError("SMS recipient and text are required.", { code: "SMS_INPUT_INVALID", category: "PERMANENT" });
    }

    const form = new FormData();
    form.set("token", config.token);
    form.set("from", config.sender);
    form.set("to", String(to).trim());
    form.set("text", String(text));

    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
      throw new NotificationProviderError(timedOut ? "Sparrow request timed out; provider acceptance is unknown." : "Sparrow could not be reached.", {
        code: timedOut ? "SPARROW_TIMEOUT" : "SPARROW_NETWORK_ERROR",
        category: timedOut ? "TIMEOUT" : "TRANSIENT",
        retryable: !timedOut,
      });
    }

    const body = await readProviderBody(response);
    const providerCode = body?.response_code;
    if (!response.ok || Number(providerCode) !== 200) {
      const failure = classifySparrowError(providerCode, response.status);
      throw new NotificationProviderError(failure.message, {
        code: failure.code,
        category: failure.category,
        retryable: failure.retryable,
        httpStatus: response.status,
      });
    }

    return {
      provider: "SPARROW",
      status: "ACCEPTED",
      providerMessageId: body?.message_id ? String(body.message_id) : null,
      providerStatus: "QUEUED",
    };
  };

  const getCredits = async () => {
    if (!config.enabled) {
      throw new NotificationProviderError("SMS provider is disabled.", { code: "SMS_DISABLED", category: "CONFIGURATION" });
    }
    const endpoint = assertHttps(config.baseUrl);
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "").replace(/\/sms$/i, "")}/credit/`;
    endpoint.search = "";
    endpoint.searchParams.set("token", config.token);

    let response;
    try {
      response = await fetchImpl(endpoint, { method: "GET", signal: AbortSignal.timeout(config.timeoutMs) });
    } catch (error) {
      const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
      throw new NotificationProviderError("Sparrow credit lookup failed.", {
        code: timedOut ? "SPARROW_CREDIT_TIMEOUT" : "SPARROW_CREDIT_NETWORK_ERROR",
        category: timedOut ? "TIMEOUT" : "TRANSIENT",
        retryable: !timedOut,
      });
    }
    const body = await readProviderBody(response);
    if (!response.ok || Number(body?.response_code) !== 200) {
      const failure = classifySparrowError(body?.response_code, response.status);
      throw new NotificationProviderError(failure.message, {
        code: failure.code,
        category: failure.category,
        retryable: failure.retryable,
        httpStatus: response.status,
      });
    }
    return {
      creditsAvailable: Number(body.credits_available),
      creditsConsumed: Number(body.credits_consumed),
    };
  };

  return { send, getCredits };
};
