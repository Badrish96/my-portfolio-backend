import express from "express";
import Application from "../models/Application.js";
import { authenticate } from "../middleware/authenticate.js";

const router = express.Router();

router.get("/", authenticate, async (req, res) => {
  try {
    const applications = await Application.find({ user: req.user._id }).sort({ updatedAt: -1 }).populate("job").lean();
    return res.json({ success: true, applications: applications.map((application) => ({
      id: application._id.toString(),
      status: application.status,
      notes: application.notes || "",
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

router.patch("/:applicationId", authenticate, async (req, res) => {
  const allowedStatuses = ["shortlisted", "skipped", "ready_for_review", "approved", "interview", "rejected", "withdrawn"];
  const updates = {};
  if (allowedStatuses.includes(req.body?.status)) updates.status = req.body.status;
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
