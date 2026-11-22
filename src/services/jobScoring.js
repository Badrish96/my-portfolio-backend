import { canonicalSkill, extractSkills } from "./skillMatching.js";

export const SCORING_VERSION = "v10-evidence";
const list = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : [];
const text = (value) => String(value ?? "").replace(/<\/?(?:p|li|ul|ol|br|h[1-6]|div)\b[^>]*>/gi, "\n").replace(/<[^>]*>/g, " ").slice(0, 30000);
const frontend = /\b(?:front[- ]?end|react(?:[. ]?js)?|next[. ]?js|ui (?:developer|engineer)|web application|javascript developer)\b/i;
const fullstack = /\b(?:full[- ]?stack|mern)\b/i;
const excluded = /\b(?:devops|sre|site reliability|infrastructure engineer|cloud operations|qa|sdet|test(?:ing)? engineer|quality assurance|data (?:engineer|analyst|scientist)|machine learning engineer|ml engineer|ai researcher|android|ios developer|react native|ui\s*\/\s*ux designer|ux designer|ui designer|technical support|it support|engineering manager|director|cto|intern(?:ship)?|fresher|entry[- ]level)\b/i;
const backendTitle = /\b(?:back[- ]?end|server[- ]side|(?:java|python|php|dotnet|node[.]?js) (?:developer|engineer))\b|\.net/i;
const frontWork = [
  /(?:build|develop|implement|maintain|architect|design|own|create)\b.{0,65}\b(?:interfaces?|components?|front[- ]?end|react|next[. ]?js|web applications?|ui)\b/i,
  /\b(?:responsive (?:design|web|interfaces?)|accessibility|design systems?|reusable components?|client[- ]side)\b/i,
  /\b(?:frontend performance|web vitals|bundle size|server[- ]side rendering|state management|redux)\b/i,
  /\b(?:integrat\w* (?:with )?(?:rest |graphql )?apis?|api integration)\b/i,
];
const backWork = [
  /(?:build|develop|design|own|maintain)\b.{0,55}\b(?:microservices|backend services|server[- ]side services|rest apis)\b/i,
  /\b(?:spring boot|django|asp\.net|laravel|database schemas?|distributed systems)\b/i,
  /\b(?:backend architecture|database tuning|database optimization|server[- ]side development)\b/i,
];
const core = new Set(["react", "next.js", "javascript", "typescript", "html", "css"]);
const optionalMarker = /\b(?:preferred|desirable|nice\s+to\s+have|good to have|bonus|a plus|optional)\b/i;
const requiredMarker = /\b(?:required|requirements|qualifications|mandatory|must have|essential)\b/i;
const skillsIn = (value) => { const withoutNative = value.replace(/\breact native\b/gi, " "); return extractSkills(value).filter((skill) => skill !== "react" || /\breact(?:[. ]?js)?\b/i.test(withoutNative)); };

export function prepareProfile(profile = {}) {
  const roles = list(profile.preferredRoles);
  const known = new Set([
    ...list(profile.verifiedSkills ?? profile.skills).map(canonicalSkill),
    ...skillsIn([profile.resumeSummary, profile.experienceDetails, profile.projectDetails].map(text).join(" ")),
  ]);
  if (known.has("next.js")) known.add("react");
  return { roles, known, locations: list(profile.preferredLocations), years: profile.verifiedExperienceYears ?? profile.experienceYears, salary: Number(profile.targetSalaryMin) || null };
}

export function matchCategory(score) {
  if (score >= 90) return "Excellent Match";
  if (score >= 75) return "Strong Match";
  if (score >= 60) return "Potential Match";
  if (score >= 40) return "Weak Match";
  return "Not Relevant";
}

export function evaluateRules(profile, job) {
  const candidate = prepareProfile(profile);
  const title = text(job.title).trim();
  const description = text(job.description);
  const required = new Set(list(job.requiredSkills).map(canonicalSkill));
  const optional = new Set(list(job.preferredSkills).map(canonicalSkill));
  const mentioned = new Set(skillsIn(title));
  let section = "";
  for (const line of description.split(/\r?\n|[;•]|(?<=[.!?])\s+/)) {
    const preferred = optionalMarker.test(line);
    const mandatory = requiredMarker.test(line);
    if (/^\s*(?:responsibilities|what you.ll do|about (?:us|the role))\s*:?\s*$/i.test(line)) section = "";
    if (/^\s*[^:]{1,50}:?\s*$/.test(line) && (preferred || mandatory)) section = preferred ? "optional" : "required";
    for (const skill of skillsIn(line)) {
      mentioned.add(skill);
      if (preferred || (!mandatory && section === "optional")) optional.add(skill);
      else if (mandatory || section === "required") required.add(skill);
    }
  }
  const allSkills = new Set([...mentioned, ...required, ...optional]);
  const matchingSkills = [...allSkills].filter((skill) => candidate.known.has(skill));
  const missingSkills = [...required].filter((skill) => !candidate.known.has(skill));
  const frontendTasks = frontWork.filter((pattern) => pattern.test(description)).length;
  const backendTasks = backWork.filter((pattern) => pattern.test(description)).length;
  const preferredFrontend = !candidate.roles.length || candidate.roles.some((role) => frontend.test(role) || fullstack.test(role) || /^(?:senior )?software (?:developer|engineer)$/i.test(role));
  const explicitFullstack = fullstack.test(title);
  const explicitFrontend = frontend.test(title) && !explicitFullstack;
  const backendHeavy = backendTasks >= 2 && backendTasks > frontendTasks;
  const primaryFrontend = frontendTasks >= 2 || (explicitFrontend && frontendTasks >= 1);
  const coreMatches = matchingSkills.filter((skill) => core.has(skill));
  const titleMatch = candidate.roles.some((role) => title.toLowerCase().includes(role.toLowerCase()));
  const reasons = [];
  const concerns = [];
  let ceiling = 100;
  let role = titleMatch ? 25 : 9;
  if (preferredFrontend && (explicitFrontend || explicitFullstack || primaryFrontend)) role = explicitFrontend ? 25 : explicitFullstack ? 23 : 22;
  if (excluded.test(title) || /\b(?:people management|direct reports)\b/i.test(description) && /\b(?:lead|manager|head)\b/i.test(title)) {
    ceiling = 35;
    concerns.push("The listing targets a different role or seniority.");
  }
  if (preferredFrontend && ((backendTitle.test(title) && !explicitFullstack && !primaryFrontend) || backendHeavy || (/\b(?:wordpress|shopify)\b/i.test(title) && !primaryFrontend))) {
    ceiling = Math.min(ceiling, 39);
    concerns.push("The listing lacks sufficient frontend ownership for the target roles.");
  }
  if (preferredFrontend && !titleMatch && !explicitFrontend && !primaryFrontend && !(explicitFullstack && coreMatches.length >= 2)) ceiling = Math.min(ceiling, 59);
  if (role >= 22 && ceiling >= 60) reasons.push(explicitFullstack ? "The title indicates a full-stack role." : primaryFrontend ? "The description includes frontend implementation responsibilities." : "The title aligns with frontend development.");
  if (coreMatches.length) reasons.push(`Core stack overlap: ${coreMatches.join(", ")}.`);
  if (missingSkills.length) concerns.push(`Required skills to verify: ${missingSkills.join(", ")}.`);

  const skillScore = Math.max(0, Math.min(25, coreMatches.length * 7 + (matchingSkills.length - coreMatches.length) * 2) - Math.min(9, missingSkills.length * 2));
  const responsibilityScore = frontendTasks ? Math.min(20, 5 + frontendTasks * 5) : 5;
  if (!frontendTasks) concerns.push("The available description gives limited evidence about frontend responsibilities.");
  if (!matchingSkills.length && !titleMatch) ceiling = Math.min(ceiling, 59);
  if (!frontendTasks && !coreMatches.length && preferredFrontend) ceiling = Math.min(ceiling, 59);

  const experience = [...description.matchAll(/\b(\d{1,2})(?:\s*(?:[-–—]|to)\s*(\d{1,2}))?\s*(\+)?\s*(?:years?|yrs?)\b/gi)];
  const generalExperience = experience.filter((entry) => !/^\s+(?:of\s+)?(?:react|typescript|javascript|next[.]?js|node[.]?js|java|python)\b/i.test(description.slice(entry.index + entry[0].length)));
  const requirement = [...(generalExperience.length ? generalExperience : experience)].sort((a, b) => Number(b[1]) - Number(a[1]))[0];
  let experienceScore = 9;
  if (requirement) {
    const min = Number(requirement[1]);
    const max = requirement[2] ? Number(requirement[2]) : requirement[3] ? Infinity : min;
    const years = candidate.years == null ? null : Number(candidate.years);
    if ((max <= 2 || min >= 10) && (years == null || (max <= 2 ? years >= 4 : years < min))) {
      experienceScore = 0;
      ceiling = Math.min(ceiling, min >= 10 ? 49 : 39);
      concerns.push(`Experience mismatch: the description lists ${requirement[0]}.`);
    } else if (years != null && years >= min && (years <= max || (!requirement[2] && min >= 3))) {
      experienceScore = 15;
      reasons.push(`Your experience aligns with the listed ${requirement[0]}.`);
    } else if (years != null) {
      experienceScore = years + 2 >= min ? 10 : 4;
      concerns.push(`Review the listed experience requirement of ${requirement[0]}.`);
    }
  }

  const place = text(job.location).trim().toLowerCase().replace(/gurgaon/g, "gurugram");
  const preferences = candidate.locations.map((location) => location.toLowerCase().replace(/gurgaon/g, "gurugram"));
  let locationScore = 6;
  if (place && preferences.length) {
    const indiaRemote = /\bremote\b/.test(place) && /\bindia\b/.test(place) && !/outside india/i.test(place);
    const ncr = /\b(delhi|ncr|noida|faridabad|ghaziabad|gurugram)\b/;
    if (preferences.some((location) => (/remote/.test(location) && /india/.test(location)) ? indiaRemote : place.includes(location) || (ncr.test(place) && /delhi|ncr/.test(location)))) {
      locationScore = place.includes("gurugram") ? 10 : 9;
      reasons.push(`Listed location matches a preference: ${job.location}.`);
    } else if (!/^(?:unknown|not specified|remote)$/i.test(place)) {
      locationScore = 1;
      concerns.push(`Listed location is outside your saved preferences: ${job.location}.`);
    }
  }
  const lpa = description.match(/(?:₹|inr|salary\s*[:\-]?|ctc\s*[:\-]?)\s*(\d+(?:\.\d+)?)(?:\s*[-–—]\s*(\d+(?:\.\d+)?))?\s*(?:lpa|lakhs?\s*(?:pa|per annum))/i);
  const rawSalary = job.salaryMax ?? job.salaryMin;
  const salary = rawSalary > 0 && /^inr$/i.test(job.salaryCurrency ?? "INR") ? Number(rawSalary) : lpa ? Number(lpa[2] || lpa[1]) * 100000 : 0;
  const salaryCompatibility = salary && candidate.salary ? salary >= candidate.salary ? "compatible" : "incompatible" : "unknown";
  if (salaryCompatibility === "incompatible") concerns.push("The listed annual pay is below your target.");
  const salaryScore = salaryCompatibility === "compatible" ? 5 : salaryCompatibility === "unknown" ? 4 : 0;
  const dimensions = { role, skills: skillScore, responsibilities: responsibilityScore, experience: experienceScore, location: locationScore, salary: salaryScore };
  const matchScore = Math.min(ceiling, Object.values(dimensions).reduce((sum, score) => sum + score, 0));
  return { matchScore, scoreCeiling: ceiling, dimensions, matchingSkills, missingSkills, preferredSkills: [...optional].filter((skill) => !required.has(skill)), reasons, concerns, salaryCompatibility };
}
