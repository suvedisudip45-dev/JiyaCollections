export const sanitizePhoneNumber = (value = "") => {
  if (value === null || value === undefined) return "";

  const raw = String(value).trim();
  if (!raw) return "";

  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";

  digits = digits.replace(/^0+/, "");
  digits = digits.replace(/^977/, "");

  return digits.length === 10 ? digits : "";
};

export const normalizePhoneNumber = (value = "") => sanitizePhoneNumber(value);

export const isValidMobileNumber = (value = "") => {
  const normalized = sanitizePhoneNumber(value);
  if (!normalized || normalized.length !== 10) return false;
  return /^9[78]\d{8}$/.test(normalized);
};

export const normalizeGender = (value = "") => {
  const normalized = String(value || "").trim().toUpperCase();
  return ["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"].includes(normalized)
    ? normalized
    : "PREFER_NOT_TO_SAY";
};

export const generateSocialCustomerCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
};

export const buildInactiveSocialProfile = ({
  firstName = "",
  lastName = "",
  phone = "",
  email = "",
  gender = "",
  province = "",
  city = "",
  district = "",
  state = "",
  country = "Nepal",
  address = {},
  socialUsername = "",
  source = "Social Media",
  loyaltyTier = "",
  orderId = "",
  ncmBranch = "",
} = {}) => {
  const normalizedPhone = normalizePhoneNumber(phone);
  const normalizedGender = normalizeGender(gender);
  const inactiveProfileData = {
    firstName: String(firstName || "").trim(),
    lastName: String(lastName || "").trim(),
    email: String(email || "").trim(),
    phone: normalizedPhone,
    gender: normalizedGender,
    province: String(province || address?.province || state || "").trim(),
    city: String(city || address?.city || ncmBranch || "").trim(),
    district: String(district || address?.district || "").trim(),
    ncmBranch: String(ncmBranch || address?.ncmBranch || city || "").trim(),
    state: String(state || address?.state || province || "").trim(),
    country: String(country || address?.country || "Nepal").trim() || "Nepal",
    socialUsername: String(socialUsername || "").trim(),
    source: String(source || "Social Media").trim() || "Social Media",
    orderId: String(orderId || "").trim(),
    loyaltyTier: String(loyaltyTier || "").trim(),
    createdAt: new Date().toISOString(),
  };

  return {
    socialCustomerCode: generateSocialCustomerCode(),
    phone: normalizedPhone,
    gender: normalizedGender,
    isInactiveProfile: true,
    loyaltyTier: String(loyaltyTier || "").trim(),
    inactiveProfileData,
  };
};
