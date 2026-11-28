export const buildProfitDistributionEstimate = ({
  periodStart,
  periodEnd,
  fiscalYear,
  retainedEarningsPercentage,
  grossRevenue,
  cogs,
  operatingExpenses,
  calculationBasis,
  partners,
}) => {
  const netProfit = Math.max(0, grossRevenue - cogs - operatingExpenses);
  const retainedAmount = Number(((netProfit * retainedEarningsPercentage) / 100).toFixed(2));
  const distributableAmount = Number((netProfit - retainedAmount).toFixed(2));
  const partnerBreakdown = partners.map((partner) => ({
    partnerId: partner.id,
    name: partner.partnerName,
    percentage: partner.ownershipPercentage,
    amount: Number(((distributableAmount * Number(partner.ownershipPercentage)) / 100).toFixed(2)),
  }));

  return {
    periodStart,
    periodEnd,
    fiscalYear: fiscalYear || null,
    calculationBasis,
    grossRevenue: Number(grossRevenue.toFixed(2)),
    cogs: Number(cogs.toFixed(2)),
    operatingExpenses: Number(operatingExpenses.toFixed(2)),
    netProfit: Number(netProfit.toFixed(2)),
    retainedEarningsPercentage,
    retainedAmount,
    distributableAmount,
    partnerBreakdown,
    limitations: [
      "This estimate is not a declaration of partner distributions or a statutory profit calculation.",
      "Its source completeness, tax treatment, return treatment, and distribution policy have not been independently approved or reconciled.",
    ],
  };
};
