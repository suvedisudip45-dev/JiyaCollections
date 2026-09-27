import { Prisma } from "@prisma/client";

const amountFrom = (value, fieldName) => {
  let amount;
  try {
    amount = new Prisma.Decimal(String(value ?? 0));
  } catch {
    throw new Error(`${fieldName} must be a valid decimal amount.`);
  }

  if (!amount.isFinite()) throw new Error(`${fieldName} must be a finite decimal amount.`);
  if (amount.isNegative()) throw new Error(`${fieldName} cannot be negative.`);
  return amount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
};

export const normalizeBalancedJournalLines = (lines = []) => {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new Error("Double-entry journal must contain at least 2 lines.");
  }

  const processedLines = [];
  let totalDebit = new Prisma.Decimal(0);
  let totalCredit = new Prisma.Decimal(0);

  for (const line of lines) {
    const debit = amountFrom(line.debit, "Debit");
    const credit = amountFrom(line.credit, "Credit");

    if (debit.greaterThan(0) && credit.greaterThan(0)) {
      throw new Error("Journal line cannot contain both debit and credit amounts.");
    }
    if (debit.isZero() && credit.isZero()) continue;

    totalDebit = totalDebit.plus(debit);
    totalCredit = totalCredit.plus(credit);
    processedLines.push({ ...line, debit, credit });
  }

  if (processedLines.length < 2) {
    throw new Error("Journal entry must have at least 2 non-zero lines.");
  }
  if (!totalDebit.equals(totalCredit)) {
    throw new Error(`Unbalanced Journal Entry: Total Debits (Rs ${totalDebit.toFixed(2)}) does not equal Total Credits (Rs ${totalCredit.toFixed(2)}).`);
  }

  return { lines: processedLines, totalDebit, totalCredit };
};