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
    primaryRole: account.primaryRole || account.role,
    availableWorkspaces: account.availableWorkspaces || [],
    status: account.status,
    mustChangePassword: Boolean(account.mustChangePassword),
  },
});

export const serializeSessionProfile = (account, activeRole = account.role) => {
  const safeAccount = {
    id: account.id,
    email: account.email,
    phone: account.phone,
    role: activeRole,
    primaryRole: account.role,
    availableWorkspaces: account.availableWorkspaces || [],
    status: account.status,
    mustChangePassword: Boolean(account.mustChangePassword),
  };
  const sourceProfile = activeRole === "ADMIN"
    ? account.adminProfile
    : activeRole === "MANUFACTURER"
      ? account.manufacturerProfile
      : activeRole === "DISTRIBUTOR"
        ? account.distributorProfile
        : activeRole === "MARKETING_PARTNER"
        ? account.marketingPartnerProfile
        : account.customerProfile;
  const profileFields = activeRole === "ADMIN"
    ? ["id", "email", "phone", "displayName", "firstName", "lastName"]
    : activeRole === "MANUFACTURER"
      ? ["id", "email", "phone", "name", "pickupAddress", "pickupContactName", "pickupContactPhone", "pickupWindow", "returnInstructions"]
      : activeRole === "DISTRIBUTOR"
        ? ["id", "email", "phone", "name", "address", "city", "status"]
        : activeRole === "MARKETING_PARTNER"
        ? ["id", "email", "phone", "name", "status"]
        : ["id", "email", "phone", "name", "firstName", "lastName", "socialCustomerCode", "gender", "addresses"];
  const profile = sourceProfile
    ? Object.fromEntries(profileFields.filter((field) => sourceProfile[field] !== undefined).map((field) => [field, sourceProfile[field]]))
    : { id: account.id, email: account.email, phone: account.phone };
  if (activeRole === "MANUFACTURER" || activeRole === "DISTRIBUTOR") profile.businessName = profile.name || "";

  const profileAlias = activeRole === "CUSTOMER"
    ? { user: profile }
    : activeRole === "MANUFACTURER"
      ? { manufacturer: profile }
      : activeRole === "DISTRIBUTOR"
        ? { distributor: profile }
        : activeRole === "MARKETING_PARTNER"
        ? { partner: profile }
        : {};

  return { success: true, account: safeAccount, profile, role: activeRole, ...profileAlias };
};
