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
    firstName: { type: String, trim: true },
    middleName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    mobilePhone: { type: String, trim: true },
    countryCode: { type: String, trim: true },
    gender: { type: String, trim: true },
    nationality: { type: String, trim: true },
    dateOfBirth: { type: String, trim: true },
    currentSalary: { type: Number, min: 0 },
    currentSalaryCurrency: { type: String, trim: true },
    expectedSalary: { type: Number, min: 0 },
    expectedSalaryCurrency: { type: String, trim: true },
    compensationHikeExpectations: { type: String, trim: true, maxlength: 200 },
    availableToJoin: { type: Number, min: 0 },
    currentLocation: { type: String, trim: true },
    experienceDetails: { type: String, maxlength: 3000 },
    relevantExperienceYears: { type: Number, min: 0, max: 80 },
    resumeSummary: { type: String, maxlength: 3000 },
    educationDetails: { type: String, maxlength: 3000 },
    projectDetails: { type: String, maxlength: 6000 },
    certifications: { type: String, maxlength: 3000 },
    achievements: { type: String, maxlength: 3000 },
    languages: { type: String, maxlength: 1000 },
    workAuthorization: { type: String, maxlength: 500 },
    noticePeriod: { type: String, maxlength: 200 },
    linkedinUrl: { type: String, trim: true },
    githubUrl: { type: String, trim: true },
    portfolioUrl: { type: String, trim: true },
    userType: {
      type: String,
      enum: ["developer", "recruiter", "student"],
      default: "developer",
    },
    passwordHash: { type: String, select: false },
    avatar: { type: String }, // url to avatar
    bio: { type: String, maxlength: 1000 },
    location: { type: String },
    website: { type: String },
    skills: { type: [String], default: [] },
    preferredRoles: { type: [String], default: [] },
    preferredLocations: { type: [String], default: [] },
    experienceYears: { type: Number, min: 0, max: 80 },
    expectedCompensation: { type: Number, min: 0 },
    roles: { type: [String], default: ["user"] }, // admin, moderator, user
    followers: [{ type: Schema.Types.ObjectId, ref: "User" }], // optional; for heavy follow graphs, keep only counts and use Follow collection
    following: [{ type: Schema.Types.ObjectId, ref: "User" }],
    stats: {
      followersCount: { type: Number, default: 0 },
      followingCount: { type: Number, default: 0 },
    },
    settings: {
      emailNotifications: { type: Boolean, default: true },
      theme: { type: String, enum: ["dark", "light"], default: "dark" },
    },
    provider: { type: String },
    providerId: { type: String },
    passwordResetOtpHash: { type: String, select: false },
    passwordResetOtpExpires: { type: Date, select: false },
    passwordResetAttempts: { type: Number, default: 0, select: false },
    passwordResetSentAt: { type: Date, select: false },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetTokenExpires: { type: Date, select: false },
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
