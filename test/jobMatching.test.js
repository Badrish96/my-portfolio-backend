import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { scoreJob, scoreJobFallback, evaluationKey } from "../src/services/aiMatching.js";
import { comparePostings, collapsePostings } from "../src/services/jobDeduplication.js";
import { retrieveProfile } from "../src/services/jobRetrieval.js";

const profile = { verifiedSkills: ["React.js", "Next.js", "TypeScript", "JavaScript", "Node.js", "Express.js", "MongoDB", "REST APIs", "Redux"],
  preferredRoles: ["Frontend Developer", "Full Stack Developer"], preferredLocations: ["Gurugram", "Remote India", "Delhi NCR"], verifiedExperienceYears: 5, targetSalaryMin: 1600000 };
const description = "Build production React and TypeScript interfaces and reusable components. Own the design system and measure frontend performance. Integrate REST APIs and improve accessibility for customer-facing web applications. Requires 4–7 years of software development experience. GraphQL is a plus.";
const frontend = { title: "Senior Frontend Engineer", location: "Gurgaon, India", description };
const cases = [
  ["React/TypeScript", frontend, 90, 100],
  ["Next.js", { ...frontend, title: "Next.js Frontend Developer", description: description.replace("React", "Next.js") }, 90, 100],
  ["MERN", { ...frontend, title: "MERN Full Stack Engineer", description: description + " Build backend services with Express.js and MongoDB." }, 75, 100],
  ["Java backend", { ...frontend, title: "Java Backend Engineer", description: "Build microservices with Spring Boot and design database schemas. Collaborate with frontend developers using React." }, 0, 39],
  ["DevOps", { ...frontend, title: "DevOps Engineer" }, 0, 39],
  ["QA", { ...frontend, title: "QA Engineer" }, 0, 39],
  ["Design", { ...frontend, title: "UI/UX Designer" }, 0, 39],
  ["Fresher", { ...frontend, title: "Frontend Developer – Fresher" }, 0, 39],
  ["Overly senior", { ...frontend, description: description.replace("4–7 years", "12+ years") }, 0, 49],
  ["Incomplete description", { ...frontend, title: "React Developer", description: undefined }, 40, 74],
  ["Different title, relevant work", { ...frontend, title: "Product Engineer" }, 75, 100],
  ["Backend-heavy frontend title", { ...frontend, description: "Build microservices, implement Spring Boot and own database tuning. Collaborate with a React team. Requires 5+ years." }, 0, 39],
  ["Incidental React", { ...frontend, title: "Software Engineer", description: "The marketing team uses React. You will support server deployments." }, 0, 59],
];
for (const [label, job, min, max] of cases) test(label, () => {
  const { matchScore } = scoreJobFallback(profile, job);
  assert.ok(matchScore >= min && matchScore <= max, `score ${matchScore} outside ${min}–${max}`);
});

test("missing salary stays unknown and optional skills stay out of mandatory gaps", () => {
  const result = scoreJobFallback(profile, { ...frontend, description: description + " Required: Angular." });
  assert.equal(result.salaryCompatibility, "unknown");
  assert.ok(result.preferredSkills.includes("graphql"));
  assert.deepEqual(result.missingSkills, ["angular"]);
});

test("explicit compensation and location change relevant scoring dimensions", () => {
  const better = scoreJobFallback(profile, { ...frontend, location: "India, Remote", salaryMin: 1800000 });
  const worse = scoreJobFallback(profile, { ...frontend, location: "Bengaluru", salaryMax: 1100000 });
  assert.equal(better.salaryCompatibility, "compatible");
  assert.equal(worse.salaryCompatibility, "incompatible");
  assert.ok(better.dimensions.location > worse.dimensions.location);
});

const linked = { ...frontend, company: "Example Pvt Ltd", source: "linkedin", externalId: "100", applicationUrl: "https://www.linkedin.com/jobs/view/frontend-100" };
const naukri = { ...linked, title: "Senior Frontend Developer", location: "Gurugram", company: "Example", source: "naukri", externalId: "200", applicationUrl: "https://www.naukri.com/job-listings-frontend-200" };
test("exact URL, tracking changes, and board ID variants", () => {
  assert.equal(comparePostings(linked, linked), "exact");
  assert.equal(comparePostings(linked, { ...linked, externalId: "changed", applicationUrl: "https://in.linkedin.com/jobs/view/100/?trk=abc" }), "exact");
  assert.equal(comparePostings(naukri, { ...naukri, externalId: "changed", applicationUrl: naukri.applicationUrl + "?utm_source=test" }), "exact");
});

test("cross-board text and title variants merge and retain sources across rescans", () => {
  assert.equal(comparePostings(linked, naukri), "probable");
  const [merged, ...rest] = collapsePostings([linked, naukri, naukri, linked]);
  assert.equal(rest.length, 0);
  assert.deepEqual(merged.sources.map(({ source }) => source), ["linkedin", "naukri"]);
});

test("different locations and distinct same-board IDs are kept", () => {
  assert.equal(comparePostings(linked, { ...naukri, location: "Bengaluru" }), null);
  const sameBoard = { ...linked, applicationUrl: "https://www.linkedin.com/jobs/view/200", externalId: "200" };
  assert.equal(comparePostings(linked, sameBoard), "possible");
  assert.equal(collapsePostings([linked, naukri, sameBoard]).length, 2);
});

test("different description, repost date or seniority prevents a probable merge", () => {
  assert.equal(comparePostings(linked, { ...naukri, description: "Build a different product and support a testing team." }), "possible");
  assert.equal(comparePostings({ ...linked, postedAt: "2026-10-01" }, { ...naukri, postedAt: "2026-11-01" }), "possible");
  assert.equal(comparePostings(linked, { ...naukri, title: "Junior Frontend Developer" }), null);
});

test("retrieval selects evidence and job/profile edits invalidate evaluations", async () => {
  const withContext = { ...profile, experienceDetails: "Built React TypeScript interfaces and reusable components.\n\nOrganized quarterly employee events." };
  const { context } = await retrieveProfile(withContext, frontend);
  assert.ok(context.some(({ text }) => text.includes("reusable components")));
  assert.ok(context.every(({ text }) => !text.includes("quarterly")));
  assert.notEqual(evaluationKey(profile, frontend), evaluationKey(withContext, frontend));
  assert.notEqual(evaluationKey(profile, frontend), evaluationKey(profile, { ...frontend, description: "Changed" }));
});

test("structured provider output is bounded and invalid output falls back", async () => {
  let payload = JSON.stringify({ score: 100, confidence: 1 });
  const prior = { AI_PROVIDER: process.env.AI_PROVIDER, GROQ_API_KEY: process.env.GROQ_API_KEY };
  const originalFetch = globalThis.fetch;
  process.env.AI_PROVIDER = "groq";
  process.env.GROQ_API_KEY = "test-key";
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: payload } }] }));
  const borderline = { ...frontend, description: "Build React and TypeScript interfaces. Experience integrating REST APIs is helpful for customer workflows." };
  try {
    const rules = scoreJobFallback(profile, borderline);
    const evaluated = await scoreJob(profile, borderline);
    assert.equal(evaluated.aiStatus, "evaluated");
    assert.ok(evaluated.matchScore - rules.matchScore <= 8);
    payload = JSON.stringify({ score: 999, confidence: 1 });
    const fallback = await scoreJob(profile, borderline);
    assert.equal(fallback.aiStatus, "failed");
    assert.equal(fallback.matchScore, rules.matchScore);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("optional embeddings rerank evidence, reuse vectors, and fall back on failure", async () => {
  const originalFetch = globalThis.fetch;
  const previous = process.env.JOB_EMBEDDING_MODEL;
  let requests = 0;
  process.env.JOB_EMBEDDING_MODEL = "fixture-model";
  globalThis.fetch = async (_url, options) => {
    requests += 1;
    const { input } = JSON.parse(options.body);
    return new Response(JSON.stringify({ embeddings: input.map(() => [0.8, 0.2]) }));
  };
  const withContext = { ...profile, projectDetails: "Built reusable React components and measured frontend performance." };
  try {
    assert.equal((await retrieveProfile(withContext, frontend)).semanticScore, 100);
    assert.equal((await retrieveProfile(withContext, frontend)).semanticScore, 100);
    assert.equal(requests, 1);
    globalThis.fetch = async () => { throw new Error("offline"); };
    const fallback = await retrieveProfile(withContext, { ...frontend, title: "UI Engineer" });
    assert.equal(fallback.semanticScore, null);
    assert.equal(fallback.context.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.JOB_EMBEDDING_MODEL;
    else process.env.JOB_EMBEDDING_MODEL = previous;
  }
});

test("different employer requisition IDs keep otherwise identical cross-board listings separate", () => {
  const first = { ...linked, description: linked.description + " Requisition ID: FE-101." };
  const second = { ...naukri, description: naukri.description + " Requisition ID: FE-102." };
  assert.equal(comparePostings(first, second), "possible");
  assert.equal(collapsePostings([first, second]).length, 2);
});
