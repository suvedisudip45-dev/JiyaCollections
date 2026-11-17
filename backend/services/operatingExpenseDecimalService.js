import { Prisma } from "@prisma/client";
import {
  accountingDecimal,
  addDecimals,
  assertFitsDatabaseDecimal,
  divideDecimals,
  multiplyDecimals,
  parseNprAmountString,
  quantizeNprAmount,
  subtractDecimals,
} from "./accountingDecimal.js";

const ROUNDING_MODE = Prisma.Decimal.ROUND_HALF_EVEN;
const DIVISION_PRECISION = 80;

export const normalizeExpenseAmount = (value, fieldName = "Expense amount") =>
  parseNprAmountString(value, fieldName, { allowZero: false });

export const calculateOperatingExpenseVat = ({
  amount,
  isVatBill,
  vatAmount,
  purchaseVatRate,
}) => {
  const grossAmount = accountingDecimal(amount, "Expense amount");
  if (!isVatBill) return new Prisma.Decimal(0);

  if (vatAmount !== undefined && vatAmount !== null && vatAmount !== "") {
    const enteredVat = parseNprAmountString(vatAmount, "VAT amount");
    if (enteredVat.greaterThan(grossAmount)) {
      throw Object.assign(new Error("VAT amount cannot exceed the total supplier invoice amount."), {
        code: "VAT_EXCEEDS_GROSS",
      });
    }
    return enteredVat;
  }

  const rate = accountingDecimal(purchaseVatRate, "Supplier invoice VAT rate");
  assertFitsDatabaseDecimal(rate, { precision: 5, scale: 2 });
  if (!rate.isPositive() || rate.greaterThan(100)) {
    throw Object.assign(new Error("Enter the VAT rate printed on the supplier invoice."), {
      code: "INVALID_PURCHASE_VAT_RATE",
    });
  }
  const rateRatio = divideDecimals(rate, "100", {
    significantDigits: DIVISION_PRECISION,
    roundingMode: ROUNDING_MODE,
  });
  const inclusiveDivisor = addDecimals("1", rateRatio);
  const taxableAmount = divideDecimals(grossAmount, inclusiveDivisor, {
    significantDigits: DIVISION_PRECISION,
    roundingMode: ROUNDING_MODE,
  });
  return quantizeNprAmount(subtractDecimals(grossAmount, taxableAmount));
};

export const getOperatingExpenseTaxableAmount = (grossAmount, vatAmount) => {
  const taxableAmount = subtractDecimals(grossAmount, vatAmount);
  if (taxableAmount.isNegative()) {
    throw Object.assign(new Error("VAT amount cannot exceed the total supplier invoice amount."), {
      code: "VAT_EXCEEDS_GROSS",
    });
  }
  return assertFitsDatabaseDecimal(quantizeNprAmount(taxableAmount), {
    precision: 20,
    scale: 2,
  });
};

export const sumOperatingExpenseAmounts = (amounts) =>
  quantizeNprAmount(addDecimals(...amounts));

export const calculateSupplierReturnLineTotal = (unitCost, quantity) =>
  multiplyDecimals(accountingDecimal(unitCost), accountingDecimal(String(quantity)));
