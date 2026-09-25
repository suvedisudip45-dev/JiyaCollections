import jwt from "jsonwebtoken";

const extractToken = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7).trim();
  }
  return req.headers.token || req.headers.admintoken || req.headers.manufacturertoken || null;
};

const adminAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not Authorized Login Again",
      });
    }
    const token_decode = jwt.verify(token, process.env.JWT_SECRET);
    
    if (typeof token_decode === "object") {
      const role = String(token_decode.role || "").toUpperCase();
      if (role === "ADMIN") {
        const adminId = token_decode.adminId || token_decode.profileId || token_decode.accountId || token_decode.id;
        if (!req.body) req.body = {};
        req.body.adminId = adminId;
        req.adminId = adminId;
        req.auth = {
          accountId: token_decode.accountId || adminId,
          profileId: adminId,
          role: "ADMIN",
          email: token_decode.email || "",
        };
        return next();
      }
    }

    return res.status(403).json({
      success: false,
      message: "Access denied. Admin only.",
    });
  } catch (error) {
    console.log(error);
    res.status(401).json({ success: false, message: error.message });
  }
};

export default adminAuth;

