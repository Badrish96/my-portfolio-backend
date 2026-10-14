import express from "express";
import { scoreJob } from "../services/aiMatching.js";
import ollama from "ollama";

const router = express.Router();

const demoJobs = [
  {
    title: "Senior Frontend Engineer",
    company: "TechNova",
    location: "Remote",
    match: 94,
    stage: "Shortlisted",
  },
  {
    title: "React Developer",
    company: "PixelForge",
    location: "Gurugram",
    match: 88,
    stage: "Under review",
  },
  {
    title: "Full Stack Engineer",
    company: "CloudNest",
    location: "Bengaluru",
    match: 81,
    stage: "Saved",
  },
];

router.get("/", (req, res) => {
  res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
  res.json(demoJobs);
});

router.get("/health", (req, res) => {
  res.json({ status: "ok", service: "portfolio-job-ai" });
});

router.post("/score", async (req, res) => {
  const { profile, job } = req.body || {};

  if (!profile || !job) {
    return res.status(400).json({ error: "profile and job are required" });
  }

  try {
    const result = await scoreJob(profile, job);
    res.json(result);
  } catch (error) {
    console.error("Job score error:", error);
    res.status(500).json({ error: "AI scoring failed" });
  }
});

router.post("/ai/test", async (req, res) => {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : "";

  if (!prompt.trim()) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  try {
    const response = await ollama.chat({
      model: process.env.OLLAMA_MODEL || "qwen2.5:3b",
      messages: [
        { role: "system", content: "You are a local job AI assistant. Answer politely and concisely." },
        { role: "user", content: prompt },
      ],
      stream: false,
    });

    res.json({ result: response.message.content });
  } catch (error) {
    console.error("AI test failed:", error);
    res.status(500).json({ error: "Unable to reach the local Ollama model" });
  }
});

export default router;
