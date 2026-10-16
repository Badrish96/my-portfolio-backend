const ADZUNA_BASE_URL = "https://api.adzuna.com/v1/api/jobs";
import { extractSkills } from "./skillMatching.js";

export const DEFAULT_JOB_LOCATIONS = ["Gurugram", "Bangalore", "Noida", "Delhi NCR"];
const EXCLUDED_COMPANIES = new Set(["dataannotation"]);
const LOCATION_ALIASES = {
  gurugram: ["gurugram", "gurgaon"],
  bangalore: ["bangalore", "bengaluru", "banglore"],
  noida: ["noida", "greater noida"],
  "delhi ncr": ["delhi", "new delhi", "delhi ncr", "ncr"],
  hyderabad: ["hyderabad", "secunderabad"],
  pune: ["pune", "pimpri"],
  mumbai: ["mumbai", "bombay", "thane"],
  chennai: ["chennai", "madras"],
  remote: ["remote", "work from home", "wfh", "anywhere"],
};
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

function buildSearchQueries(profile) {
  const roles = Array.isArray(profile.preferredRoles) ? profile.preferredRoles : [];
  const skills = Array.isArray(profile.verifiedSkills) ? profile.verifiedSkills.slice(0, 5) : [];
  const queries = roles.flatMap((role) => [
    [role],
    [role, skills[0]],
  ]).map((parts) => parts.filter(Boolean).join(" ").trim()).filter(Boolean);
  if (!queries.length && skills.length) queries.push(skills.slice(0, 3).join(" "));
  if (!queries.length) throw new JobDiscoveryError("Add preferred roles or skills to your profile before discovering jobs.", "PROFILE_SEARCH_DATA_REQUIRED");
  return [...new Set(queries)].slice(0, 10);
}

function allowedLocations(profile) {
  const preferred = Array.isArray(profile?.preferredLocations) ? profile.preferredLocations.map((location) => String(location).trim()).filter(Boolean) : [];
  if (preferred.length) return preferred;
  const configured = String(process.env.JOB_SEARCH_LOCATIONS || "")
    .split(",")
    .map((location) => location.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_JOB_LOCATIONS;
}

export function isAllowedJobLocation(location, preferredLocations = DEFAULT_JOB_LOCATIONS) {
  const normalized = normalizeJobText(location);
  const requested = Array.isArray(preferredLocations) && preferredLocations.length ? preferredLocations : DEFAULT_JOB_LOCATIONS;
  return requested.some((preference) => {
    const key = normalizeJobText(preference);
    const aliases = LOCATION_ALIASES[key] || [key];
    return aliases.some((alias) => new RegExp(`\\b${normalizeJobText(alias).replace(/ /g, "\\s+")}\\b`, "i").test(normalized));
  });
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
    if (source === "naukri") return /(?:^|\.)naukri\.com$/.test(hostname) && /^\/(?:job-listings|jobs?)(?:[-/]|$)/i.test(url.pathname);
    if (source === "linkedin") return /(?:^|\.)linkedin\.com$/.test(hostname) && /\/jobs\//i.test(url.pathname);
    if (source === "hirist") return /(?:^|\.)hirist\.tech$/.test(hostname);
    if (source === "indeed") return /(?:^|\.)indeed\.[a-z.]+$/.test(hostname) && /(?:viewjob|jobs|clk)/i.test(url.pathname);
    if (source === "adzuna") return /(?:^|\.)adzuna\.[a-z.]+$/.test(hostname) && /(?:job|jobs|details|ad\/)/i.test(`${url.pathname} ${url.search}`);
    if (source === "generic") return /^https?:$/i.test(url.protocol);
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
    // A company can appear under different display names across a bundled
    // source list and a deployment override. The same apply URL is the stable
    // identity for those duplicate ATS records.
    let postingUrl = "";
    try {
      const url = new URL(job.applicationUrl);
      for (const key of [...url.searchParams.keys()]) {
        if (/^(utm_.+|oga|source|ref|trackingid)$/i.test(key)) url.searchParams.delete(key);
      }
      url.searchParams.sort();
      url.hash = "";
      postingUrl = url.toString().replace(/\/$/, "").toLowerCase();
    } catch {
      // Keep the company/title fallback for malformed or missing URLs.
    }
    const key = postingUrl || jobRoleKey(job);
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
    sort_by: "date",
    "content-type": "application/json",
  });

  let response;
  try {
    response = await fetch(`${ADZUNA_BASE_URL}/${country}/search/1?${params.toString()}`, { signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new JobDiscoveryError("The job source could not be reached.", "JOB_SOURCE_UNAVAILABLE");
  }
  const responseText = await response.text();
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const detail = payload?.error || payload?.message || responseText.replace(/\s+/g, " ").trim();
    throw new JobDiscoveryError(`Adzuna returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 240)}` : "."}`, "JOB_SOURCE_REQUEST_FAILED");
  }
  return Array.isArray(payload.results) ? payload.results : [];
}

export async function discoverJobs(profile) {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) throw new JobDiscoveryError("ADZUNA_APP_ID and ADZUNA_APP_KEY are not configured.", "JOB_SOURCE_NOT_CONFIGURED");

  const country = (process.env.JOB_SEARCH_COUNTRY || "in").toLowerCase();
  const queries = buildSearchQueries(profile);
  const locations = allowedLocations(profile);
  const requestedResults = Math.min(Number(process.env.JOB_SEARCH_RESULTS) || 20, 50);
  const resultsPerRequest = Math.max(5, Math.ceil(requestedResults / Math.max(1, locations.length * queries.length)));
  const rawJobs = (await Promise.all(queries.flatMap((query) => locations.map((location) => searchLocation({ appId, appKey, country, query, location, resultsPerPage: resultsPerRequest }))))).flat();
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
      requiredSkills: extractSkills(`${title} ${job.description || ""}`),
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
    if (!job.applicationUrl || !job.title || !job.company || !isAllowedJobLocation(job.location, locations) || seen.has(key) || !isQualityJob(job)) return false;
    seen.add(key);
    return true;
  });
  const deduplicatedJobs = deduplicateJobs(jobs).slice(0, requestedResults);

  console.log("Adzuna discovery response:", { country, queries, locations, rawResults: rawJobs.length, allowedResults: deduplicatedJobs.length });
  return { jobs: deduplicatedJobs, rawCount: rawJobs.length, skippedCount: rawJobs.length - deduplicatedJobs.length, country, query: queries.join(" | "), queries, locations };
}
