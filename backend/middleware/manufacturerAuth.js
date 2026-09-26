import jwt from "jsonwebtoken";

const extractToken = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7).trim();
  }
  return req.headers.token || req.headers.admintoken || req.headers.manufacturertoken || null;
};

// Middleware for authenticated manufacturers
const authManufacturer = async (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ success: false, message: "Not Authorized. Manufacturer login required." });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded || typeof decoded !== "object") {
      return res.status(401).json({ success: false, message: "Invalid token" });
    }

    const role = String(decoded.role || "").toUpperCase();
    if (role !== "MANUFACTURER" && role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Access denied. Manufacturer only." });
    }
    const manufacturerId = decoded.manufacturerId || decoded.profileId || decoded.accountId || decoded.id;
    if (!req.body) req.body = {};
    req.body.manufacturerId = manufacturerId;
    req.manufacturerId = manufacturerId;
    req.auth = {
      accountId: decoded.accountId || manufacturerId,
      profileId: manufacturerId,
      role: role,
      email: decoded.email || "",
    };
    next();
  } catch (error) {
    console.log(error);
    res.status(401).json({ success: false, message: error.message });
  }
};

export default authManufacturer;
