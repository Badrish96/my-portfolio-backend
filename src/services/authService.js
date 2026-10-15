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
  firstName: user.firstName || "",
  middleName: user.middleName || "",
  lastName: user.lastName || "",
  mobilePhone: user.mobilePhone || "",
  countryCode: user.countryCode || "",
  gender: user.gender || "",
  nationality: user.nationality || "",
  dateOfBirth: user.dateOfBirth || "",
  currentSalary: user.currentSalary ?? null,
  currentSalaryCurrency: user.currentSalaryCurrency || "",
  expectedSalary: user.expectedSalary ?? null,
  expectedSalaryCurrency: user.expectedSalaryCurrency || "",
  availableToJoin: user.availableToJoin ?? null,
  currentLocation: user.currentLocation || user.location || "",
  experienceDetails: user.experienceDetails || "",
  relevantExperienceYears: user.relevantExperienceYears ?? null,
  userType: user.userType,
  avatar: user.avatar,
  bio: user.bio || "",
  location: user.location || "",
  website: user.website || "",
  skills: user.skills || [],
  preferredRoles: user.preferredRoles || [],
  preferredLocations: user.preferredLocations || [],
  experienceYears: user.experienceYears ?? null,
  expectedCompensation: user.expectedCompensation ?? null,
  stats: user.stats || { followersCount: 0, followingCount: 0 },
  roles: user.roles,
});
