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

function decodeHtmlEntities(value) {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return String(value || "").replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (full, entity) => {
    const key = entity.toLowerCase();
    if (named[key]) return named[key];
    if (key.startsWith("#x")) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
    if (key.startsWith("#")) return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
    return full;
  });
}

export function stripHtml(value) {
  let text = String(value || "");
  // Some ATS feeds encode the complete HTML fragment, occasionally twice.
  for (let pass = 0; pass < 2; pass += 1) text = decodeHtmlEntities(text);
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  if (typeof value === "object" && value) return [value.city, value.addressLocality, value.name, value.label, value.address].map(locationText).filter(Boolean).join(", ");
  return String(value || "").trim();
}

function potentialProfileMatch(job, profile) {
  const roleTerms = (profile.preferredRoles || [])
    .map(normalizeJobText)
    .filter((term) => term.length >= 3);
  const skillTerms = (profile.verifiedSkills || [])
    .map(normalizeJobText)
    .filter((term) => term.length >= 3);
  if (!roleTerms.length && !skillTerms.length) return true;
  const title = normalizeJobText(job.title);
  const text = normalizeJobText(`${job.title} ${job.description}`);
  const titleMatchesRole = roleTerms.some((term) => title.includes(term));
  const matchingSkills = skillTerms.filter((term) => text.includes(term)).length;
  return titleMatchesRole || matchingSkills >= 2;
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

function linkedAtsSource(company, html) {
  const greenhouse = html.match(/https?:\/\/boards\.greenhouse\.io\/([^/?#"'\\]+)/i)?.[1];
  if (greenhouse) return { ...company, ats: "greenhouse", board: greenhouse, careersUrl: `https://boards.greenhouse.io/${greenhouse}` };
  const lever = html.match(/https?:\/\/jobs\.lever\.co\/([^/?#"'\\]+)/i)?.[1];
  if (lever) return { ...company, ats: "lever", board: lever, careersUrl: `https://jobs.lever.co/${lever}` };
  const ashby = html.match(/https?:\/\/jobs\.ashbyhq\.com\/([^/?#"'\\]+)/i)?.[1];
  if (ashby) return { ...company, ats: "ashby", board: ashby, careersUrl: `https://jobs.ashbyhq.com/${ashby}` };
  return null;
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
  if (!jobs.length) {
    const atsSource = linkedAtsSource(company, html);
    if (atsSource) return fetchCompanyJobs(atsSource);
  }
  return jobs;
}

async function fetchCompanyJobs(company) {
  if (company.ats === "greenhouse") return greenhouseJobs(company);
  if (company.ats === "lever") return leverJobs(company);
  if (company.ats === "ashby") return ashbyJobs(company);
  return jsonLdJobs(company);
}

function balanceCompanies(jobs, limit) {
  const groups = new Map();
  for (const job of jobs) {
    const key = normalizeJobText(job.company) || "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(job);
  }
  const balanced = [];
  while (balanced.length < limit && groups.size) {
    for (const [key, companyJobs] of groups) {
      const next = companyJobs.shift();
      if (next) balanced.push(next);
      if (!companyJobs.length) groups.delete(key);
      if (balanced.length >= limit) break;
    }
  }
  return balanced;
}

export async function discoverCompanyCareerJobs(profile) {
  const companies = configuredCompanies();
  const limit = Math.min(Math.max(Number(process.env.COMPANY_CAREER_JOB_LIMIT) || DEFAULT_LIMIT, 1), 500);
  const results = await Promise.allSettled(companies.map(fetchCompanyJobs));
  const jobs = results.flatMap((result) => result.status === "fulfilled" ? result.value : [])
    .filter((job) => isAllowedJobLocation(job.location) && isQualityJob(job) && potentialProfileMatch(job, profile));
  const failures = results.filter((result) => result.status === "rejected").length;
  const sourceDetails = results.map((result, index) => ({
    company: companies[index].company,
    status: result.status,
    jobs: result.status === "fulfilled" ? result.value.length : 0,
    error: result.status === "rejected" ? result.reason?.message || "Unknown source error" : undefined,
  }));
  return { jobs: balanceCompanies(deduplicateJobs(jobs), limit), companies: companies.length, failures, sourceDetails };
}
