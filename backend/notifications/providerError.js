export class NotificationProviderError extends Error {
  constructor(message, { code, category, retryable = false, httpStatus = null } = {}) {
    super(message);
    this.name = "NotificationProviderError";
    this.code = code || "PROVIDER_ERROR";
    this.category = category || "UNKNOWN";
    this.retryable = retryable;
    this.httpStatus = httpStatus;
  }
}
