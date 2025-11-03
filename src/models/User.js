import mongoose from "mongoose";

const { Schema, model } = mongoose;

const UserSchema = new Schema(
  {
    name: { type: String, trim: true, required: true },
    username: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String }, // store hashed password or null if OAuth user
    avatar: { type: String }, // url to avatar
    bio: { type: String, maxlength: 1000 },
    location: { type: String },
    website: { type: String },
    roles: { type: [String], default: ["user"] }, // admin, moderator, user
    followers: [{ type: Schema.Types.ObjectId, ref: "User" }], // optional; for heavy follow graphs, keep only counts and use Follow collection
    following: [{ type: Schema.Types.ObjectId, ref: "User" }],
    bookmarks: [{ type: Schema.Types.ObjectId, ref: "Post" }], // saved posts
    stats: {
      postsCount: { type: Number, default: 0 },
      followersCount: { type: Number, default: 0 },
      followingCount: { type: Number, default: 0 },
    },
    settings: {
      emailNotifications: { type: Boolean, default: true },
      theme: { type: String, enum: ["dark", "light"], default: "dark" },
    },
    provider: { type: String }, // 'local' | 'google' | 'github'
    providerId: { type: String }, // if using OAuth
  },
  { timestamps: true }
);

// quick search index on name and username
UserSchema.index({ name: "text", username: "text", bio: "text" });

// instance method to follow someone (keeps counters in sync)
UserSchema.methods.follow = async function (targetUserId) {
  if (this.following.includes(targetUserId)) return this;
  this.following.push(targetUserId);
  this.stats.followingCount = this.following.length;
  await this.save();
  // increment target followers count
  await model("User").findByIdAndUpdate(targetUserId, {
    $inc: { "stats.followersCount": 1 },
    $addToSet: { followers: this._id },
  });
  return this;
};

// instance method to unfollow
UserSchema.methods.unfollow = async function (targetUserId) {
  this.following = this.following.filter(
    (id) => id.toString() !== targetUserId.toString()
  );
  this.stats.followingCount = this.following.length;
  await this.save();
  await model("User").findByIdAndUpdate(targetUserId, {
    $inc: { "stats.followersCount": -1 },
    $pull: { followers: this._id },
  });
  return this;
};

export default model("User", UserSchema);
