import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { getJwtSecret } from "../services/authService.js";

export const authenticate = async (req, res, next) => {
  const authorization = req.get("authorization") || "";
  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }

  try {
    const claims = jwt.verify(token, getJwtSecret());
    const user = await User.findById(claims.sub);
    if (!user) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired token." });
  }
};
