const CONTROL_ACCOUNT_COVERAGE = [
  { accountCode: "1110", label: "Cash on Hand", source: "Mapped Treasury account balances", status: "TREASURY_REGISTER_ONLY", gap: "No independent cash-count reconciliation is connected." },
  { accountCode: "1120", label: "Bank Accounts", source: "Mapped Treasury account balances", status: "TREASURY_REGISTER_ONLY", gap: "Bank statement import and statement-line matching are not connected." },
  { accountCode: "1130", label: "Accounts Receivable", source: "Legacy AccountReceivable records plus source-scoped collaboration fee invoices", status: "LEGACY_PARTIAL", gap: "Collaboration fee invoices are checked separately; COD, gateway, legacy and other customer receivables are not fully reconciled." },
  { accountCode: "1140", label: "Merchandise Inventory", source: "Inventory balance and movement records", status: "NOT_RECONCILED", gap: "A complete valuation bridge, including uncosted legacy stock, is not connected to the GL control." },
  { accountCode: "1150", label: "Input VAT Receivable", source: "No complete reconciliation source", status: "NOT_RECONCILED", gap: "Tax-credit evidence is not reconciled to the full input VAT GL balance." },
  { accountCode: "1160", label: "Supplier Advances and Prepaids", source: "No complete reconciliation source", status: "NOT_RECONCILED", gap: "Advance and prepaid balances lack a complete account-level reconciliation." },
  { accountCode: "1170", label: "NCM COD Receivable", source: "NCM_COD_SALE accounting documents", status: "SOURCE_SCOPED", gap: "Historical NCM COD and other carrier receivables require migration and reconciliation." },
  { accountCode: "1180", label: "Payment Gateway Clearing", source: "Mapped Treasury account balances", status: "TREASURY_REGISTER_ONLY", gap: "Gateway provider settlement reports are not reconciled to clearing activity." },
  { accountCode: "1190", label: "Distributor COD Receivable", source: "DISTRIBUTOR_COD_SALE accounting documents", status: "SOURCE_SCOPED", gap: "Legacy and non-COD distributor receivables are outside this source check." },
  { accountCode: "1510", label: "Computers and IT Equipment", source: "No fixed-asset subledger connected", status: "NOT_RECONCILED", gap: "Asset acquisition and disposal totals are not reconciled to this GL account." },
  { accountCode: "1520", label: "Furniture and Store Fixtures", source: "No fixed-asset subledger connected", status: "NOT_RECONCILED", gap: "Asset acquisition and disposal totals are not reconciled to this GL account." },
  { accountCode: "1530", label: "Vehicles and Delivery Fleet", source: "No fixed-asset subledger connected", status: "NOT_RECONCILED", gap: "Asset acquisition and disposal totals are not reconciled to this GL account." },
  { accountCode: "1590", label: "Accumulated Depreciation", source: "No depreciation subledger connected", status: "NOT_RECONCILED", gap: "Depreciation schedules are not reconciled to this GL account." },
  { accountCode: "2110", label: "Accounts Payable", source: "Legacy AccountPayable records plus source-scoped platform-funded return and exchange refund AP", status: "LEGACY_PARTIAL", gap: "Current platform-funded return and exchange downgrade refund originals are checked separately; AP settlement clearing, legacy balances, and other manufacturer, carrier, distributor, and partner documents remain incomplete." },
  { accountCode: "2120", label: "Output VAT Payable", source: "Posted sales and return journals", status: "NOT_RECONCILED", gap: "VAT return and payment filings are not reconciled to the full output VAT balance." },
  { accountCode: "2130", label: "Corporate Income Tax and TDS Payable", source: "No complete tax reconciliation source", status: "NOT_RECONCILED", gap: "Tax filings, withholding obligations, and payments lack a full account reconciliation." },
  { accountCode: "2140", label: "Customer Refunds and Advances Payable", source: "Return and exchange workflows; no unified reconciliation", status: "NOT_RECONCILED", gap: "Customer obligations across legacy and current workflows are not unified for reconciliation." },
  { accountCode: "2150", label: "Partner Profit Distributions Payable", source: "No complete reconciliation source", status: "NOT_RECONCILED", gap: "Open distributions and payment records are not fully reconciled to this control." },
  { accountCode: "2160", label: "Manufacturer Payable", source: "Accepted production bills, delivery-recognized legacy costs, and dispatched local-freight bills", status: "NOT_RECONCILED", gap: "Accepted-production and local-freight sources are checked separately; legacy delivery accruals, other payable sources, and historical balances remain unresolved." },
  { accountCode: "2170", label: "Marketing Partner Payable", source: "Marketing CPA and partner settlement records", status: "NOT_RECONCILED", gap: "Accrued commissions and partner settlements are not fully reconciled to this control." },
  { accountCode: "2180", label: "NCM Carrier Payable", source: "NCM carrier-fee accruals, bills, allocations, and remittance journals", status: "SOURCE_SCOPED", gap: "The NCM fee settlement path is checked separately; historical fees and other carrier obligations remain outside this check." },
  { accountCode: "2190", label: "Distributor Payable", source: "DISTRIBUTOR_DELIVERY_EARNING accounting documents", status: "SOURCE_SCOPED", gap: "Refund, bonus, legacy settlement, and other distributor payables are outside this source check." },
  { accountCode: "2510", label: "Bank Term Loans and Credit Facilities", source: "No loan reconciliation source connected", status: "NOT_RECONCILED", gap: "Lender statements, principal schedules, and interest accruals are not reconciled to this control." },
];

export const buildAccountingControlCoverage = ({ accounts = [] } = {}) => {
  const accountsByCode = new Map(accounts.map((account) => [String(account.accountCode), account]));
  const rows = CONTROL_ACCOUNT_COVERAGE.map((control) => {
    const account = accountsByCode.get(control.accountCode);
    return {
      ...control,
      label: account?.accountName || control.label,
      accountId: account?.id || null,
      accountExists: Boolean(account),
      glBalance: Number(account?.currentBalance || 0),
      status: account ? control.status : "ACCOUNT_MISSING",
      gap: account ? control.gap : "The expected control account is missing from the chart of accounts.",
    };
  });
  const unreconciledCount = rows.filter((row) => row.status !== "COMPLETE").length;

  return {
    coverageStatus: unreconciledCount === 0 ? "COMPLETE" : "PARTIAL",
    controlAccountCount: rows.length,
    unreconciledCount,
    controls: rows,
  };
};
