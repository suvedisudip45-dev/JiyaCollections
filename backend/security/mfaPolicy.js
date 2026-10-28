export const MFA_REQUIRED_PORTALS = Object.freeze([
  "ADMIN",
  "MARKETING_PARTNER",
  "MANUFACTURER",
  "DISTRIBUTOR",
]);

export const normalizePortal = (portal) => String(portal || "").trim().toUpperCase();

export const isMfaEnabled = (env = process.env) => {
  const value = env.MFA_ENABLED;
  if (value == null || String(value).trim() === "") return true;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error("MFA_ENABLED must be set to true or false.");
};

export const requiresMfa = (portal) => MFA_REQUIRED_PORTALS.includes(normalizePortal(portal));

export const isMfaEnforced = (portal, env = process.env) => isMfaEnabled(env) && requiresMfa(portal);

export const hasMfaEvidence = (claims) => Boolean(
  claims?.mfa_verified === true &&
  Array.isArray(claims.amr) &&
  claims.amr.includes("pwd") &&
  claims.amr.includes("otp"),
);

export const hasRequiredMfa = (portal, claims, env = process.env) =>
  !isMfaEnforced(portal, env) || hasMfaEvidence(claims);