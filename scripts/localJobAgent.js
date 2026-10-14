import "dotenv/config";
import { chromium } from "playwright";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (!value.startsWith("--")) continue;
  args.set(value.slice(2), process.argv[index + 1]?.startsWith("--") ? true : process.argv[index + 1] || true);
}

const site = String(args.get("site") || "linkedin").toLowerCase();
const apiBase = String(args.get("api") || process.env.PORTFOLIO_API_URL || "http://localhost:5000").replace(/\/$/, "");
const token = String(args.get("token") || process.env.PORTFOLIO_AUTH_TOKEN || "");
const keywords = String(args.get("keywords") || process.env.JOB_SEARCH_KEYWORDS || "React Developer");
const location = String(args.get("location") || process.env.JOB_SEARCH_LOCATION || "India");
const profileDir = process.env.LOCAL_BROWSER_PROFILE_DIR || ".local-browser-profile";

if (!token) {
  console.error("Set PORTFOLIO_AUTH_TOKEN or pass --token with a valid portfolio login token.");
  process.exit(1);
}
if (!["linkedin", "naukri"].includes(site)) {
  console.error("Use --site linkedin or --site naukri.");
  process.exit(1);
}

const encode = (value) => encodeURIComponent(value);
const searchUrl = site === "linkedin"
  ? `https://www.linkedin.com/jobs/search/?keywords=${encode(keywords)}&location=${encode(location)}`
  : `https://www.naukri.com/${keywords.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-jobs-in-${location.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

const context = await chromium.launchPersistentContext(profileDir, { headless: false });
const page = context.pages()[0] || await context.newPage();
await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
console.log(`Opened ${site} job search. If login or CAPTCHA is shown, complete it in the browser window.`);
await page.waitForTimeout(8_000);

const jobs = await page.evaluate((currentSite) => {
  const selectors = currentSite === "linkedin"
    ? ["li.jobs-search-results__list-item", ".job-card-container", "li[data-occludable-job-id]"]
    : ["article.jobTuple", ".srp-jobtuple-wrapper", "div.jobTuple"];
  const cards = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
  const text = (root, selectorsToTry) => selectorsToTry.map((selector) => root.querySelector(selector)?.textContent?.trim()).find(Boolean) || "";
  const href = (root, selectorsToTry) => selectorsToTry.map((selector) => root.querySelector(selector)?.href).find(Boolean) || "";
  return [...new Map(cards.map((card, index) => {
    const url = href(card, currentSite === "linkedin" ? ["a.base-card__full-link", "a.job-card-container__link", "a"] : ["a.title", "a"]);
    return [url || `${currentSite}-${index}`, {
      source: currentSite,
      externalId: url || `${currentSite}-${index}`,
      title: text(card, currentSite === "linkedin" ? ["h3.base-search-card__title", ".job-card-list__title", "h3"] : [".title", "a.title"]),
      company: text(card, currentSite === "linkedin" ? ["h4.base-search-card__subtitle", ".job-card-container__company-name", "h4"] : [".comp-name", ".companyInfo a"]),
      location: text(card, currentSite === "linkedin" ? [".job-search-card__location", ".job-card-container__metadata-item"] : [".locWdth", ".loc"]),
      description: text(card, currentSite === "linkedin" ? [".base-search-card__snippet", ".job-card-list__description"] : [".job-desc", ".job-description"]),
      applicationUrl: url,
      sourceUrl: url,
    }];
  }))].map(([, job]) => job).filter((job) => job.title && job.company && job.applicationUrl && job.description.length >= 20);
}, site);

if (!jobs.length) {
  console.error("No jobs were extracted. The site may require login, CAPTCHA, or its page structure may have changed.");
  await context.close();
  process.exit(2);
}

const response = await fetch(`${apiBase}/api/jobs/import`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ jobs }),
});
const result = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(result.message || `Import failed with HTTP ${response.status}.`);
console.log(JSON.stringify({ site, found: jobs.length, ...result }, null, 2));
await context.close();
