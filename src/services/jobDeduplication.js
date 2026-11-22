const normalize = (value) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const companyKey = (value) => normalize(value).replace(/\s+(?:(?:private|pvt|limited|ltd|inc|llc|corp|corporation|technologies limited)\s*)+$/, "").trim();
const locationKey = (value) => normalize(value).replace(/\bgurgaon\b/g, "gurugram").replace(/\b(?:india|haryana|hybrid|onsite|on site)\b/g, "").trim().replace(/\s+/g, " ");
const titleKey = (value) => normalize(value).replace(/\b(?:front end)\b/g, "frontend").replace(/\b(?:developer|programmer)\b/g, "engineer").replace(/\bsr\b/g, "senior");

export function postingUrl(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return "";
    const host = url.hostname.replace(/^www\./, "");
    const linkedin = /(?:^|\.)linkedin\.com$/.test(host) && url.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/);
    if (linkedin) return `linkedin.com/jobs/view/${linkedin[1]}`;
    if (/(?:^|\.)indeed\.[a-z.]+$/.test(host) && url.searchParams.get("jk")) return `${host}/viewjob?jk=${url.searchParams.get("jk")}`;
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|oga|source|ref|trackingid|trk|refid|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return `${url.host.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}${url.search}`;
  } catch {
    return "";
  }
}

export function sourceRecord(job) {
  return { source: job.source, externalId: job.externalId, applicationUrl: job.applicationUrl, sourceUrl: job.sourceUrl || job.applicationUrl, ...(job.canonicalUrl ? { canonicalUrl: job.canonicalUrl } : {}) };
}

export function identityKeys(job) {
  const sources = [job, ...(job.sources || [])];
  return [...new Set(sources.flatMap((entry) => [
    entry.externalId && entry.source && `id:${entry.source}:${entry.externalId}`,
    ...[entry.applicationUrl, entry.sourceUrl, entry.canonicalUrl].map(postingUrl).filter((url) => {
      // Shared company careers and search URLs are not posting identities.
      return url && /[/\w][/?].+/.test(url) && !/\/(?:careers|jobs|search)(?:\/?$|\?)/i.test(url);
    }).map((url) => `url:${url}`),
  ]).filter(Boolean))];
}

const shingles = (value) => {
  const words = normalize(String(value ?? "").replace(/<[^>]*>/g, " ")).split(" ");
  return new Set(words.slice(0, -2).map((word, index) => `${word} ${words[index + 1]} ${words[index + 2]}`));
};

export function comparePostings(a, b) {
  if (identityKeys(a).some((key) => identityKeys(b).includes(key))) return "exact";
  if (!companyKey(a.company) || companyKey(a.company) !== companyKey(b.company)) return null;
  const leftTitle = titleKey(a.title);
  const rightTitle = titleKey(b.title);
  if (!leftTitle || leftTitle !== rightTitle) return null;
  const leftLocation = locationKey(a.location);
  const rightLocation = locationKey(b.location);
  if (leftLocation && rightLocation && leftLocation !== rightLocation) return null;
  const left = shingles(a.description);
  const right = shingles(b.description);
  const overlap = [...left].filter((word) => right.has(word)).length;
  const similarity = overlap / (left.size + right.size - overlap || 1);
  const days = a.postedAt && b.postedAt ? Math.abs(new Date(a.postedAt) - new Date(b.postedAt)) / 86400000 : null;
  const sourceIds = new Map([a, ...(a.sources || [])].filter((job) => job.externalId).map((job) => [job.source, job.externalId]));
  const conflictingIds = [b, ...(b.sources || [])].some((job) => job.externalId && sourceIds.has(job.source) && sourceIds.get(job.source) !== job.externalId);
  const requisition = (job) => normalize(job.requisitionId || String(job.description || "").match(/\b(?:requisition|req)\s*(?:id|number|#)\s*[:#-]?\s*([a-z0-9-]*\d[a-z0-9-]*)\b/i)?.[1]);
  const leftReq = requisition(a);
  const rightReq = requisition(b);
  if (leftReq && rightReq && leftReq !== rightReq) return "possible";
  if (!conflictingIds && a.source !== b.source && leftLocation && leftLocation === rightLocation && overlap >= 30 && similarity >= 0.92 && (days === null || days <= 14)) return "probable";
  return "possible";
}

export function collapsePostings(jobs) {
  const identities = new Map();
  const companies = new Map();
  const result = [];
  for (const job of jobs) {
    const keys = identityKeys(job);
    const company = companyKey(job.company);
    const candidates = companies.get(company) || [];
    const match = keys.map((key) => identities.get(key)).find(Boolean)
      || candidates.find((candidate) => comparePostings(candidate, job) === "probable");
    if (match) {
      const sources = new Map([sourceRecord(match), ...match.sources, sourceRecord(job), ...(job.sources || [])].map((source) => [JSON.stringify(source), source]));
      match.sources = [...sources.values()];
      match.submitted ||= job.submitted;
      match.possibleDuplicateIds = [...(match.possibleDuplicateIds || []), ...(job.possibleDuplicateIds || [])];
      keys.forEach((key) => identities.set(key, match));
      continue;
    }
    const record = { ...job, sources: [...(job.sources || [])] };
    keys.forEach((key) => identities.set(key, record));
    candidates.push(record);
    companies.set(company, candidates);
    result.push(record);
  }
  return result;
}
