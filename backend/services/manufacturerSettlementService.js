import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";

const roundAmount = (value) => Number(new Prisma.Decimal(String(value || 0)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP));
const isManufacturerLine = (line, manufacturer) =>
  line.supplierId === manufacturer.id ||
  (line.accountingParty?.partyType === "MANUFACTURER" && line.accountingParty.sourceEntityId === manufacturer.id) ||
  String(line.supplierName || "").trim().toLowerCase() === manufacturer.name.trim().toLowerCase();

export const getManufacturerSettlementSummary = async (manufacturerId, { client = prisma } = {}) => {
  const manufacturer = await client.manufacturer.findUnique({
    where: { id: manufacturerId },
    select: { id: true, name: true },
  });
  if (!manufacturer) return null;

  const [completedRequests, settlements, settlementTotals, payableAccount] = await Promise.all([
    client.manufacturerProductionRequest.findMany({
      where: { manufacturerId, status: "COMPLETED" },
      select: {
        approvedUnitCogs: true,
        lines: { select: { actualQuantity: true, damagedQuantity: true, quantity: true } },
      },
    }),
    client.manufacturerSettlementRequest.findMany({
      where: { manufacturerId },
      orderBy: { requestedAt: "desc" },
      take: 100,
    }),
    client.manufacturerSettlementRequest.groupBy({
      by: ["status", "requestType"],
      where: { manufacturerId },
      _sum: { amount: true },
    }),
    client.account.findUnique({ where: { accountCode: "2160" }, select: { id: true } }),
  ]);

  let recognizedProductionValue = 0;
  for (const request of completedRequests) {
    const goodUnits = request.lines.reduce((total, line) =>
      total + Math.max(0, Number(line.actualQuantity ?? line.quantity) - Number(line.damagedQuantity || 0)), 0);
    recognizedProductionValue += Number(request.approvedUnitCogs || 0) * goodUnits;
  }

  const accountingLines = payableAccount
    ? await client.journalLine.findMany({
        where: { accountId: payableAccount.id },
        select: {
          debit: true,
          credit: true,
          supplierId: true,
          supplierName: true,
          accountingParty: { select: { partyType: true, sourceEntityId: true } },
          journalEntry: { select: { sourceType: true } },
        },
      })
    : [];
  let productionRecognized = 0;
  let logisticsRecognized = 0;
  let totalPaid = 0;
  for (const line of accountingLines) {
    if (!isManufacturerLine(line, manufacturer)) continue;
    const sourceType = line.journalEntry?.sourceType;
    const netPayable = Number(line.credit || 0) - Number(line.debit || 0);
    if (sourceType === "MANUFACTURER_PRODUCTION") productionRecognized += netPayable;
    if (sourceType === "MANUFACTURER_LOGISTICS") logisticsRecognized += netPayable;
    if (sourceType === "SUPPLIER_PAYMENT") totalPaid -= netPayable;
  }
  const settlementTotal = (status, requestType) => Number(
    settlementTotals.find((entry) => entry.status === status && entry.requestType === requestType)?._sum.amount || 0
  );
  const pendingProduction = settlementTotal("PENDING", "PRODUCTION");
  const pendingLogistics = settlementTotal("PENDING", "LOGISTICS");
  const settlementPaidProduction = settlementTotal("PAID", "PRODUCTION");
  const settlementPaidLogistics = settlementTotal("PAID", "LOGISTICS");
  const nonSettlementPaid = Math.max(0, totalPaid - settlementPaidProduction - settlementPaidLogistics);
  const productionOutstanding = Math.max(0, productionRecognized - settlementPaidProduction - nonSettlementPaid);
  const logisticsOutstanding = Math.max(0, logisticsRecognized - settlementPaidLogistics);
  const completedPayments = settlementPaidProduction + settlementPaidLogistics;

  return {
    manufacturer,
    totalManufacturedGoodsValue: roundAmount(recognizedProductionValue),
    logisticsReimbursements: roundAmount(logisticsRecognized),
    pendingSettlementAmount: roundAmount(pendingProduction + pendingLogistics),
    completedPayments: roundAmount(completedPayments),
    outstandingPayable: roundAmount(Math.max(0, productionOutstanding + logisticsOutstanding)),
    productionOutstanding: roundAmount(productionOutstanding),
    logisticsOutstanding: roundAmount(logisticsOutstanding),
    productionPayableAvailable: roundAmount(Math.max(0, productionOutstanding - pendingProduction)),
    logisticsPayableAvailable: roundAmount(Math.max(0, logisticsOutstanding - pendingLogistics)),
    settlements,
  };
};

export const normalizeSettlementRequest = ({ requestType, amount, notes }) => {
  const type = String(requestType || "PRODUCTION").trim().toUpperCase();
  const normalizedAmount = new Prisma.Decimal(String(amount ?? ""));
  const normalizedNotes = String(notes || "").trim();
  if (!["PRODUCTION", "LOGISTICS"].includes(type)) {
    throw Object.assign(new Error("Settlement type must be PRODUCTION or LOGISTICS."), { statusCode: 400 });
  }
  if (!normalizedAmount.isFinite() || !normalizedAmount.greaterThan(0)) {
    throw Object.assign(new Error("Settlement amount must be a positive valid amount."), { statusCode: 400 });
  }
  if (normalizedNotes.length > 2000) {
    throw Object.assign(new Error("Settlement notes cannot exceed 2000 characters."), { statusCode: 400 });
  }
  return {
    requestType: type,
    amount: normalizedAmount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    notes: normalizedNotes || null,
  };
};
