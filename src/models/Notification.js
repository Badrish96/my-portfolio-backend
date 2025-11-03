// src/models/Notification.js
import mongoose from "mongoose";

const { Schema, model } = mongoose;

const NotificationSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    }, // recipient
    actor: { type: Schema.Types.ObjectId, ref: "User" }, // who triggered it
    type: {
      type: String,
      enum: ["like", "comment", "follow", "mention", "message"],
      required: true,
    },
    entityId: { type: Schema.Types.ObjectId }, // post/comment/message id
    entityType: { type: String }, // "Post","Comment","Message"
    data: { type: Schema.Types.Mixed }, // extra payload
    read: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

// index to get unread notifications faster
NotificationSchema.index({ user: 1, read: 1, createdAt: -1 });

export default model("Notification", NotificationSchema);
