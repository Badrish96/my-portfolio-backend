import mongoose from "mongoose";

const { Schema, model } = mongoose;

/**
 * Separate Vote collection so each user's vote is a document:
 * - targetModel: "Post" | "Comment"
 * - value: 1 (upvote) | -1 (downvote)
 */

const VoteSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    targetId: { type: Schema.Types.ObjectId, required: true, index: true },
    targetModel: { type: String, enum: ["Post", "Comment"], required: true, index: true },
    value: { type: Number, enum: [1, -1], required: true },
  },
  { timestamps: true }
);

// ensure one vote per user per target
VoteSchema.index({ user: 1, targetId: 1, targetModel: 1 }, { unique: true });

// static helper to upsert a vote (value 1 or -1) and return impact
VoteSchema.statics.upsertVote = async function ({ userId, targetId, targetModel, value }) {
  const existing = await this.findOne({ user: userId, targetId, targetModel });
  if (existing) {
    if (existing.value === value) {
      // same vote: remove (toggle)
      await existing.remove();
      return { delta: -value }; // opposite effect on aggregated score
    } else {
      // flip vote
      const delta = value - existing.value; // from -1->1 delta=2 or 1->-1 delta=-2
      existing.value = value;
      await existing.save();
      return { delta };
    }
  } else {
    await this.create({ user: userId, targetId, targetModel, value });
    return { delta: value };
  }
};

export default model("Vote", VoteSchema);
