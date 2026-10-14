import "dotenv/config";
import { existsSync } from "node:fs";
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
const dryRun = Boolean(args.get("dry-run"));
const waitMs = Math.max(Number(args.get("wait") || 8_000), 1_000);
const installedChrome = process.env.LOCAL_CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const chromeUserDataDir = process.env.LOCAL_CHROME_USER_DATA_DIR || "";
const chromeProfile = process.env.LOCAL_CHROME_PROFILE || "Default";
const cdpUrl = process.env.LOCAL_CHROME_CDP_URL || "";

if (!token && !dryRun) {
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

let browser;
let context;
let ownsContext = false;

if (cdpUrl) {
  browser = await chromium.connectOverCDP(cdpUrl);
  context = browser.contexts()[0];
  if (!context) throw new Error("No Chrome browser context is available at LOCAL_CHROME_CDP_URL.");
} else {
  context = await chromium.launchPersistentContext(chromeUserDataDir || profileDir, {
    headless: false,
    ...(chromeUserDataDir ? { args: [`--profile-directory=${chromeProfile}`] } : {}),
    ...(existsSync(installedChrome) ? { executablePath: installedChrome } : {}),
  });
  ownsContext = true;
}

const page = context.pages()[0] || await context.newPage();
await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
console.log(`Opened ${site} job search. If login or CAPTCHA is shown, complete it in the browser window.`);
await page.waitForTimeout(waitMs);

const extraction = await page.evaluate((currentSite) => {
  const selectors = currentSite === "linkedin"
    ? ["li.jobs-search-results__list-item", ".job-card-container", "li[data-occludable-job-id]", "main li"]
    : ["article.jobTuple", ".srp-jobtuple-wrapper", "div.jobTuple"];
  const cards = currentSite === "linkedin"
    ? [...document.querySelectorAll('a[href*="/jobs/view/"]')].map((link) => link.closest("li") || link.parentElement)
    : selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
  const text = (root, selectorsToTry) => selectorsToTry.map((selector) => root.querySelector(selector)?.textContent?.trim()).find(Boolean) || "";
  const href = (root, selectorsToTry) => selectorsToTry.map((selector) => root.querySelector(selector)?.href).find(Boolean) || "";
  const jobs = [...new Map(cards.filter(Boolean).map((card, index) => {
    const url = href(card, currentSite === "linkedin" ? ['a[href*="/jobs/view/"]', "a.base-card__full-link", "a.job-card-container__link", "a"] : ["a.title", "a"]);
    const lines = (card.innerText || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
    return [url || `${currentSite}-${index}`, {
      source: currentSite,
      externalId: url || `${currentSite}-${index}`,
      title: text(card, currentSite === "linkedin" ? ["h3.base-search-card__title", ".job-card-list__title", "h3", 'a[href*="/jobs/view/"]'] : [".title", "a.title"]) || lines[0] || "",
      company: text(card, currentSite === "linkedin" ? ["h4.base-search-card__subtitle", ".job-card-container__company-name", "h4"] : [".comp-name", ".companyInfo a"]) || lines[1] || "",
      location: text(card, currentSite === "linkedin" ? [".job-search-card__location", ".job-card-container__metadata-item"] : [".locWdth", ".loc"]) || lines[2] || "",
      description: text(card, currentSite === "linkedin" ? [".base-search-card__snippet", ".job-card-list__description"] : [".job-desc", ".job-description"]) || lines.slice(2).join(" "),
      applicationUrl: url,
      sourceUrl: url,
    }];
  }))].map(([, job]) => ({
    ...job,
    // Search result cards frequently omit the full description. Keep the
    // listing and let the backend score it using the available job details.
    description: job.description || `${job.title} at ${job.company}. Review the original listing for the full requirements.`,
  })).filter((job) => job.title && job.company && job.applicationUrl);
  return {
    jobs,
    cards: cards.length,
    jobLinks: document.querySelectorAll('a[href*="/jobs/view/"]').length,
    title: document.title,
    url: location.href,
  };
}, site);
const jobs = extraction.jobs;

if (!jobs.length) {
  console.error("No jobs were extracted:", JSON.stringify({
    cards: extraction.cards,
    jobLinks: extraction.jobLinks,
    title: extraction.title,
    url: extraction.url,
  }, null, 2));
  if (ownsContext) await context.close();
  else await browser.close();
  process.exit(2);
}

if (dryRun) {
  console.log(JSON.stringify({ site, found: jobs.length, jobs }, null, 2));
  if (ownsContext) await context.close();
  else await browser.close();
  process.exit(0);
}

const response = await fetch(`${apiBase}/api/jobs/import`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ jobs }),
});
const result = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(result.message || `Import failed with HTTP ${response.status}.`);
console.log(JSON.stringify({ site, found: jobs.length, ...result }, null, 2));
if (ownsContext) await context.close();
else await browser.close();
