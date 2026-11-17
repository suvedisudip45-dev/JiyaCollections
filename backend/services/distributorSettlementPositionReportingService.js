import {
  accountingDecimal,
  addDecimals,
  compareDecimals,
  subtractDecimals,
} from "./accountingDecimal.js";

const amountString = (value) => accountingDecimal(value).toFixed(2);
const nonNegative = (value) => compareDecimals(value, "0") > 0
  ? accountingDecimal(value)
  : accountingDecimal("0");

export const buildDistributorSettlementPositionReport = ({
  distributors = [],
  parties = [],
  documents = [],
  returns = [],
  exchanges = [],
  legacyPayables = [],
  pendingRemittances = [],
} = {}) => {
  const partyIdToDistributorId = new Map(
    parties.map((party) => [party.id, party.sourceEntityId]),
  );
  const legacyRequestDistributor = new Map();
  for (const request of returns) {
    legacyRequestDistributor.set(`RETURN_LOGISTICS_SETTLEMENT:${request.id}`, request.distributorId);
  }
  for (const request of exchanges) {
    legacyRequestDistributor.set(`EXCHANGE_LOGISTICS_SETTLEMENT:${request.id}`, request.distributorId);
  }

  const zero = () => accountingDecimal("0");
  const positions = new Map(distributors.map(({ id }) => [id, {
    receivable: zero(),
    payable: zero(),
    legacyLogisticsPayable: zero(),
    pendingRemittance: zero(),
  }]));
  for (const document of documents) {
    const distributorId = partyIdToDistributorId.get(document.partyId);
    const position = positions.get(distributorId);
    if (!position) continue;
    const amount = accountingDecimal(document.remainingAmount ?? "0");
    if (document.side === "RECEIVABLE") {
      position.receivable = addDecimals(position.receivable, amount);
    }
    if (document.side === "PAYABLE") {
      position.payable = addDecimals(position.payable, amount);
    }
  }
  for (const payable of legacyPayables) {
    const distributorId = legacyRequestDistributor.get(`${payable.referenceType}:${payable.referenceId}`);
    const position = positions.get(distributorId);
    if (!position) continue;
    const amount = accountingDecimal(payable.remainingBalance ?? "0");
    position.payable = addDecimals(position.payable, amount);
    position.legacyLogisticsPayable = addDecimals(position.legacyLogisticsPayable, amount);
  }
  for (const remittance of pendingRemittances) {
    const position = positions.get(remittance.distributorId);
    if (position) {
      position.pendingRemittance = accountingDecimal(remittance.amount ?? "0");
    }
  }

  const rows = distributors.map((distributor) => {
    const position = positions.get(distributor.id);
    const netBalance = subtractDecimals(position.receivable, position.payable);
    return {
      ...distributor,
      outstandingReceivable: amountString(position.receivable),
      outstandingPayable: amountString(position.payable),
      netBalance: amountString(netBalance),
      companyCollects: amountString(nonNegative(netBalance)),
      companyPays: amountString(nonNegative(subtractDecimals("0", netBalance))),
      pendingRemittance: amountString(position.pendingRemittance),
      legacyLogisticsPayable: amountString(position.legacyLogisticsPayable),
    };
  });

  const totals = rows.reduce((result, row) => {
    result.outstandingReceivable = addDecimals(result.outstandingReceivable, row.outstandingReceivable);
    result.outstandingPayable = addDecimals(result.outstandingPayable, row.outstandingPayable);
    result.pendingRemittance = addDecimals(result.pendingRemittance, row.pendingRemittance);
    result.legacyLogisticsPayable = addDecimals(result.legacyLogisticsPayable, row.legacyLogisticsPayable);
    result.companyCollects = addDecimals(result.companyCollects, row.companyCollects);
    result.companyPays = addDecimals(result.companyPays, row.companyPays);
    return result;
  }, {
    outstandingReceivable: zero(),
    outstandingPayable: zero(),
    pendingRemittance: zero(),
    legacyLogisticsPayable: zero(),
    companyCollects: zero(),
    companyPays: zero(),
  });

  return {
    rows,
    totals: {
      distributorCount: rows.length,
      outstandingReceivable: amountString(totals.outstandingReceivable),
      outstandingPayable: amountString(totals.outstandingPayable),
      companyCollects: amountString(totals.companyCollects),
      companyPays: amountString(totals.companyPays),
      pendingRemittance: amountString(totals.pendingRemittance),
      legacyLogisticsPayable: amountString(totals.legacyLogisticsPayable),
    },
  };
};
