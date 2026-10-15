import mongoose from "mongoose";

const { Schema, model } = mongoose;

const JobSchema = new Schema(
  {
    source: { type: String, default: "manual", trim: true },
    externalId: { type: String, trim: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    company: { type: String, required: true, trim: true, maxlength: 160 },
    location: { type: String, trim: true, maxlength: 160 },
    employmentType: { type: String, trim: true, maxlength: 80 },
    description: { type: String, required: true, maxlength: 30_000 },
    applicationMessage: { type: String, trim: true, maxlength: 2000 },
    requiredSkills: { type: [String], default: [] },
    salaryMin: { type: Number },
    salaryMax: { type: Number },
    salaryCurrency: { type: String, default: "INR" },
    applicationUrl: { type: String, required: true, trim: true },
    sourceUrl: { type: String, trim: true },
    status: { type: String, enum: ["open", "closed"], default: "open", index: true },
    postedAt: { type: Date },
    fetchedAt: { type: Date, default: Date.now },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", index: true },
  },
  { timestamps: true }
);

JobSchema.index({ source: 1, externalId: 1 }, { unique: true, sparse: true });
JobSchema.index({ title: "text", company: "text", description: "text", location: "text" });

export default model("Job", JobSchema);
