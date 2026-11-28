export const directOrderReceiptRequiredError = (declaredPaid) => {
  if (declaredPaid === undefined || declaredPaid === null || declaredPaid === false) return null;
  return Object.assign(
    new Error("Payment cannot be marked received until a source-linked receipt is recorded."),
    { statusCode: 409, code: "DIRECT_ORDER_RECEIPT_REQUIRED" },
  );
};
