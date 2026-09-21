export const normalizePhoneNumber = (value = "") => {
  if (value === null || value === undefined) return "";
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("977") ? digits.slice(3) : digits;
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
  city = "",
  district = "",
  state = "",
  country = "Nepal",
  address = {},
  socialUsername = "",
  source = "Social Media",
  loyaltyTier = "",
  orderId = "",
} = {}) => {
  const normalizedPhone = normalizePhoneNumber(phone);
  const normalizedGender = normalizeGender(gender);
  const inactiveProfileData = {
    firstName: String(firstName || "").trim(),
    lastName: String(lastName || "").trim(),
    email: String(email || "").trim(),
    phone: normalizedPhone,
    gender: normalizedGender,
    city: String(city || address?.city || "").trim(),
    district: String(district || address?.district || "").trim(),
    state: String(state || address?.state || "").trim(),
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
