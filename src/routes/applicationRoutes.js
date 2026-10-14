import express from "express";
import Application from "../models/Application.js";
import Job from "../models/Job.js";
import { authenticate } from "../middleware/authenticate.js";

const router = express.Router();

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
    const candidates = [applicationUrl];
    const jobIdMatch = parsedUrl.pathname.match(/(?:jobs\/view|job-detail|job-detail-)([0-9]+)/i);
    if (jobIdMatch) candidates.push(new RegExp(`/${jobIdMatch[1]}(?:[/?]|$)`));

    const job = await Job.findOne({ $or: [
      { applicationUrl: { $in: candidates.filter((candidate) => typeof candidate === "string") } },
      { sourceUrl: { $in: candidates.filter((candidate) => typeof candidate === "string") } },
      ...(jobIdMatch ? [{ externalId: jobIdMatch[1] }, { applicationUrl: candidates[1] }, { sourceUrl: candidates[1] }] : []),
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
