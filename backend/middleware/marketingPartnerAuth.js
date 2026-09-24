import jwt from "jsonwebtoken";

// Middleware for authenticated marketing partners
const marketingPartnerAuth = async (req, res, next) => {
  const { token } = req.headers;
  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Not Authorized. Marketing partner login required.",
    });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== "marketing_partner") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Marketing partner only.",
      });
    }
    if (!req.body) req.body = {};
    req.body.partnerId = decoded.partnerId;
    req.partnerId = decoded.partnerId;
    next();
  } catch (error) {
    console.log(error);
    res.status(401).json({ success: false, message: "Invalid or expired token." });
  }
};

export default marketingPartnerAuth;
