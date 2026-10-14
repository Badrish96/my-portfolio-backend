import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export const getJwtSecret = () => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be configured in production.");
  }
  return "local-development-only-jwt-secret-change-before-deploy";
};

export const hashPassword = (password) => bcrypt.hash(password, 12);
export const verifyPassword = (password, passwordHash) => bcrypt.compare(password, passwordHash);

export const createAccessToken = (user) => jwt.sign(
  { sub: user._id.toString(), roles: user.roles, userType: user.userType },
  getJwtSecret(),
  { expiresIn: "7d" }
);

export const publicUser = (user) => ({
  id: user._id.toString(),
  name: user.name,
  username: user.username,
  email: user.email,
  userType: user.userType,
  avatar: user.avatar,
  bio: user.bio || "",
  location: user.location || "",
  website: user.website || "",
  stats: user.stats || { followersCount: 0, followingCount: 0 },
  roles: user.roles,
});
