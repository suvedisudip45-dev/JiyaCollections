import jwt from "jsonwebtoken";

const extractToken = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7).trim();
  }
  return req.headers.token || req.headers.admintoken || req.headers.manufacturertoken || null;
};

// Middleware for authenticated marketing partners
const marketingPartnerAuth = async (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Not Authorized. Marketing partner login required.",
    });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded || typeof decoded !== "object") {
      return res.status(401).json({ success: false, message: "Invalid token" });
    }

    const role = String(decoded.role || "").toUpperCase();
    if (role !== "MARKETING_PARTNER" && role !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Marketing partner only.",
      });
    }
    const partnerId = decoded.partnerId || decoded.profileId || decoded.accountId || decoded.id;
    if (!req.body) req.body = {};
    req.body.partnerId = partnerId;
    req.partnerId = partnerId;
    req.auth = {
      accountId: decoded.accountId || partnerId,
      profileId: partnerId,
      role: role,
      email: decoded.email || "",
    };
    next();
  } catch (error) {
    console.log(error);
    res.status(401).json({ success: false, message: "Invalid or expired token." });
  }
};

export default marketingPartnerAuth;
