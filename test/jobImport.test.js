import assert from "node:assert/strict";
import { test } from "node:test";
import Job from "../src/models/Job.js";
import { importPostings } from "../src/services/jobImport.js";

test("repeated and concurrent board imports retain a canonical record and all source IDs", async (t) => {
  const rows = [];
  let nextId = 1;
  t.mock.method(Job, "find", () => ({ sort: () => ({ lean: async () => structuredClone(rows) }) }));
  t.mock.method(Job, "findOneAndUpdate", (filter, update, options) => ({
    lean: async () => {
      let record = rows.find((row) => Object.entries(filter).every(([field, value]) => row[field] === value));
      if (!record && options.upsert) {
        record = { _id: String(nextId++), ...update.$setOnInsert };
        rows.push(record);
      }
      if (!record) return null;
      Object.assign(record, update.$set);
      for (const [field, value] of Object.entries(update.$addToSet)) {
        const values = [...(record[field] || []), ...(value.$each || [value])];
        record[field] = [...new Map(values.map((item) => [JSON.stringify(item), item])).values()];
      }
      return structuredClone(record);
    },
  }));

  const common = { title: "Senior React Developer", company: "Example", location: "Gurugram",
    description: "Build production React interfaces, maintain reusable components, and integrate REST APIs across multiple customer-facing web applications. Pair with designers and mentor engineers on accessibility, responsive design, release quality, and performance optimization." };
  const linked = { ...common, source: "linkedin", externalId: "100", applicationUrl: "https://www.linkedin.com/jobs/view/100/" };
  const naukri = { ...common, source: "naukri", externalId: "200", applicationUrl: "https://www.naukri.com/job-listings-react-developer-200" };
  const [[first], [second]] = await Promise.all([importPostings([linked], "user"), importPostings([naukri], "user")]);
  const [again] = await importPostings([naukri], "user");
  assert.equal(first.job._id, second.job._id);
  assert.equal(second.duplicate, "probable");
  assert.equal(again.duplicate, "exact");
  assert.equal(rows.length, 1);
  assert.deepEqual(again.job.sources.map((record) => record.source), ["linkedin", "naukri"]);
});
