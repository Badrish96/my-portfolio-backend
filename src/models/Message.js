import mongoose from "mongoose";

const { Schema, model } = mongoose;

const MessageSub = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: true },
    attachments: [{ type: String }], // urls
    readBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

const ConversationSchema = new Schema(
  {
    participants: [{ type: Schema.Types.ObjectId, ref: "User", required: true }],
    // small cache fields:
    lastMessage: { type: String },
    lastMessageAt: { type: Date },
    unreadCountByUser: { type: Map, of: Number }, // key: userId, value: unread count
    // messages as subdocuments (paginated retrieval from end)
    messages: [MessageSub],
  },
  { timestamps: true }
);

// index participants for quick look-up: conversations for a user
ConversationSchema.index({ participants: 1 });

export default model("Conversation", ConversationSchema);
