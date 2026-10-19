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

const badrishResumeEmail = "badrishchoubeystar@gmail.com";

export const publicUser = (user) => {
  const isBadrishProfile = user.email?.toLowerCase() === badrishResumeEmail;
  const textOr = (value, fallback = "") => value || (isBadrishProfile ? fallback : "");
  const numberOr = (value, fallback = null) => value ?? (isBadrishProfile ? fallback : null);

  return ({
  id: user._id.toString(),
  name: user.name,
  username: user.username,
  email: user.email,
  firstName: textOr(user.firstName, "Badrish"),
  middleName: textOr(user.middleName, "N/A"),
  lastName: textOr(user.lastName, "Choubey"),
  mobilePhone: textOr(user.mobilePhone, "9540840758"),
  countryCode: textOr(user.countryCode, "+91"),
  gender: textOr(user.gender, "Male"),
  nationality: textOr(user.nationality, "Indian"),
  dateOfBirth: textOr(user.dateOfBirth, "1997-03-02"),
  currentSalary: numberOr(user.currentSalary, 1350000),
  currentSalaryCurrency: textOr(user.currentSalaryCurrency, "INR"),
  expectedSalary: numberOr(user.expectedSalary, 1600000),
  expectedSalaryCurrency: textOr(user.expectedSalaryCurrency, "INR"),
  compensationHikeExpectations: textOr(user.compensationHikeExpectations, "1600000"),
  availableToJoin: numberOr(user.availableToJoin, 0),
  currentLocation: textOr(user.currentLocation || user.location, "Gurugram, Haryana, India"),
  address: textOr(user.address, "E141 Dharam colony palam vihar Near Geeta properties Gurugram Haryana 122017"),
  city: textOr(user.city, "Gurugram"),
  state: textOr(user.state, "Haryana"),
  postalCode: textOr(user.postalCode, "122017"),
  country: textOr(user.country, "India"),
  experienceDetails: textOr(user.experienceDetails, resumeDefaults.experienceDetails),
  relevantExperienceYears: numberOr(user.relevantExperienceYears, 5),
  resumeSummary: textOr(user.resumeSummary, resumeDefaults.resumeSummary),
  educationDetails: textOr(user.educationDetails, "MCA from Lovely Professional University (LPU)\nBA from Delhi University (DU)"),
  projectDetails: textOr(user.projectDetails, resumeDefaults.projectDetails),
  certifications: textOr(user.certifications, "Full Stack Developer certification from upGrad"),
  achievements: textOr(user.achievements, "Delivered 90%+ customer satisfaction while providing AT&T broadband training and support.\nBuilt enterprise fintech, healthcare, and e-commerce workflows using modern web and mobile technologies.\nImplemented authentication, REST microservices, PostgreSQL schemas, and Azure DevOps CI/CD pipelines.\nMentored junior developers and supported production performance improvements."),
  languages: textOr(user.languages, "English, Hindi"),
  workAuthorization: textOr(user.workAuthorization, "Yes"),
  noticePeriod: textOr(user.noticePeriod, "0"),
  linkedinUrl: textOr(user.linkedinUrl, "https://linkedin.com/in/badrish-choubey-368857ba/"),
  githubUrl: textOr(user.githubUrl, "https://github.com/Badrish96"),
  portfolioUrl: textOr(user.portfolioUrl, "https://my-portfolio-frontend-chi-five.vercel.app/"),
  userType: user.userType,
  avatar: user.avatar,
  bio: textOr(user.bio, resumeDefaults.resumeSummary),
  location: textOr(user.location || user.currentLocation, "Gurugram, Haryana, India"),
  website: user.website || "",
  skills: user.skills?.length ? user.skills : (isBadrishProfile ? ["React.js", "Next.js", "TypeScript", "Node.js", "React Native", "Angular", "REST APIs", "PostgreSQL", "MongoDB", "Azure DevOps"] : []),
  preferredRoles: user.preferredRoles?.length ? user.preferredRoles : (isBadrishProfile ? ["Frontend Developer", "Senior Software Developer", "Full Stack Developer"] : []),
  preferredLocations: user.preferredLocations?.length ? user.preferredLocations : (isBadrishProfile ? ["Gurugram", "Bangalore", "Noida", "Delhi NCR"] : []),
  experienceYears: numberOr(user.experienceYears, 9),
  expectedCompensation: isBadrishProfile && user.expectedCompensation === 0 ? 1600000 : numberOr(user.expectedCompensation, 1600000),
  stats: user.stats || { followersCount: 0, followingCount: 0 },
  roles: user.roles,
  });
};
