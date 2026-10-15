const ADZUNA_BASE_URL = "https://api.adzuna.com/v1/api/jobs";

export const DEFAULT_JOB_LOCATIONS = ["Gurugram", "Bangalore", "Noida", "Delhi NCR"];
const EXCLUDED_COMPANIES = new Set(["dataannotation"]);
export const allowedJobLocationFilter = {
  $or: [
    { location: /\b(gurugram|gurgaon)\b/i },
    { location: /\b(bangalore|bengaluru|banglore)\b/i },
    { location: /\b(?:greater\s+)?noida\b/i },
    { location: /\b(?:new\s+)?delhi(?:\s+ncr)?\b/i },
  ],
};

export class JobDiscoveryError extends Error {
  constructor(message, code = "JOB_DISCOVERY_ERROR") {
    super(message);
    this.name = "JobDiscoveryError";
    this.code = code;
  }
}

function buildSearchQuery(profile) {
  const roles = Array.isArray(profile.preferredRoles) ? profile.preferredRoles : [];
  const skills = Array.isArray(profile.verifiedSkills) ? profile.verifiedSkills.slice(0, 5) : [];
  // Keep the source query broad enough to return jobs. Location is constrained separately.
  const query = [roles[0], ...skills.slice(0, 2)].filter(Boolean).join(" ").trim();
  if (!query) throw new JobDiscoveryError("Add preferred roles or skills to your profile before discovering jobs.", "PROFILE_SEARCH_DATA_REQUIRED");
  return query;
}

function allowedLocations() {
  const configured = String(process.env.JOB_SEARCH_LOCATIONS || "")
    .split(",")
    .map((location) => location.trim())
    .filter((location) => isAllowedJobLocation(location));
  return configured.length ? configured : DEFAULT_JOB_LOCATIONS;
}

export function isAllowedJobLocation(location) {
  const normalized = String(location || "").toLowerCase();
  return /\b(gurugram|gurgaon)\b/.test(normalized)
    || /\b(bangalore|bengaluru|banglore)\b/.test(normalized)
    || /\b(?:greater\s+)?noida\b/.test(normalized)
    || /\b(?:new\s+)?delhi(?:\s+ncr)?\b/.test(normalized);
}

export function normalizeJobText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isExcludedJobCompany(company) {
  return EXCLUDED_COMPANIES.has(normalizeJobText(company).replace(/\s+/g, ""));
}

export function isValidJobSourceUrl(source, applicationUrl) {
  try {
    const url = new URL(applicationUrl);
    const hostname = url.hostname.toLowerCase();
    if (source === "naukri") return /(?:^|\.)naukri\.com$/.test(hostname) && /^\/job-listings(?:[-/]|$)/i.test(url.pathname);
    if (source === "linkedin") return /(?:^|\.)linkedin\.com$/.test(hostname) && /\/jobs\//i.test(url.pathname);
    if (source === "hirist") return /(?:^|\.)hirist\.tech$/.test(hostname);
    if (source === "indeed") return /(?:^|\.)indeed\.[a-z.]+$/.test(hostname) && /(?:viewjob|jobs|clk)/i.test(url.pathname);
    return true;
  } catch {
    return false;
  }
}

export function isQualityJob(job) {
  const title = normalizeJobText(job.title);
  const company = normalizeJobText(job.company);
  const description = normalizeJobText(job.description);
  if (!title || title === "untitled job" || title === "job") return false;
  if (!company || company === "unknown" || company === "unknown company") return false;
  if (!job.applicationUrl) return false;
  if (isExcludedJobCompany(job.company)) return false;
  if (job.source && !isValidJobSourceUrl(job.source, job.applicationUrl)) return false;
  if (description.startsWith("review the original") && description.includes("listing")) return false;
  return description.length >= 20;
}

export function jobRoleKey(job) {
  const seniorityRemoved = normalizeJobText(job.title)
    .replace(/\b(senior|sr|junior|jr|lead|principal|staff|associate|intern|trainee|i|ii|iii|iv|1|2|3|4)\b/g, " ");
  return `${normalizeJobText(job.company).replace(/\s+/g, "")}::${seniorityRemoved.replace(/\s+/g, " ").trim()}`;
}

export function deduplicateJobs(jobs) {
  const seen = new Set();
  return jobs.filter((job) => {
    if (!isQualityJob(job)) return false;
    const key = jobRoleKey(job);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function searchLocation({ appId, appKey, country, query, location, resultsPerPage }) {
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: String(resultsPerPage),
    what: query,
    where: location,
    "content-type": "application/json",
  });

  let response;
  try {
    response = await fetch(`${ADZUNA_BASE_URL}/${country}/search/1?${params.toString()}`, { signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new JobDiscoveryError("The job source could not be reached.", "JOB_SOURCE_UNAVAILABLE");
  }
  if (!response.ok) throw new JobDiscoveryError(`Adzuna returned HTTP ${response.status}.`, "JOB_SOURCE_REQUEST_FAILED");

  const payload = await response.json();
  return Array.isArray(payload.results) ? payload.results : [];
}

export async function discoverJobs(profile) {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) throw new JobDiscoveryError("ADZUNA_APP_ID and ADZUNA_APP_KEY are not configured.", "JOB_SOURCE_NOT_CONFIGURED");

  const country = (process.env.JOB_SEARCH_COUNTRY || "in").toLowerCase();
  const query = buildSearchQuery(profile);
  const locations = allowedLocations();
  const requestedResults = Math.min(Number(process.env.JOB_SEARCH_RESULTS) || 20, 50);
  const resultsPerLocation = Math.max(5, Math.ceil(requestedResults / locations.length));
  const rawJobs = (await Promise.all(locations.map((location) => searchLocation({ appId, appKey, country, query, location, resultsPerPage: resultsPerLocation })))).flat();
  const seen = new Set();
  const jobs = rawJobs.map((job) => {
    const title = job.title || "Untitled job";
    const company = job.company?.display_name || "Unknown company";
    const applicationUrl = job.redirect_url || job.url;
    return {
      source: "adzuna",
      externalId: String(job.id),
      title,
      company,
      location: job.location?.display_name || "",
      description: job.description || `${title} at ${company}. Apply through the source listing.`,
      requiredSkills: [],
      salaryMin: job.salary_min,
      salaryMax: job.salary_max,
      salaryCurrency: job.salary_currency || "INR",
      applicationUrl,
      sourceUrl: applicationUrl,
      postedAt: job.created ? new Date(job.created) : new Date(),
      fetchedAt: new Date(),
      status: "open",
    };
  }).filter((job) => {
    const key = job.externalId || job.applicationUrl;
    if (!job.applicationUrl || !job.title || !job.company || !isAllowedJobLocation(job.location) || seen.has(key) || !isQualityJob(job)) return false;
    seen.add(key);
    return true;
  });
  const deduplicatedJobs = deduplicateJobs(jobs).slice(0, requestedResults);

  console.log("Adzuna discovery response:", { country, query, locations, rawResults: rawJobs.length, allowedResults: deduplicatedJobs.length });
  return { jobs: deduplicatedJobs, rawCount: rawJobs.length, skippedCount: rawJobs.length - deduplicatedJobs.length, country, query, locations };
}
