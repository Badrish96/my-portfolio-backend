import mongoose from "mongoose";

const { Schema, model } = mongoose;

const JobMatchSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    job: { type: Schema.Types.ObjectId, ref: "Job", required: true, index: true },
    matchScore: { type: Number, min: 0, max: 100, required: true },
    recommendation: { type: String, enum: ["apply", "review", "skip"], required: true },
    matchingSkills: { type: [String], default: [] },
    missingSkills: { type: [String], default: [] },
    reasons: { type: [String], default: [] },
    concerns: { type: [String], default: [] },
    salaryCompatibility: { type: String, enum: ["compatible", "incompatible", "unknown"], default: "unknown" },
    provider: { type: String, required: true },
    scoringVersion: { type: String, required: true },
    evaluatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

JobMatchSchema.index({ user: 1, job: 1 }, { unique: true });
JobMatchSchema.index({ user: 1, matchScore: -1, updatedAt: -1 });

export default model("JobMatch", JobMatchSchema);
