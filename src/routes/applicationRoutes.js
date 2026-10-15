import express from "express";
import Application from "../models/Application.js";
import Job from "../models/Job.js";
import { authenticate } from "../middleware/authenticate.js";

const router = express.Router();

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function getBoardMatch(parsedUrl) {
  const hostname = parsedUrl.hostname.toLowerCase();
  const source = hostname.includes("linkedin.")
    ? "linkedin"
    : hostname.includes("naukri.")
      ? "naukri"
      : hostname.includes("hirist.")
        ? "hirist"
        : hostname.includes("indeed.")
          ? "indeed"
          : hostname.includes("adzuna.")
            ? "adzuna"
            : "";

  const externalIds = [];
  const urlPatterns = [];
  const addPathPattern = (path) => {
    if (!source || !path || path === "/") return;
    const pattern = new RegExp(`${escapeRegex(path.replace(/\/+$/, ""))}/?(?:[?#]|$)`, "i");
    urlPatterns.push(
      { source, applicationUrl: { $regex: pattern } },
      { source, sourceUrl: { $regex: pattern } },
    );
  };

  if (source === "indeed") {
    const jobKey = parsedUrl.searchParams.get("jk")?.trim();
    if (jobKey) {
      externalIds.push(`indeed-${jobKey}`);
      const pattern = new RegExp(`[?&]jk=${escapeRegex(jobKey)}(?:&|$)`, "i");
      urlPatterns.push(
        { source, applicationUrl: { $regex: pattern } },
        { source, sourceUrl: { $regex: pattern } },
      );
    }
  }

  if (source === "linkedin") {
    const jobId = parsedUrl.pathname.match(/(?:jobs\/view\/|job-detail[-/])([0-9]+)/i)?.[1];
    if (jobId) {
      externalIds.push(`linkedin-${jobId}`);
      addPathPattern(`/jobs/view/${jobId}`);
      addPathPattern(`/job-detail/${jobId}`);
    }
  }

  if (source === "adzuna") {
    const adzunaId = parsedUrl.pathname.match(/(?:details|land\/ad)[\-/]([0-9]+)/i)?.[1]
      || parsedUrl.searchParams.get("id")?.trim();
    if (adzunaId) {
      externalIds.push(adzunaId);
      addPathPattern(`/details/${adzunaId}`);
      addPathPattern(`/land/ad/${adzunaId}`);
      const pattern = new RegExp(`[?&]id=${escapeRegex(adzunaId)}(?:&|$)`, "i");
      urlPatterns.push(
        { source, applicationUrl: { $regex: pattern } },
        { source, sourceUrl: { $regex: pattern } },
      );
    }
  }

  // Hirist detail links and Adzuna/board tracking links often preserve the
  // same pathname while changing their query string. This also helps older
  // imports whose externalId was generated from the original URL.
  if (source === "hirist" || source === "naukri") addPathPattern(parsedUrl.pathname);

  return { source, externalIds, urlPatterns };
}

router.get("/", authenticate, async (req, res) => {
  try {
    const applications = await Application.find({ user: req.user._id }).sort({ updatedAt: -1 }).populate("job").lean();
    return res.json({ success: true, applications: applications.map((application) => ({
      id: application._id.toString(),
      status: application.status,
      notes: application.notes || "",
      submittedAt: application.submittedAt || null,
      createdAt: application.createdAt,
      updatedAt: application.updatedAt,
      job: application.job ? {
        id: application.job._id.toString(),
        title: application.job.title,
        company: application.job.company,
        location: application.job.location || "",
        applicationUrl: application.job.applicationUrl,
      } : null,
    })) });
  } catch (error) {
    console.error("Application listing failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to load applications." });
  }
});

router.post("/mark-submitted", authenticate, async (req, res) => {
  const applicationUrl = typeof req.body?.applicationUrl === "string" ? req.body.applicationUrl.trim() : "";
  if (!applicationUrl) return res.status(400).json({ success: false, message: "applicationUrl is required." });

  let parsedUrl;
  try {
    parsedUrl = new URL(applicationUrl);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("Unsupported protocol");
  } catch {
    return res.status(400).json({ success: false, message: "applicationUrl must be a valid HTTP or HTTPS URL." });
  }

  try {
    const { source, externalIds, urlPatterns } = getBoardMatch(parsedUrl);

    const job = await Job.findOne({ $or: [
      { applicationUrl },
      { sourceUrl: applicationUrl },
      ...externalIds.map((externalId) => ({ source, externalId })),
      ...urlPatterns,
    ] }).lean();
    if (!job) return res.status(404).json({ success: false, message: "This job is not in your imported jobs yet. Scan the job-board page first." });

    const notes = typeof req.body?.notes === "string" ? req.body.notes.slice(0, 5000) : "Marked as applied from the Portfolio AI extension.";
    const application = await Application.findOneAndUpdate(
      { user: req.user._id, job: job._id },
      { $set: { status: "submitted", notes, submittedAt: new Date() } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();

    return res.json({ success: true, application: {
      id: application._id.toString(),
      status: application.status,
      submittedAt: application.submittedAt,
      job: { id: job._id.toString(), title: job.title, company: job.company, applicationUrl: job.applicationUrl },
    } });
  } catch (error) {
    console.error("Mark application submitted failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to mark this application as submitted." });
  }
});

router.patch("/:applicationId", authenticate, async (req, res) => {
  const allowedStatuses = ["shortlisted", "skipped", "ready_for_review", "approved", "submitted", "interview", "rejected", "withdrawn"];
  const updates = {};
  if (allowedStatuses.includes(req.body?.status)) updates.status = req.body.status;
  if (req.body?.status === "submitted") updates.submittedAt = new Date();
  if (typeof req.body?.notes === "string") updates.notes = req.body.notes.slice(0, 5000);
  if (!Object.keys(updates).length) return res.status(400).json({ success: false, message: "No valid application changes provided." });

  try {
    const application = await Application.findOneAndUpdate({ _id: req.params.applicationId, user: req.user._id }, updates, { new: true }).lean();
    if (!application) return res.status(404).json({ success: false, message: "Application not found." });
    return res.json({ success: true, application: { id: application._id.toString(), status: application.status, notes: application.notes || "" } });
  } catch (error) {
    console.error("Application update failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update application." });
  }
});

export default router;
