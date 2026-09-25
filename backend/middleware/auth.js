import jwt from "jsonwebtoken";

const extractToken = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7).trim();
  }
  return req.headers.token || req.headers.admintoken || req.headers.manufacturertoken || null;
};

// Middleware for authenticated customers
const authUser = async (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ success: false, message: "Not Authorized. Login required." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded || typeof decoded !== "object") {
      return res.status(401).json({ success: false, message: "Invalid token" });
    }

    const userId = decoded.profileId || decoded.id || decoded.userId || decoded.accountId;
    if (!req.body) req.body = {};
    req.body.userId = userId;
    req.userId = userId;
    req.auth = {
      accountId: decoded.accountId || userId,
      profileId: userId,
      role: (decoded.role || "CUSTOMER").toUpperCase(),
      email: decoded.email || "",
    };
    next();
  } catch (error) {
    console.log(error);
    res.status(401).json({ success: false, message: error.message });
  }
};

// Middleware for authenticated admins
const authAdmin = async (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ success: false, message: "Not Authorized. Admin login required." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded || typeof decoded !== "object") {
      return res.status(401).json({ success: false, message: "Invalid token" });
    }

    const role = String(decoded.role || "").toUpperCase();
    if (role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Access denied. Admin only." });
    }

    const adminId = decoded.adminId || decoded.profileId || decoded.accountId || decoded.id;
    if (!req.body) req.body = {};
    req.body.adminId = adminId;
    req.adminId = adminId;
    req.auth = {
      accountId: decoded.accountId || adminId,
      profileId: adminId,
      role: "ADMIN",
      email: decoded.email || "",
    };
    next();
  } catch (error) {
    console.log(error);
    res.status(401).json({ success: false, message: error.message });
  }
};

export { authAdmin };
export default authUser;
