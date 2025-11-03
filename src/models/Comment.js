// src/models/Comment.js
import mongoose from "mongoose";

const { Schema, model } = mongoose;

const CommentSchema = new Schema(
  {
    post: {
      type: Schema.Types.ObjectId,
      ref: "Post",
      required: true,
      index: true,
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    content: { type: String, required: true },
    // nested comments
    parent: { type: Schema.Types.ObjectId, ref: "Comment", default: null },
    rootParent: {
      type: Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
      index: true,
    }, // top-level thread id
    likesCount: { type: Number, default: 0 },
    // optional moderation fields
    edited: { type: Boolean, default: false },
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// index for retrieving thread comments
CommentSchema.index({ post: 1, createdAt: 1 });

export default model("Comment", CommentSchema);
