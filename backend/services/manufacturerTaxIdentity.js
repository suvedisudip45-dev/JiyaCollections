const fail = (message) => Object.assign(new Error(message), { statusCode: 400, code: "INVALID_MANUFACTURER_TAX_ID" });

export const normalizeManufacturerTaxIdentity = ({ taxIdType, taxIdNumber } = {}) => {
  const type = String(taxIdType ?? "").trim().toUpperCase();
  const number = String(taxIdNumber ?? "").trim();
  if (!["PAN", "VAT"].includes(type)) {
    throw fail("Choose whether the manufacturer tax registration is PAN or VAT.");
  }
  if (!/^\d{9}$/.test(number)) {
    throw fail("Manufacturer PAN/VAT number must contain exactly 9 digits.");
  }
  return { taxIdType: type, taxIdNumber: number };
};

export const hasValidVatSupplierIdentity = (manufacturer) =>
  manufacturer?.taxIdType === "VAT" && /^\d{9}$/.test(String(manufacturer?.taxIdNumber ?? ""));
