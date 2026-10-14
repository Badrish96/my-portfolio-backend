import ollama from "ollama";
import { z } from "zod";

export const MatchResultSchema = z.object({
  matchScore: z.number().min(0).max(100),
  matchingSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  reasons: z.array(z.string()),
  recommendation: z.enum(["apply", "review", "skip"]),
});

export async function scoreJob(profile, job) {
  const model = process.env.OLLAMA_MODEL || "qwen2.5:3b";

  const response = await ollama.chat({
    model,
    stream: false,
    messages: [
      {
        role: "system",
        content:
          "You are a strict job-matching assistant. Compare the verified candidate profile with the job. Never invent skills or experience. Return valid JSON only.",
      },
      {
        role: "user",
        content: JSON.stringify({ profile, job }),
      },
    ],
    format: {
      type: "object",
      properties: {
        matchScore: { type: "number" },
        matchingSkills: { type: "array", items: { type: "string" } },
        missingSkills: { type: "array", items: { type: "string" } },
        reasons: { type: "array", items: { type: "string" } },
        recommendation: { type: "string", enum: ["apply", "review", "skip"] },
      },
      required: ["matchScore", "matchingSkills", "missingSkills", "reasons", "recommendation"],
    },
  });

  const text = response.message.content;
  return MatchResultSchema.parse(JSON.parse(text));
}
