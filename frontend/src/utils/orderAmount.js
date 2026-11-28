export const roundOrderTotal = (value) => {
  const wholeAmount = Math.round(Number(value));
  const tens = Math.floor(wholeAmount / 10) * 10;
  const lastDigit = wholeAmount - tens;

  if (lastDigit <= 3) return tens;
  if (lastDigit <= 7) return tens + 5;
  return tens + 10;
};
