import mongoose from "mongoose";

const { Schema, model } = mongoose;

const statuses = ["discovered", "shortlisted", "skipped", "preparing", "ready_for_review", "approved", "submitting", "submitted", "submission_unknown", "interview", "rejected", "withdrawn", "closed"];

const ApplicationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    job: { type: Schema.Types.ObjectId, ref: "Job", required: true, index: true },
    status: { type: String, enum: statuses, default: "ready_for_review", index: true },
    notes: { type: String, maxlength: 5000 },
    tailoredResume: { type: String },
    coverLetter: { type: String, maxlength: 20_000 },
    answers: { type: Schema.Types.Mixed },
    errorHistory: [{ message: String, createdAt: { type: Date, default: Date.now } }],
    approvedAt: { type: Date },
  },
  { timestamps: true }
);

ApplicationSchema.index({ user: 1, job: 1 }, { unique: true });

export default model("Application", ApplicationSchema);
