const ADZUNA_BASE_URL = "https://api.adzuna.com/v1/api/jobs";

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
  // Keep the source query broad enough to return jobs. The AI scorer applies
  // the full skill profile after discovery; sending every role and skill as
  // one query can make the source search overly restrictive.
  const query = [roles[0], ...skills.slice(0, 2)].filter(Boolean).join(" ").trim();
  if (!query) throw new JobDiscoveryError("Add preferred roles or skills to your profile before discovering jobs.", "PROFILE_SEARCH_DATA_REQUIRED");
  return query;
}

export async function discoverJobs(profile) {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) throw new JobDiscoveryError("ADZUNA_APP_ID and ADZUNA_APP_KEY are not configured.", "JOB_SOURCE_NOT_CONFIGURED");

  const country = (process.env.JOB_SEARCH_COUNTRY || "in").toLowerCase();
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: String(Math.min(Number(process.env.JOB_SEARCH_RESULTS) || 20, 50)),
    what: buildSearchQuery(profile),
    "content-type": "application/json",
  });
  const location = profile.preferredLocations?.[0] || profile.location;
  if (location) params.set("where", location);

  let response;
  try {
    response = await fetch(`${ADZUNA_BASE_URL}/${country}/search/1?${params.toString()}`, { signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new JobDiscoveryError("The job source could not be reached.", "JOB_SOURCE_UNAVAILABLE");
  }
  if (!response.ok) throw new JobDiscoveryError(`Adzuna returned HTTP ${response.status}.`, "JOB_SOURCE_REQUEST_FAILED");

  const payload = await response.json();
  const rawJobs = Array.isArray(payload.results) ? payload.results : [];
  const jobs = rawJobs.map((job) => {
    const title = job.title || "Untitled job";
    const company = job.company?.display_name || "Unknown company";
    const applicationUrl = job.redirect_url || job.url;
    return {
    source: "adzuna",
    externalId: String(job.id),
    title,
    company,
    location: job.location?.display_name || location || "",
    // Adzuna returns a short description snippet. It is still useful for
    // matching, so do not reject the job just because the snippet is short.
    description: job.description || `${title} at ${company}. Apply through the source listing.`,
    requiredSkills: [],
    salaryMin: job.salary_min,
    salaryMax: job.salary_max,
    applicationUrl,
    sourceUrl: applicationUrl,
    postedAt: job.created ? new Date(job.created) : new Date(),
    fetchedAt: new Date(),
    status: "open",
    };
  }).filter((job) => job.applicationUrl && job.title && job.company);

  console.log("Adzuna discovery response:", {
    country,
    query: params.get("what"),
    rawResults: rawJobs.length,
    usableResults: jobs.length,
  });

  return {
    jobs,
    rawCount: rawJobs.length,
    skippedCount: rawJobs.length - jobs.length,
    country,
    query: params.get("what"),
  };
}
