const PARTY_CONTROL_ACCOUNTS = {
  "RECEIVABLE:NCM_COD_SALE": { accountCode: "1170", label: "NCM COD receivable" },
  "RECEIVABLE:DISTRIBUTOR_COD_SALE": { accountCode: "1190", label: "Distributor COD receivable" },
  "PAYABLE:NCM_CARRIER_FEE": { accountCode: "2180", label: "NCM carrier payable" },
  "PAYABLE:DISTRIBUTOR_DELIVERY_EARNING": { accountCode: "2190", label: "Distributor delivery payable" },
};

export const buildPartySubledgerReconciliation = ({ documentGroups = [], accounts = [] } = {}) => {
  const balancesByCode = new Map(accounts.map((account) => [
    String(account.accountCode),
    Number(account.currentBalance || 0),
  ]));

  return Object.entries(PARTY_CONTROL_ACCOUNTS).map(([key, control]) => {
    const [side, sourceType] = key.split(":");
    const group = documentGroups.find((item) => item.side === side && item.sourceType === sourceType);
    const subledgerTotal = Number(group?._sum?.remainingAmount || 0);
    const glControlBalance = balancesByCode.get(control.accountCode) || 0;
    const variance = Number((glControlBalance - subledgerTotal).toFixed(2));
    return {
      side,
      sourceType,
      label: control.label,
      controlAccountCode: control.accountCode,
      glControlBalance,
      subledgerTotal: Number(subledgerTotal.toFixed(2)),
      documentCount: Number(group?._count?._all || 0),
      variance,
      isReconciled: Math.abs(variance) <= 0.05,
      coverageStatus: "SOURCE_SCOPED",
    };
  });
};
