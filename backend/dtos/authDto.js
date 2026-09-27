export const serializeLoginResponse = ({ token, accessToken, refreshTokenExpiresAt, account }) => ({
  success: true,
  message: "Authentication successful",
  token: accessToken || token,
  accessToken: accessToken || token,
  refreshTokenExpiresAt,
  account: {
    id: account.id,
    email: account.email,
    phone: account.phone,
    role: account.role,
    status: account.status,
  },
});

export const serializeSessionProfile = (account) => {
  const safeAccount = {
    id: account.id,
    email: account.email,
    phone: account.phone,
    role: account.role,
    status: account.status,
  };
  const sourceProfile = account.role === "ADMIN"
    ? account.adminProfile
    : account.role === "MANUFACTURER"
      ? account.manufacturerProfile
      : account.role === "MARKETING_PARTNER"
        ? account.marketingPartnerProfile
        : account.customerProfile;
  const profileFields = account.role === "ADMIN"
    ? ["id", "email", "phone"]
    : account.role === "MANUFACTURER"
      ? ["id", "email", "phone", "name", "pickupAddress", "pickupContactName", "pickupContactPhone", "pickupWindow", "returnInstructions"]
      : account.role === "MARKETING_PARTNER"
        ? ["id", "email", "phone", "name", "status"]
        : ["id", "email", "phone", "name", "firstName", "lastName", "socialCustomerCode", "gender", "addresses"];
  const profile = sourceProfile
    ? Object.fromEntries(profileFields.filter((field) => sourceProfile[field] !== undefined).map((field) => [field, sourceProfile[field]]))
    : { id: account.id, email: account.email, phone: account.phone };
  if (account.role === "MANUFACTURER") profile.businessName = profile.name || "";

  const profileAlias = account.role === "CUSTOMER"
    ? { user: profile }
    : account.role === "MANUFACTURER"
      ? { manufacturer: profile }
      : account.role === "MARKETING_PARTNER"
        ? { partner: profile }
        : {};

  return { success: true, account: safeAccount, profile, role: account.role, ...profileAlias };
};
