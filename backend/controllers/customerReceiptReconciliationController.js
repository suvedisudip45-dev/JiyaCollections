import { getCustomerReceiptReconciliation } from "../services/customerReceiptReconciliationService.js";

export const getCustomerReceiptReconciliationReport = async (req, res) => {
  try {
    const report = await getCustomerReceiptReconciliation({ query: req.query });
    return res.json({ success: true, ...report });
  } catch (error) {
    console.error("Customer receipt reconciliation failed:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code || "CUSTOMER_RECEIPT_RECONCILIATION_FAILED",
      message: error.message || "Customer receipt reconciliation could not be completed.",
    });
  }
};
