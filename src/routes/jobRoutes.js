import express from "express";
import { z } from "zod";
import Job from "../models/Job.js";
import JobMatch from "../models/JobMatch.js";
import Application from "../models/Application.js";
import User from "../models/User.js";
import { authenticate } from "../middleware/authenticate.js";
import { scoreJob } from "../services/aiMatching.js";
import { createAIProvider } from "../services/aiProvider.js";
import { allowedJobLocationFilter, deduplicateJobs, discoverJobs, isAllowedJobLocation, isQualityJob, isValidJobSourceUrl, JobDiscoveryError } from "../services/jobDiscovery.js";
import { discoverCompanyCareerJobs, stripHtml } from "../services/companyCareerDiscovery.js";

const router = express.Router();
const SCORE_CONCURRENCY = Math.max(1, Math.min(Number(process.env.AI_MAX_CONCURRENT_REQUESTS) || 2, 4));
// Career pages often omit structured skill lists. The general jobs list should
// show every career job that was actually evaluated; the AI Matches endpoint
// applies the stricter score/recommendation filter below.
const MIN_CAREER_MATCH_SCORE = 45;

async function filterRelevantCareerJobs(jobs, userId) {
  const careerJobIds = jobs.filter((job) => job.source === "company-career").map((job) => job._id);
  if (!careerJobIds.length) return jobs;
  const matches = await JobMatch.find({ user: userId, job: { $in: careerJobIds } })
    .select("job matchScore recommendation")
    .lean();
  const matchByJobId = new Map(matches.map((match) => [match.job.toString(), match]));
  return jobs.filter((job) => {
    if (job.source !== "company-career") return true;
    const match = matchByJobId.get(job._id.toString());
    return Boolean(match);
  });
}

async function getVisibleOpenJobs(userId, limit = 500) {
  const user = await User.findById(userId).select("preferredLocations").lean();
  const preferredLocations = user?.preferredLocations || [];
  const [jobs, submittedJobIds] = await Promise.all([
    Job.find({ status: "open", ...(preferredLocations.length ? {} : allowedJobLocationFilter) })
      .sort({ postedAt: -1, createdAt: -1 })
      .limit(Math.min(limit * 4, preferredLocations.length ? 500 : 100))
      .lean(),
    getSubmittedJobIds(userId),
  ]);
  const relevantJobs = await filterRelevantCareerJobs(jobs, userId);
  return deduplicateJobs(relevantJobs.filter((job) =>
    !submittedJobIds.has(job._id.toString())
    && isAllowedJobLocation(job.location, preferredLocations)
    && isValidJobSourceUrl(job.source, job.applicationUrl),
  ));
}

async function getSubmittedJobIds(userId) {
  const applications = await Application.find({ user: userId, status: "submitted" }).select("job").lean();
  return new Set(applications.map((application) => application.job?.toString()).filter(Boolean));
}

async function scoreWithLimit(items, worker) {
  const results = [];
  let cursor = 0;
  const runWorker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SCORE_CONCURRENCY, items.length) }, runWorker));
  return results;
}

const jobInput = z.object({
  title: z.string().trim().min(2).max(200),
  company: z.string().trim().min(2).max(160),
  location: z.string().trim().max(160).optional().default(""),
  employmentType: z.string().trim().max(80).optional(),
  description: z.string().trim().min(20).max(30_000),
  requiredSkills: z.array(z.string().trim().min(1).max(80)).max(50).optional().default([]),
  applicationUrl: z.string().url(),
  sourceUrl: z.string().url().optional(),
  salaryMin: z.number().nonnegative().optional(),
  salaryMax: z.number().nonnegative().optional(),
  salaryCurrency: z.string().trim().max(8).optional().default("INR"),
  postedAt: z.coerce.date().optional(),
});

const scoringInput = z.object({
  profile: z.record(z.unknown()),
  job: z.record(z.unknown()),
});

const importedJobInput = z.object({
  source: z.enum(["linkedin", "naukri", "hirist", "indeed"]),
  externalId: z.string().trim().min(1).max(300),
  title: z.string().trim().min(2).max(200),
  company: z.string().trim().min(1).max(160),
  location: z.string().trim().max(160).optional().default(""),
  description: z.string().trim().min(20).max(30_000),
  applicationUrl: z.string().url(),
  sourceUrl: z.string().url().optional(),
  postedAt: z.coerce.date().optional(),
});

const getCandidateProfile = (user) => ({
  name: user.name,
  email: user.email,
  location: user.location || "",
  userType: user.userType,
  bio: user.bio || "",
  verifiedSkills: user.skills || [],
  preferredRoles: user.preferredRoles || [],
  preferredLocations: user.preferredLocations || [],
  verifiedExperienceYears: user.experienceYears || null,
});

const serializeJob = (job, match = null) => ({
  id: job._id.toString(),
  source: job.source,
  title: job.title,
  company: job.company,
  location: job.location || "",
  employmentType: job.employmentType || "",
  description: stripHtml(job.description),
  requiredSkills: job.requiredSkills,
  salaryMin: job.salaryMin,
  salaryMax: job.salaryMax,
  salaryCurrency: job.salaryCurrency,
  applicationUrl: job.applicationUrl,
  sourceUrl: job.sourceUrl || job.applicationUrl,
  postedAt: job.postedAt,
  status: job.status,
  match,
});

router.get("/", authenticate, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const filter = { status: "open", ...(req.user.preferredLocations?.length ? {} : allowedJobLocationFilter) };
  if (search) filter.$text = { $search: search };

  try {
    const [jobs, submittedJobIds] = await Promise.all([
      Job.find(filter).sort({ postedAt: -1, createdAt: -1 }).limit(Math.min(limit * 4, req.user.preferredLocations?.length ? 500 : 100)).lean(),
      getSubmittedJobIds(req.user._id),
    ]);
    const visibleJobs = await filterRelevantCareerJobs(jobs, req.user._id);
    return res.json({ success: true, jobs: deduplicateJobs(visibleJobs.filter((job) => !submittedJobIds.has(job._id.toString()) && isAllowedJobLocation(job.location, req.user.preferredLocations) && isValidJobSourceUrl(job.source, job.applicationUrl))).slice(0, limit).map((job) => serializeJob(job)) });
  } catch (error) {
    console.error("Job listing failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to load jobs." });
  }
});

router.get("/summary", authenticate, async (req, res) => {
  try {
    const [visibleJobs, applications, shortlisted, interviews, readyForReview] = await Promise.all([
      getVisibleOpenJobs(req.user._id),
      Application.countDocuments({ user: req.user._id }),
      Application.countDocuments({ user: req.user._id, status: "shortlisted" }),
      Application.countDocuments({ user: req.user._id, status: "interview" }),
      Application.countDocuments({ user: req.user._id, status: "ready_for_review" }),
    ]);
    return res.json({ success: true, summary: { jobsDiscovered: visibleJobs.length, applications, shortlisted, interviews, readyForReview } });
  } catch (error) {
    console.error("Job summary failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to load dashboard summary." });
  }
});

router.get("/suggestions", authenticate, async (req, res) => {
  try {
    const [matches, submittedJobIds] = await Promise.all([
      JobMatch.find({ user: req.user._id }).sort({ matchScore: -1, updatedAt: -1 }).limit(80).populate("job").lean(),
      getSubmittedJobIds(req.user._id),
    ]);
    const qualityMatches = matches.filter((item) => item.job?.status === "open" && !submittedJobIds.has(item.job._id.toString()) && isAllowedJobLocation(item.job.location, req.user.preferredLocations) && isQualityJob(item.job) && item.matchScore >= MIN_CAREER_MATCH_SCORE && item.recommendation !== "skip");
    const uniqueJobs = deduplicateJobs(qualityMatches.map((item) => item.job));
    const uniqueIds = new Set(uniqueJobs.map((job) => job._id.toString()));
    return res.json({ success: true, suggestions: qualityMatches.filter((item) => uniqueIds.has(item.job._id.toString())).slice(0, 20).map((item) => serializeJob(item.job, {
      matchScore: item.matchScore,
      recommendation: item.recommendation,
      matchingSkills: item.matchingSkills,
      missingSkills: item.missingSkills,
      reasons: item.reasons,
      concerns: item.concerns,
      salaryCompatibility: item.salaryCompatibility,
      modelsUsed: item.modelsUsed,
      agreement: item.agreement,
      modelResults: item.modelResults,
    })) });
  } catch (error) {
    console.error("Job suggestions failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to load job suggestions." });
  }
});

router.post("/discover", authenticate, async (req, res) => {
  try {
    const profile = getCandidateProfile(req.user);
    const discovery = await discoverJobs(profile);
    const savedJobs = await Promise.all(discovery.jobs.map((job) => Job.findOneAndUpdate(
      { source: job.source, externalId: job.externalId },
      { $set: job, $setOnInsert: { createdBy: req.user._id } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean()));

    const scoreLimit = Math.min(Number(process.env.AI_DISCOVERY_SCORE_LIMIT) || 50, savedJobs.length);
    const scoreResults = await scoreWithLimit(savedJobs.slice(0, scoreLimit), async (job) => {
      const result = await scoreJob(profile, job);
      await JobMatch.findOneAndUpdate(
        { user: req.user._id, job: job._id },
        { user: req.user._id, job: job._id, ...result, evaluatedAt: new Date() },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      return result;
    });
    const aiScored = scoreResults.filter((result) => result.status === "fulfilled").length;
    const aiFailures = scoreResults.filter((result) => result.status === "rejected").length;
    const message = savedJobs.length === 0
      ? "No usable jobs were returned by the job source. Check the search country, profile roles or skills, and Adzuna credentials."
      : aiFailures
        ? "Jobs were imported, but some AI scores could not be calculated."
        : "Jobs discovered and scored successfully.";
    return res.json({
      success: true,
      discovered: savedJobs.length,
      rawResults: discovery.rawCount,
      skippedResults: discovery.skippedCount,
      aiScored,
      aiFailures,
      source: "adzuna",
      country: discovery.country,
      query: discovery.query,
      message,
    });
  } catch (error) {
    const status = error instanceof JobDiscoveryError && error.code === "JOB_SOURCE_NOT_CONFIGURED" ? 503 : error.code === "PROFILE_SEARCH_DATA_REQUIRED" ? 400 : 502;
    console.error("Job discovery failed:", error.message);
    return res.status(status).json({ success: false, message: error.message || "Unable to discover jobs." });
  }
});

router.post("/discover-careers", authenticate, async (req, res) => {
  try {
    const profile = getCandidateProfile(req.user);
    const discovery = await discoverCompanyCareerJobs(profile);
    const savedJobs = await Promise.all(discovery.jobs.map((job) => Job.findOneAndUpdate(
      { source: job.source, externalId: job.externalId },
      { $set: job, $setOnInsert: { createdBy: req.user._id } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean()));
    const scoreLimit = Math.min(Number(process.env.AI_DISCOVERY_SCORE_LIMIT) || 50, savedJobs.length);
    const scoreResults = await scoreWithLimit(savedJobs.slice(0, scoreLimit), async (job) => {
      const result = await scoreJob(profile, job);
      await JobMatch.findOneAndUpdate(
        { user: req.user._id, job: job._id },
        { user: req.user._id, job: job._id, ...result, evaluatedAt: new Date() },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      return result;
    });
    const visibleJobs = await getVisibleOpenJobs(req.user._id);
    const visibleJobIds = new Set(visibleJobs.map((job) => job._id.toString()));
    const visibleDiscovered = savedJobs.filter((job) => visibleJobIds.has(job._id.toString())).length;
    return res.json({
      success: true,
      discovered: savedJobs.length,
      visibleDiscovered,
      companies: discovery.companies,
      sourceFailures: discovery.failures,
      sourceDetails: discovery.sourceDetails,
      aiScored: scoreResults.filter((result) => result.status === "fulfilled").length,
      aiFailures: scoreResults.filter((result) => result.status === "rejected").length,
      message: savedJobs.length ? "Company career jobs discovered and scored successfully." : "No matching company career jobs were found. Add ATS or career-page sources to COMPANY_CAREER_SOURCES.",
    });
  } catch (error) {
    console.error("Company career discovery failed:", error.message);
    return res.status(502).json({ success: false, message: error.message || "Unable to discover company career jobs." });
  }
});

router.post("/import", authenticate, async (req, res) => {
  const jobs = Array.isArray(req.body?.jobs) ? req.body.jobs.slice(0, 50) : [];
  if (!jobs.length) return res.status(400).json({ success: false, message: "At least one job is required." });
  const parsedJobs = jobs.map((job) => importedJobInput.safeParse(job)).filter((result) => result.success).map((result) => result.data).filter((job) => isQualityJob(job) && isValidJobSourceUrl(job.source, job.applicationUrl));
  if (!parsedJobs.length) return res.status(400).json({ success: false, message: "No valid LinkedIn or Naukri jobs were supplied." });

  try {
    const profile = getCandidateProfile(req.user);
    const savedJobs = await Promise.all(parsedJobs.map((job) => Job.findOneAndUpdate(
      { source: job.source, externalId: job.externalId },
      { $set: { ...job, fetchedAt: new Date(), status: "open", sourceUrl: job.sourceUrl || job.applicationUrl }, $setOnInsert: { createdBy: req.user._id } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean()));
    const scoreLimit = Math.min(Number(process.env.AI_DISCOVERY_SCORE_LIMIT) || 50, savedJobs.length);
    const scores = await scoreWithLimit(savedJobs.slice(0, scoreLimit), async (job) => {
      const result = await scoreJob(profile, job);
      await JobMatch.findOneAndUpdate({ user: req.user._id, job: job._id }, { user: req.user._id, job: job._id, ...result, evaluatedAt: new Date() }, { upsert: true, new: true, setDefaultsOnInsert: true });
    });
    return res.json({ success: true, imported: savedJobs.length, aiScored: scores.filter((result) => result.status === "fulfilled").length, aiFailures: scores.filter((result) => result.status === "rejected").length });
  } catch (error) {
    console.error("Local job import failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to import local jobs." });
  }
});

router.post("/", authenticate, async (req, res) => {
  const parsed = jobInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message || "Invalid job data." });

  try {
    const job = await Job.create({ ...parsed.data, source: "manual", createdBy: req.user._id, fetchedAt: new Date() });
    return res.status(201).json({ success: true, job: serializeJob(job) });
  } catch (error) {
    console.error("Job creation failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to save job." });
  }
});

router.post("/score", authenticate, async (req, res) => {
  const parsed = scoringInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "profile and job objects are required." });
  try {
    const result = await scoreJob(parsed.data.profile, parsed.data.job);
    return res.json({ success: true, result });
  } catch (error) {
    console.error("Job score error:", error.message);
    return res.status(error.code === "AI_RATE_LIMITED" ? 429 : 503).json({ success: false, message: error.message || "AI scoring failed." });
  }
});

router.post("/:jobId/score", authenticate, async (req, res) => {
  try {
    const job = await Job.findById(req.params.jobId).lean();
    if (!job) return res.status(404).json({ success: false, message: "Job not found." });
    const result = await scoreJob(getCandidateProfile(req.user), job);
    const match = await JobMatch.findOneAndUpdate(
      { user: req.user._id, job: job._id },
      { user: req.user._id, job: job._id, ...result, evaluatedAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    return res.json({ success: true, match: { ...result, id: match._id.toString() } });
  } catch (error) {
    console.error("Job match error:", error.message);
    return res.status(error.code === "AI_RATE_LIMITED" ? 429 : 503).json({ success: false, message: error.message || "Unable to analyze this job." });
  }
});

router.post("/:jobId/apply", authenticate, async (req, res) => {
  try {
    const job = await Job.findById(req.params.jobId).lean();
    if (!job) return res.status(404).json({ success: false, message: "Job not found." });
    const application = await Application.findOneAndUpdate(
      { user: req.user._id, job: job._id },
      { $setOnInsert: { user: req.user._id, job: job._id, status: "ready_for_review" } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).populate("job").lean();
    return res.status(201).json({ success: true, message: "Application prepared for your review. It was not submitted.", application: { id: application._id.toString(), status: application.status, job: serializeJob(application.job) } });
  } catch (error) {
    console.error("Application preparation failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to prepare application." });
  }
});

router.post("/ai/test", authenticate, async (req, res) => {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  if (!prompt) return res.status(400).json({ success: false, message: "Prompt is required." });
  try {
    const provider = createAIProvider();
    const result = await provider.generateText({ system: "You are a concise job search assistant. Do not invent candidate facts.", user: prompt });
    return res.json({ success: true, provider: provider.name, result });
  } catch (error) {
    console.error("AI test failed:", error.message);
    return res.status(error.code === "AI_RATE_LIMITED" ? 429 : 503).json({ success: false, message: error.message || "Unable to reach the AI provider." });
  }
});

router.get("/health", (req, res) => res.json({ status: "ok", service: "portfolio-job-ai" }));

export default router;
