import { createHash } from "node:crypto";
import { extractSkills } from "./skillMatching.js";

export const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const vectorCache = new Map();
const terms = (value) => new Set(String(value).toLowerCase().match(/[a-z0-9]{3,}/g) || []);
const cosine = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0) / (Math.hypot(...a) * Math.hypot(...b) || 1);

async function embed(inputs) {
  const model = process.env.JOB_EMBEDDING_MODEL;
  if (!model) return null;
  const base = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const keys = inputs.map((input) => hash([base, model, input]));
  const missing = inputs.flatMap((input, index) => vectorCache.has(keys[index]) ? [] : [index]);
  if (missing.length) {
    const response = await fetch(new URL("/api/embed", base), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: missing.map((index) => inputs[index]) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Embedding request failed.");
    const { embeddings } = await response.json();
    if (!Array.isArray(embeddings) || embeddings.length !== missing.length || embeddings.some((vector) =>
      !Array.isArray(vector) || !vector.length || vector.length > 4096 || vector.length !== embeddings[0].length || !vector.every(Number.isFinite))) throw new Error("Invalid embeddings.");
    missing.forEach((index, offset) => vectorCache.set(keys[index], embeddings[offset]));
  }
  const result = keys.map((key) => vectorCache.get(key));
  while (vectorCache.size > 500) vectorCache.delete(vectorCache.keys().next().value);
  return result.every((vector) => vector.length === result[0].length) ? result : null;
}

export async function retrieveProfile(profile, job) {
  const chunks = ["resumeSummary", "experienceDetails", "projectDetails", "certifications", "educationDetails"].flatMap((kind) =>
    String(profile[kind] || "").slice(0, 10000).split(/\n\s*\n/).flatMap((paragraph) =>
      (paragraph.match(/[\s\S]{1,900}(?:\s|$)|[\s\S]{1,900}/g) || []).map((text) => ({ kind, text: text.trim() })).filter(({ text }) => text)));
  const description = String(job.description || "");
  const query = [job.title, ...(Array.isArray(job.requiredSkills) ? job.requiredSkills : []), description.slice(0, 3500)].join(" ");
  const queryTerms = terms(query);
  const querySkills = new Set(extractSkills(query));
  const ranked = chunks.map((chunk) => {
    const words = terms(chunk.text);
    const hits = [...words].filter((word) => queryTerms.has(word)).length;
    const skillHits = extractSkills(chunk.text).filter((skill) => querySkills.has(skill)).length;
    const lexical = Math.min(1, (hits + 3 * skillHits) / Math.max(8, Math.sqrt(words.size) * 2));
    return { ...chunk, lexical };
  }).sort((a, b) => b.lexical - a.lexical).slice(0, 12);
  const vectors = ranked.length ? await embed([query, ...ranked.map(({ text }) => text)]).catch(() => null) : null;
  const best = ranked.map((chunk, index) => {
    const semantic = vectors ? Math.max(0, cosine(vectors[0], vectors[index + 1])) : 0;
    return { ...chunk, semantic, rank: vectors ? 0.6 * chunk.lexical + 0.4 * semantic : chunk.lexical };
  }).sort((a, b) => b.rank - a.rank).filter(({ rank }) => rank >= 0.18).slice(0, 4);
  return { context: best.map(({ kind, text }) => ({ kind, text })), semanticScore: vectors && best.length ? Math.round(best[0].semantic * 100) : null };
}
