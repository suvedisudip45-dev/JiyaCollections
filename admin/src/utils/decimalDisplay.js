const parseDecimalParts = (value) => {
  const text = String(value ?? "0").trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new TypeError("Amount must be a plain decimal value.");
  const fraction = match[3] || "";
  const coefficient = BigInt(`${match[2]}${fraction}`) * (match[1] ? -1n : 1n);
  return { coefficient, scale: fraction.length };
};

const formatDecimalParts = (coefficient, scale) => {
  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, "0");
  const integer = scale ? digits.slice(0, -scale) : digits;
  const fraction = scale ? digits.slice(-scale).replace(/0+$/, "") : "";
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
};

const alignScales = (left, right) => {
  const scale = Math.max(left.scale, right.scale);
  return {
    scale,
    left: left.coefficient * (10n ** BigInt(scale - left.scale)),
    right: right.coefficient * (10n ** BigInt(scale - right.scale)),
  };
};

export const compareDecimalStrings = (leftValue, rightValue) => {
  const { left, right } = alignScales(parseDecimalParts(leftValue), parseDecimalParts(rightValue));
  return left < right ? -1 : left > right ? 1 : 0;
};

export const maxZeroDecimalString = (value) => {
  const amount = String(value ?? "0");
  return compareDecimalStrings(amount, "0") > 0 ? amount : "0";
};

export const minDecimalStrings = (leftValue, rightValue) =>
  compareDecimalStrings(leftValue, rightValue) <= 0 ? String(leftValue) : String(rightValue);

export const roundedPercentFromDecimalStrings = (partValue, totalValue) => {
  const { left, right } = alignScales(parseDecimalParts(partValue), parseDecimalParts(totalValue));
  if (right === 0n) return "0";
  let numerator = left * 100n;
  let denominator = right;
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const negative = numerator < 0n;
  const absoluteNumerator = negative ? -numerator : numerator;
  const rounded = absoluteNumerator / denominator +
    ((absoluteNumerator % denominator) * 2n >= denominator ? 1n : 0n);
  return `${negative ? "-" : ""}${rounded}`;
};

export const addDecimalStrings = (...values) => {
  const parts = values.map(parseDecimalParts);
  const scale = Math.max(0, ...parts.map(({ scale: itemScale }) => itemScale));
  const sum = parts.reduce(
    (total, part) => total + part.coefficient * (10n ** BigInt(scale - part.scale)),
    0n,
  );
  return formatDecimalParts(sum, scale);
};

export const subtractDecimalStrings = (leftValue, rightValue) => {
  const right = parseDecimalParts(rightValue);
  return addDecimalStrings(leftValue, formatDecimalParts(-right.coefficient, right.scale));
};

export const multiplyDecimalStringByInteger = (value, integerValue) => {
  const integer = String(integerValue);
  if (!/^\d+$/.test(integer) || BigInt(integer) <= 0n) {
    throw new TypeError("Quantity must be a positive whole number.");
  }
  const amount = parseDecimalParts(value);
  return formatDecimalParts(amount.coefficient * BigInt(integer), amount.scale);
};

export const formatNprAmount = (value) => {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    return "0.00";
  }

  let parts;
  try {
    parts = parseDecimalParts(value);
  } catch {
    return String(value);
  }
  const scale = Math.max(2, parts.scale);
  const coefficient = parts.coefficient * (10n ** BigInt(scale - parts.scale));
  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, "0");
  const integer = digits.slice(0, -scale);
  const fraction = digits.slice(-scale);
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}.${fraction}`;
};
