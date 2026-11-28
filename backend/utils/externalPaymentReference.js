export const requireExternalPaymentReference = (value) => {
  if (typeof value !== "string") {
    throw Object.assign(new Error("External bank or payment-provider reference is required."), {
      statusCode: 400,
      code: "EXTERNAL_PAYMENT_REFERENCE_REQUIRED",
    });
  }
  const reference = value.trim();
  if (!reference || reference.length > 191) {
    throw Object.assign(new Error("External bank or payment-provider reference must be 1 to 191 characters."), {
      statusCode: 400,
      code: "INVALID_EXTERNAL_PAYMENT_REFERENCE",
    });
  }
  return reference;
};
