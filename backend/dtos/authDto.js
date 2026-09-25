export const serializeLoginResponse = ({ token, accessToken, account }) => ({
  success: true,
  message: "Authentication successful",
  token: accessToken || token,
  accessToken: accessToken || token,
  account: {
    id: account.id,
    email: account.email,
    phone: account.phone,
    role: account.role,
    status: account.status,
  },
});
