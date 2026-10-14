import express from "express";
import { z } from "zod";
import Job from "../models/Job.js";
import JobMatch from "../models/JobMatch.js";
import Application from "../models/Application.js";
import { authenticate } from "../middleware/authenticate.js";
import { scoreJob } from "../services/aiMatching.js";
import { createAIProvider } from "../services/aiProvider.js";

const router = express.Router();

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

const getCandidateProfile = (user) => ({
  name: user.name,
  email: user.email,
  location: user.location || "",
  userType: user.userType,
  bio: user.bio || "",
  verifiedSkills: user.skills || [],
  verifiedExperienceYears: user.experienceYears || null,
});

const serializeJob = (job, match = null) => ({
  id: job._id.toString(),
  source: job.source,
  title: job.title,
  company: job.company,
  location: job.location || "",
  employmentType: job.employmentType || "",
  description: job.description,
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
  const filter = { status: "open" };
  if (search) filter.$text = { $search: search };

  try {
    const jobs = await Job.find(filter).sort({ postedAt: -1, createdAt: -1 }).limit(limit).lean();
    return res.json({ success: true, jobs: jobs.map((job) => serializeJob(job)) });
  } catch (error) {
    console.error("Job listing failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to load jobs." });
  }
});

router.get("/summary", authenticate, async (req, res) => {
  try {
    const [jobsDiscovered, applications, shortlisted, interviews, readyForReview] = await Promise.all([
      Job.countDocuments({ status: "open" }),
      Application.countDocuments({ user: req.user._id }),
      Application.countDocuments({ user: req.user._id, status: "shortlisted" }),
      Application.countDocuments({ user: req.user._id, status: "interview" }),
      Application.countDocuments({ user: req.user._id, status: "ready_for_review" }),
    ]);
    return res.json({ success: true, summary: { jobsDiscovered, applications, shortlisted, interviews, readyForReview } });
  } catch (error) {
    console.error("Job summary failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to load dashboard summary." });
  }
});

router.get("/suggestions", authenticate, async (req, res) => {
  try {
    const matches = await JobMatch.find({ user: req.user._id }).sort({ matchScore: -1, updatedAt: -1 }).limit(20).populate("job").lean();
    return res.json({ success: true, suggestions: matches.filter((item) => item.job?.status === "open").map((item) => serializeJob(item.job, {
      matchScore: item.matchScore,
      recommendation: item.recommendation,
      matchingSkills: item.matchingSkills,
      missingSkills: item.missingSkills,
      reasons: item.reasons,
      concerns: item.concerns,
      salaryCompatibility: item.salaryCompatibility,
    })) });
  } catch (error) {
    console.error("Job suggestions failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to load job suggestions." });
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
