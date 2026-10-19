import { readFileSync } from "node:fs";
import { deduplicateJobs, isAllowedJobLocation, isQualityJob, normalizeJobText } from "./jobDiscovery.js";
import { extractSkills } from "./skillMatching.js";

const DEFAULT_LIMIT = 100;
const CAREER_PAGE_TIMEOUT_MS = 10_000;
const JOB_DETAIL_TIMEOUT_MS = 7_000;
const MAX_HTML_JOB_LINKS = 12;
const DEFAULT_COMPANIES = JSON.parse(readFileSync(new URL("../config/companyCareerSources.json", import.meta.url), "utf8").replace(/^\uFEFF/, ""));
export const DEFAULT_RECRUITER_MESSAGE = "Hello, I’m interested in this opportunity and would welcome the chance to discuss how my experience could contribute to your team. Thank you for your consideration.";
const CAREER_PAGE_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-IN,en;q=0.9",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
};

function configuredCompanies() {
  const raw = String(process.env.COMPANY_CAREER_SOURCES || "").trim();
  let configured = [];
  try {
    configured = raw ? JSON.parse(raw.replace(/^\uFEFF/, "")) : [];
  } catch (error) {
    console.error("COMPANY_CAREER_SOURCES is not valid JSON:", error.message);
    configured = [];
  }
  const sources = new Map();
  for (const company of [...DEFAULT_COMPANIES, ...(Array.isArray(configured) ? configured : [])]) {
    if (!company?.company) continue;
    const identity = company.ats && company.board
      ? `${String(company.ats).toLowerCase()}::${String(company.board).toLowerCase()}`
      : normalizeJobText(company.careersUrl || company.company);
    sources.set(identity, company);
  }
  return [...sources.values()];
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
  if (typeof value === "object" && value) return [value.city, value.addressLocality, value.region, value.country, value.name, value.label, value.address].map(locationText).filter(Boolean).join(", ");
  return String(value || "").trim();
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
    applicationMessage: DEFAULT_RECRUITER_MESSAGE,
    requiredSkills: Array.isArray(fields.requiredSkills) && fields.requiredSkills.length
      ? fields.requiredSkills
      : extractSkills(`${title} ${description}`),
    applicationUrl,
    sourceUrl: applicationUrl,
    postedAt: fields.postedAt ? new Date(fields.postedAt) : new Date(),
    fetchedAt: new Date(),
    status: "open",
  };
}

async function getJson(url) {
  const response = await fetch(url, { headers: { ...CAREER_PAGE_HEADERS, Accept: "application/json" }, signal: AbortSignal.timeout(CAREER_PAGE_TIMEOUT_MS) });
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

async function smartRecruitersJobs(company) {
  const params = new URLSearchParams({ limit: "100", offset: "0", country: "in" });
  const payload = await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company.board)}/postings?${params}`);
  const postings = Array.isArray(payload.content) ? payload.content : [];
  const detailed = await Promise.allSettled(postings.map(async (posting) => {
    const details = posting.ref ? await getJson(posting.ref) : posting;
    const sections = details.jobAd?.sections || {};
    const sectionText = Object.values(sections).map((section) => section?.text || section?.content || "").join(" ");
    return normalizeJob(company, posting, {
      externalId: posting.id || details.id,
      title: details.name || posting.name,
      location: details.location || posting.location,
      description: sectionText || details.description || `${details.name || posting.name} at ${company.company}.`,
      applicationUrl: details.applyUrl || posting.applyUrl || `https://jobs.smartrecruiters.com/${company.board}/${posting.id}`,
      postedAt: details.releasedDate || posting.releasedDate,
    });
  }));
  return detailed.filter((result) => result.status === "fulfilled").map((result) => result.value);
}

function linkedAtsSource(company, html) {
  const normalized = String(html || "").replace(/\\\//g, "/").replace(/&amp;/g, "&");
  const greenhouse = normalized.match(/(?:https?:)?\/\/(?:boards|job-boards)\.greenhouse\.io\/([^/?#"'\\]+)/i)?.[1];
  if (greenhouse) return { ...company, ats: "greenhouse", board: greenhouse, careersUrl: `https://job-boards.greenhouse.io/${greenhouse}` };
  const lever = normalized.match(/(?:https?:)?\/\/jobs\.lever\.co\/([^/?#"'\\]+)/i)?.[1];
  if (lever) return { ...company, ats: "lever", board: lever, careersUrl: `https://jobs.lever.co/${lever}` };
  const ashby = normalized.match(/(?:https?:)?\/\/jobs\.ashbyhq\.com\/([^/?#"'\\]+)/i)?.[1];
  if (ashby) return { ...company, ats: "ashby", board: ashby, careersUrl: `https://jobs.ashbyhq.com/${ashby}` };
  const smartRecruiters = normalized.match(/(?:https?:)?\/\/jobs\.smartrecruiters\.com\/([^/?#"'\\]+)/i)?.[1];
  if (smartRecruiters) return { ...company, ats: "smartrecruiters", board: smartRecruiters, careersUrl: `https://jobs.smartrecruiters.com/${smartRecruiters}` };
  return null;
}

function annotateJobs(jobs, sourceType, sourceUrl) {
  const result = Array.isArray(jobs) ? jobs : [];
  result.sourceMeta = { sourceType, sourceUrl };
  return result;
}

function htmlJobLinks(html, baseUrl) {
  const links = [];
  for (const [, rawHref, rawText] of String(html || "").matchAll(/<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = absoluteUrl(decodeHtmlEntities(rawHref), baseUrl);
    const text = stripHtml(rawText);
    if (!href || !text || text.length < 4 || text.length > 180) continue;
    try {
      const url = new URL(href);
      if (url.origin !== new URL(baseUrl).origin) continue;
      if (!/(?:job|position|opening|vacanc|requisition|career-opportunit)/i.test(`${url.pathname} ${url.search}`)) continue;
      if (url.href.replace(/\/$/, "") === baseUrl.replace(/\/$/, "")) continue;
      links.push({ url: url.toString(), text });
    } catch {
      // Ignore malformed links.
    }
  }
  return links.filter((item, index, all) => all.findIndex((candidate) => candidate.url === item.url) === index).slice(0, MAX_HTML_JOB_LINKS);
}

function pageField(html, pattern) {
  return html.match(pattern)?.[1] || "";
}

function inferCareerLocation(html) {
  const text = stripHtml(html).slice(0, 20_000);
  return ["Bengaluru", "Bangalore", "Gurugram", "Gurgaon", "Noida", "Delhi NCR", "Hyderabad", "Pune", "Mumbai", "Chennai", "Remote"]
    .find((location) => new RegExp(`\\b${location.replace(" ", "\\s+")}\\b`, "i").test(text)) || "";
}

async function htmlLinkedJobs(company, html) {
  const links = htmlJobLinks(html, company.careersUrl);
  const details = await Promise.allSettled(links.map(async ({ url, text }) => {
    const response = await fetch(url, { headers: CAREER_PAGE_HEADERS, signal: AbortSignal.timeout(JOB_DETAIL_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Career job page returned HTTP ${response.status}.`);
    const detailHtml = await response.text();
    const structured = jsonLdJobPostings(detailHtml, company, url);
    if (structured.length) return structured[0];
    const title = stripHtml(pageField(detailHtml, /<h1[^>]*>([\s\S]*?)<\/h1>/i)
      || pageField(detailHtml, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)
      || pageField(detailHtml, /<title[^>]*>([\s\S]*?)<\/title>/i)
      || text).trim();
    const description = stripHtml(pageField(detailHtml, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)
      || pageField(detailHtml, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i)
      || pageField(detailHtml, /<(?:main|article|section)[^>]*>([\s\S]*?)<\/(?:main|article|section)>/i));
    const location = pageField(detailHtml, /<meta[^>]+(?:name|property)=["'](?:jobLocation|location)["'][^>]+content=["']([^"']+)/i)
      || inferCareerLocation(`${title} ${description}`);
    if (!title || !description) return null;
    return normalizeJob(company, null, { externalId: url, title, location, description, applicationUrl: url });
  }));
  return annotateJobs(details.filter((result) => result.status === "fulfilled" && result.value).map((result) => result.value), "html-links", company.careersUrl);
}

async function jsonLdJobs(company) {
  const response = await fetch(company.careersUrl, { headers: CAREER_PAGE_HEADERS, signal: AbortSignal.timeout(CAREER_PAGE_TIMEOUT_MS) });
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
    return htmlLinkedJobs(company, html);
  }
  return annotateJobs(jobs, "jsonld", company.careersUrl);
}

function jsonLdJobPostings(html, company, baseUrl) {
  const jobs = [];
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
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
          applicationUrl: entry.url || baseUrl,
          postedAt: entry.datePosted,
        }));
      }
    } catch {
      // Ignore malformed JSON-LD blocks and continue with other postings.
    }
  }
  return jobs;
}

async function ciscoJobs(company) {
  const response = await fetch(company.careersUrl, { headers: CAREER_PAGE_HEADERS, signal: AbortSignal.timeout(CAREER_PAGE_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Cisco careers returned HTTP ${response.status}.`);
  const html = (await response.text()).replace(/\\\//g, "/").replace(/&amp;/g, "&");
  const jobs = jsonLdJobPostings(html, company, company.careersUrl);
  const jobPaths = [...html.matchAll(/(?:https?:\/\/careers\.cisco\.com)?(\/global\/en\/job\/[^"'\\\s<>]+)/gi)]
    .map((match) => match[1].replace(/[?#].*$/, ""))
    .filter((path, index, all) => all.indexOf(path) === index)
    .slice(0, 100);
  const details = await Promise.allSettled(jobPaths.map(async (path) => {
    const url = absoluteUrl(path, company.careersUrl);
    const detailResponse = await fetch(url, { headers: CAREER_PAGE_HEADERS, signal: AbortSignal.timeout(JOB_DETAIL_TIMEOUT_MS) });
    if (!detailResponse.ok) throw new Error(`Cisco job page returned HTTP ${detailResponse.status}.`);
    const detailHtml = (await detailResponse.text()).replace(/\\\//g, "/");
    const structured = jsonLdJobPostings(detailHtml, company, url);
    if (structured.length) return structured[0];
    const title = detailHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
      || detailHtml.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]
      || detailHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      || "";
    const description = detailHtml.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1]
      || detailHtml.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i)?.[1]
      || "";
    const cleanTitle = stripHtml(title).replace(/\s*[|–-]\s*Cisco Careers.*$/i, "").trim();
    const cleanDescription = stripHtml(description);
    if (!cleanTitle || !cleanDescription) return null;
    const id = url.match(/\/job\/([^/]+)/i)?.[1] || url;
    return normalizeJob(company, null, { externalId: id, title: cleanTitle, description: cleanDescription, applicationUrl: url });
  }));
  return annotateJobs([...jobs, ...details.filter((item) => item.status === "fulfilled" && item.value).map((item) => item.value)], "cisco", company.careersUrl);
}

async function fetchCompanyJobs(company) {
  if (company.ats === "cisco") return ciscoJobs(company);
  if (company.ats === "greenhouse") return greenhouseJobs(company).then((jobs) => annotateJobs(jobs, "greenhouse", company.careersUrl));
  if (company.ats === "lever") return leverJobs(company).then((jobs) => annotateJobs(jobs, "lever", company.careersUrl));
  if (company.ats === "ashby") return ashbyJobs(company).then((jobs) => annotateJobs(jobs, "ashby", company.careersUrl));
  if (company.ats === "smartrecruiters") return smartRecruitersJobs(company).then((jobs) => annotateJobs(jobs, "smartrecruiters", company.careersUrl));
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
  const companyResults = results.map((result, index) => {
    const fetchedJobs = result.status === "fulfilled" ? result.value : [];
    const sourceMeta = result.status === "fulfilled" ? result.value.sourceMeta || {} : {};
    const acceptedJobs = fetchedJobs.filter((job) => isAllowedJobLocation(job.location, profile.preferredLocations) && isQualityJob(job));
    return { company: companies[index], result, fetchedJobs, acceptedJobs, sourceMeta };
  });
  const jobs = companyResults.flatMap(({ acceptedJobs }) => acceptedJobs);
  const failures = results.filter((result) => result.status === "rejected").length;
  const balancedJobs = balanceCompanies(deduplicateJobs(jobs), limit);
  const returnedIds = new Set(balancedJobs.map((job) => `${job.company}::${job.externalId}`));
  const sourceDetails = companyResults.map(({ company, result, fetchedJobs, acceptedJobs, sourceMeta }) => ({
    company: company.company,
    sourceType: sourceMeta.sourceType || company.ats || "unknown",
    sourceUrl: sourceMeta.sourceUrl || company.careersUrl,
    status: result.status,
    fetched: fetchedJobs.length,
    jobs: acceptedJobs.length,
    returned: acceptedJobs.filter((job) => returnedIds.has(`${job.company}::${job.externalId}`)).length,
    filtered: Math.max(0, fetchedJobs.length - acceptedJobs.length),
    error: result.status === "rejected" ? result.reason?.message || "Unknown source error" : undefined,
    reason: result.status === "rejected"
      ? "The configured career source failed."
      : fetchedJobs.length === 0
        ? "No machine-readable JobPosting entries or supported ATS feed were exposed by this career page."
        : acceptedJobs.length === 0
          ? "Fetched jobs were excluded by preferred location or listing-quality filters."
      : undefined,
  }));
  return { jobs: balancedJobs, companies: companies.length, failures, sourceDetails };
}
