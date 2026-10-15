import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const resumeDefaults = {
  resumeSummary: "Senior Software Developer with 5+ years building scalable fintech, healthcare, e-commerce, and developer platforms using React, Next.js, TypeScript, Node.js, React Native, and AI-assisted workflows.",
  experienceDetails: "Senior Software Developer — Programming.com (Client: Appinventiv), Dec 2025–Present: Built loan origination and healthcare workflows with React, Next.js, TypeScript, and Node.js; implemented OCR/KYC, role-based access, multi-step forms, i18n, and performance improvements.\n\nSenior Software Developer — OneDAO, Jun 2024–Aug 2025: Architected a full-stack fundraising platform with React Native, Auth0, JWT, Google OAuth, PostgreSQL, Node.js REST microservices, Azure DevOps CI/CD, and mentoring.\n\nSenior Software Developer — Accenture (Client: Verizon), May 2020–May 2023: Developed high-traffic e-commerce modules for catalog, checkout, accounts, and order management using Angular, React Native, TypeScript, REST APIs, microservices, and CI/CD.\n\nProgram Ready Trainer II — Concentrix, Jun 2016–May 2020: Delivered technical training and troubleshooting support for AT&T broadband services with 90%+ customer satisfaction.",
  projectDetails: "Sammaan Capital — Loan Origination Platform: React, Next.js, TypeScript, React Hook Form, Zod, Node.js, Azure DevOps; built onboarding, OCR-based KYC, role-based dashboards, and loan workflows.\n\nPonteo — Healthcare Platform: React, Next.js, TypeScript, Redux Toolkit, Node.js, REST APIs, Tailwind CSS; built healthcare workflows and reusable responsive UI modules.\n\nOneDAO — Fintech Fundraising Platform: React, React Native, Node.js, Express.js, PostgreSQL, MongoDB, Auth0, Redis; built startup/investor workflows, authentication, schemas, REST microservices, and CI/CD.\n\nVerizon E-commerce Platform: Angular, React Native, TypeScript, Node.js, REST APIs, Azure DevOps, AWS, microservices; built catalog, checkout, account, and order management modules.",
};

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
  expectedSalary: user.expectedSalary ?? 1600000,
  expectedSalaryCurrency: user.expectedSalaryCurrency || "INR",
  availableToJoin: user.availableToJoin ?? null,
  currentLocation: user.currentLocation || user.location || "",
  experienceDetails: user.experienceDetails || resumeDefaults.experienceDetails,
  relevantExperienceYears: user.relevantExperienceYears ?? null,
  resumeSummary: user.resumeSummary || resumeDefaults.resumeSummary,
  educationDetails: user.educationDetails || "",
  projectDetails: user.projectDetails || resumeDefaults.projectDetails,
  certifications: user.certifications || "",
  achievements: user.achievements || "",
  languages: user.languages || "English, Hindi",
  workAuthorization: user.workAuthorization || "",
  noticePeriod: user.noticePeriod || "",
  linkedinUrl: user.linkedinUrl || "",
  githubUrl: user.githubUrl || "",
  portfolioUrl: user.portfolioUrl || "",
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
