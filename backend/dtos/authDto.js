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
