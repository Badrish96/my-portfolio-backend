import { deduplicateJobs, isAllowedJobLocation, isQualityJob, normalizeJobText } from "./jobDiscovery.js";

const DEFAULT_LIMIT = 100;

function configuredCompanies() {
  const raw = String(process.env.COMPANY_CAREER_SOURCES || "[]");
  try {
    const companies = JSON.parse(raw);
    return Array.isArray(companies) ? companies.filter((company) => company?.company) : [];
  } catch (error) {
    console.error("COMPANY_CAREER_SOURCES is not valid JSON:", error.message);
    return [];
  }
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

function absoluteUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}

function locationText(value) {
  if (Array.isArray(value)) return value.map(locationText).filter(Boolean).join(", ");
  if (typeof value === "object" && value) return [value.city, value.addressLocality, value.name, value.label].filter(Boolean).join(", ");
  return String(value || "").trim();
}

function potentialProfileMatch(job, profile) {
  const terms = [...(profile.preferredRoles || []), ...(profile.verifiedSkills || [])]
    .map(normalizeJobText)
    .filter((term) => term.length >= 3);
  if (!terms.length) return true;
  const text = normalizeJobText(`${job.title} ${job.description}`);
  return terms.some((term) => text.includes(term));
}

function normalizeJob(company, raw, fields) {
  const title = String(fields.title || "").trim();
  const location = locationText(fields.location);
  const applicationUrl = absoluteUrl(fields.applicationUrl, company.careersUrl);
  const description = stripHtml(fields.description) || `${title} at ${company.company}. Apply through the company's official careers page.`;
  const externalId = String(fields.externalId || applicationUrl || title).slice(0, 280);
  return {
    source: "company-career",
    externalId: `${normalizeJobText(company.company).replace(/\s+/g, "-")}-${externalId}`.slice(0, 300),
    title,
    company: company.company,
    location,
    description: description.slice(0, 30000),
    requiredSkills: Array.isArray(fields.requiredSkills) ? fields.requiredSkills : [],
    applicationUrl,
    sourceUrl: applicationUrl,
    postedAt: fields.postedAt ? new Date(fields.postedAt) : new Date(),
    fetchedAt: new Date(),
    status: "open",
  };
}

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Career source returned HTTP ${response.status}.`);
  return response.json();
}

async function greenhouseJobs(company) {
  const payload = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(company.board)}/jobs?content=true`);
  return (payload.jobs || []).map((job) => normalizeJob(company, job, {
    externalId: job.id,
    title: job.title,
    location: job.location?.name,
    description: job.content,
    applicationUrl: job.absolute_url,
    postedAt: job.updated_at,
  }));
}

async function leverJobs(company) {
  const payload = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(company.board)}?mode=json`);
  return (payload || []).map((job) => normalizeJob(company, job, {
    externalId: job.id,
    title: job.text,
    location: job.categories?.location || job.workplaceType,
    description: `${job.descriptionPlain || ""} ${job.additionalPlain || ""}`,
    applicationUrl: job.hostedUrl || job.applyUrl,
    postedAt: job.createdAt ? new Date(job.createdAt) : undefined,
  }));
}

async function ashbyJobs(company) {
  const payload = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company.board)}`);
  return (payload.jobs || []).map((job) => normalizeJob(company, job, {
    externalId: job.id,
    title: job.title,
    location: job.location || job.address,
    description: job.descriptionPlain || job.descriptionHtml,
    applicationUrl: job.jobUrl || job.applyUrl,
    postedAt: job.publishedAt,
  }));
}

async function jsonLdJobs(company) {
  const response = await fetch(company.careersUrl, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Career page returned HTTP ${response.status}.`);
  const html = await response.text();
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const jobs = [];
  for (const [, script] of scripts) {
    try {
      const parsed = JSON.parse(script.trim());
      const entries = Array.isArray(parsed) ? parsed : parsed?.['@graph'] || [parsed];
      for (const entry of entries) {
        if (entry?.['@type'] !== "JobPosting") continue;
        jobs.push(normalizeJob(company, entry, {
          externalId: entry.identifier?.value || entry.url || entry.title,
          title: entry.title,
          location: entry.jobLocation,
          description: entry.description,
          applicationUrl: entry.url || company.careersUrl,
          postedAt: entry.datePosted,
        }));
      }
    } catch {
      // Ignore malformed JSON-LD blocks and continue with other career sources.
    }
  }
  return jobs;
}

async function fetchCompanyJobs(company) {
  if (company.ats === "greenhouse") return greenhouseJobs(company);
  if (company.ats === "lever") return leverJobs(company);
  if (company.ats === "ashby") return ashbyJobs(company);
  return jsonLdJobs(company);
}

export async function discoverCompanyCareerJobs(profile) {
  const companies = configuredCompanies();
  const limit = Math.min(Math.max(Number(process.env.COMPANY_CAREER_JOB_LIMIT) || DEFAULT_LIMIT, 1), 500);
  const results = await Promise.allSettled(companies.map(fetchCompanyJobs));
  const jobs = results.flatMap((result) => result.status === "fulfilled" ? result.value : [])
    .filter((job) => isAllowedJobLocation(job.location) && isQualityJob(job) && potentialProfileMatch(job, profile));
  const failures = results.filter((result) => result.status === "rejected").length;
  return { jobs: deduplicateJobs(jobs).slice(0, limit), companies: companies.length, failures };
}
