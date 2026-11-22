import mongoose from "mongoose";

const { Schema, model } = mongoose;

const JobSchema = new Schema(
  {
    source: { type: String, default: "manual", trim: true },
    externalId: { type: String, trim: true },
    companyKey: { type: String, index: true },
    identityKeys: { type: [String], default: undefined },
    sources: { type: [{ source: String, externalId: String, applicationUrl: String, sourceUrl: String, canonicalUrl: String, _id: false }], default: [] },
    possibleDuplicateIds: { type: [Schema.Types.ObjectId], default: [] },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    company: { type: String, required: true, trim: true, maxlength: 160 },
    location: { type: String, trim: true, maxlength: 160 },
    employmentType: { type: String, trim: true, maxlength: 80 },
    description: { type: String, default: "", maxlength: 30_000 },
    applicationMessage: { type: String, trim: true, maxlength: 2000 },
    preferredSkills: { type: [String], default: [] },
    requiredSkills: { type: [String], default: [] },
    salaryMin: { type: Number },
    salaryMax: { type: Number },
    salaryCurrency: { type: String, default: "INR" },
    applicationUrl: { type: String, required: true, trim: true, index: true },
    sourceUrl: { type: String, trim: true },
    canonicalUrl: { type: String, trim: true },
    requisitionId: { type: String, trim: true },
    status: { type: String, enum: ["open", "closed"], default: "open", index: true },
    postedAt: { type: Date },
    fetchedAt: { type: Date, default: Date.now },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", index: true },
  },
  { timestamps: true }
);

JobSchema.index({ source: 1, externalId: 1 }, { unique: true, sparse: true });
JobSchema.index({ identityKeys: 1 }, { unique: true, sparse: true });
JobSchema.index({ title: "text", company: "text", description: "text", location: "text" });

export default model("Job", JobSchema);
