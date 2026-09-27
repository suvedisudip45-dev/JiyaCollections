export const MFA_REQUIRED_PORTALS = Object.freeze([
  "ADMIN",
  "MARKETING_PARTNER",
  "MANUFACTURER",
]);

export const normalizePortal = (portal) => String(portal || "").trim().toUpperCase();

export const requiresMfa = (portal) => MFA_REQUIRED_PORTALS.includes(normalizePortal(portal));

export const hasMfaEvidence = (claims) => Boolean(
  claims?.mfa_verified === true &&
  Array.isArray(claims.amr) &&
  claims.amr.includes("pwd") &&
  claims.amr.includes("otp"),
);

export const hasRequiredMfa = (portal, claims) => !requiresMfa(portal) || hasMfaEvidence(claims);