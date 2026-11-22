import Job from "../models/Job.js";
import { companyKey, comparePostings, identityKeys, sourceRecord } from "./jobDeduplication.js";

const pendingCompanies = new Map();
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function savePosting(job, userId) {
  const keys = identityKeys(job);
  const company = companyKey(job.company);
  const clauses = [{ identityKeys: { $in: keys } }, { source: job.source, externalId: job.externalId }, { applicationUrl: job.applicationUrl }];
  if (company) {
    clauses.push({ companyKey: company });
    clauses.push({ companyKey: { $exists: false }, company: new RegExp(`^${escapeRegex(company.split(" ")[0])}\\b`, "i") });
  }
  const candidates = await Job.find({ $or: clauses }).sort({ _id: 1 }).lean();
  const classified = candidates.map((candidate) => ({ candidate, confidence: comparePostings(candidate, job) }));
  const duplicate = classified.find(({ confidence }) => confidence === "exact") || classified.find(({ confidence }) => confidence === "probable");
  const possibleDuplicateIds = classified.filter(({ confidence }) => confidence === "possible").map(({ candidate }) => candidate._id);
  const next = { ...job, companyKey: company, sourceUrl: job.sourceUrl || job.applicationUrl, fetchedAt: new Date() };
  const existing = duplicate?.candidate;
  const sameBoard = existing?.source === job.source && existing?.externalId === job.externalId;
  if (sameBoard && String(existing.description || "").length > String(next.description || "").length * 1.5) {
    next.description = existing.description;
  }
  // A detail-page import can enrich a canonical record originally created from a short result card.
  const enrich = existing && !sameBoard && String(next.description || "").length > Math.max(150, String(existing.description || "").length * 1.5);
  const changes = sameBoard ? next : enrich ? {
    description: next.description,
    requiredSkills: [...new Set([...(existing.requiredSkills || []), ...(next.requiredSkills || [])])],
    preferredSkills: [...new Set([...(existing.preferredSkills || []), ...(next.preferredSkills || [])])],
  } : null;
  const add = { identityKeys: { $each: keys }, sources: sourceRecord(job), possibleDuplicateIds: { $each: possibleDuplicateIds } };
  const update = existing
    ? { $addToSet: add, ...(changes ? { $set: changes } : {}) }
    : { $setOnInsert: { ...next, createdBy: userId }, $addToSet: add };
  const filter = existing ? { _id: existing._id } : { source: job.source, externalId: job.externalId };
  const saved = await Job.findOneAndUpdate(filter, update, { upsert: !existing, new: true, setDefaultsOnInsert: true }).lean();
  if (!saved) return savePosting(job, userId);
  return { job: saved, duplicate: duplicate?.confidence, possible: possibleDuplicateIds.length };
}

export async function importPostings(jobs, userId) {
  const results = [];
  for (const job of jobs) {
    const company = companyKey(job.company);
    const previous = pendingCompanies.get(company) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      try {
        return await savePosting(job, userId);
      } catch (error) {
        // Another request may have inserted an exact identity after our lookup.
        if (error.code === 11000) return savePosting(job, userId);
        throw error;
      }
    });
    pendingCompanies.set(company, next);
    try {
      results.push(await next);
    } finally {
      if (pendingCompanies.get(company) === next) pendingCompanies.delete(company);
    }
  }
  return results;
}
