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

export const subtractDecimalStrings = (leftValue, rightValue) => {
  const left = parseDecimalParts(leftValue);
  const right = parseDecimalParts(rightValue);
  const { scale, left: alignedLeft, right: alignedRight } = alignScales(left, right);
  return formatDecimalParts(alignedLeft - alignedRight, scale);
};

export const absoluteDecimalString = (value) => {
  const { coefficient, scale } = parseDecimalParts(value);
  return formatDecimalParts(coefficient < 0n ? -coefficient : coefficient, scale);
};

export const formatNprAmount = (value) => {
  const parts = parseDecimalParts(value);
  const normalized = formatDecimalParts(parts.coefficient, Math.max(2, parts.scale));
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [integer, fraction = ""] = unsigned.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}.${fraction.padEnd(2, "0")}`;
};
