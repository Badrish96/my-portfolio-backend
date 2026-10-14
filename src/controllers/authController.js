import { createHash, randomBytes, randomInt } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import User from "../models/User.js";
import {
  createAccessToken,
  hashPassword,
  publicUser,
  verifyPassword,
} from "../services/authService.js";
import { isSmtpConfigured, sendPasswordResetCode } from "../services/emailService.js";

const googleClient = new OAuth2Client();
const hashValue = (value) => createHash("sha256").update(value).digest("hex");
const genericResetMessage = "If an account exists for that email, a code has been sent.";

const createUsername = async (name, email) => {
  const base = (email.split("@")[0] || name)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 10) || "member";
  let username = base;
  let suffix = 1;

  while (await User.exists({ username })) {
    username = `${base.slice(0, 10 - String(suffix).length)}${suffix}`;
    suffix += 1;
  }

  return username;
};

const respondWithSession = (res, user, status = 200) => res.status(status).json({
  success: true,
  token: createAccessToken(user),
  user: publicUser(user),
});

export const currentUser = (req, res) => res.json({
  success: true,
  user: publicUser(req.user),
});

export const updateProfile = async (req, res) => {
  const allowedFields = ["name", "username", "bio", "location", "website", "userType"];
  const updates = {};

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) updates[field] = String(req.body[field]).trim();
  }

  if (updates.name !== undefined && (updates.name.length < 2 || updates.name.length > 50)) {
    return res.status(400).json({ success: false, message: "Name must be between 2 and 50 characters." });
  }
  if (updates.username !== undefined && !/^[a-zA-Z0-9_-]{3,15}$/.test(updates.username)) {
    return res.status(400).json({ success: false, message: "Username must be 3-15 letters, numbers, underscores, or hyphens." });
  }
  if (updates.userType !== undefined && !["developer", "recruiter", "student"].includes(updates.userType)) {
    return res.status(400).json({ success: false, message: "Invalid user type." });
  }
  if (updates.website && !/^https?:\/\//i.test(updates.website)) updates.website = `https://${updates.website}`;

  try {
    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true });
    return res.json({ success: true, user: publicUser(user) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: "That username is already in use." });
    console.error("Profile update failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update profile." });
  }
};

export const signup = async (req, res) => {
  const email = req.body.email.toLowerCase();
  const { name, username, userType, password } = req.body;

  try {
    if (await User.exists({ $or: [{ email }, { username }] })) {
      return res.status(409).json({ success: false, message: "An account with that email or username already exists." });
    }

    const user = await User.create({
      email,
      name,
      username,
      userType,
      passwordHash: await hashPassword(password),
      provider: "local",
      roles: ["user"],
    });
    return respondWithSession(res, user, 201);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Account already exists." });
    }
    console.error("Signup failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to create account." });
  }
};

export const signin = async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email.toLowerCase() }).select("+passwordHash");
    if (!user || !user.passwordHash || !(await verifyPassword(req.body.password, user.passwordHash))) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }
    return respondWithSession(res, user);
  } catch (error) {
    console.error("Signin failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to sign in." });
  }
};

export const googleSignin = async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const credential = req.body.credential || req.body.googleToken;
  if (!clientId) {
    return res.status(503).json({ success: false, message: "Google sign-in is not configured." });
  }

  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: clientId });
    const profile = ticket.getPayload();
    if (!profile?.email || profile.email_verified !== true) {
      return res.status(401).json({ success: false, message: "Google account email is not verified." });
    }

    const email = profile.email.toLowerCase();
    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({
        email,
        name: profile.name || email.split("@")[0],
        username: await createUsername(profile.name || email, email),
        userType: ["developer", "recruiter", "student"].includes(req.body.userType) ? req.body.userType : "developer",
        avatar: profile.picture,
        provider: "google",
        providerId: profile.sub,
        roles: ["user"],
      });
    } else if (!user.providerId) {
      user.provider = user.provider || "google";
      user.providerId = profile.sub;
      if (!user.avatar && profile.picture) user.avatar = profile.picture;
      await user.save();
    }
    return respondWithSession(res, user);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Unable to create Google account." });
    }
    return res.status(401).json({ success: false, message: "Google sign-in failed. Try again." });
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const email = req.body.email.toLowerCase();
    const user = await User.findOne({ email }).select(
      "+passwordResetSentAt +passwordResetOtpHash +passwordResetOtpExpires +passwordResetAttempts"
    );
    if (!user) return res.json({ success: true, message: genericResetMessage });

    const now = Date.now();
    if (user.passwordResetSentAt && now - user.passwordResetSentAt.getTime() < 60_000) {
      return res.json({ success: true, message: genericResetMessage });
    }
    const smtpConfigured = isSmtpConfigured();
    if (!smtpConfigured && process.env.NODE_ENV === "production") {
      return res.status(503).json({ success: false, message: "Password reset email is not configured." });
    }

    const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
    user.passwordResetOtpHash = hashValue(otp);
    user.passwordResetOtpExpires = new Date(now + 10 * 60_000);
    user.passwordResetAttempts = 0;
    user.passwordResetSentAt = new Date(now);
    user.passwordResetTokenHash = undefined;
    user.passwordResetTokenExpires = undefined;
    await user.save();

    if (smtpConfigured) {
      try {
        await sendPasswordResetCode(email, otp);
      } catch (error) {
        user.passwordResetOtpHash = undefined;
        user.passwordResetOtpExpires = undefined;
        user.passwordResetSentAt = undefined;
        await user.save();
        console.error("Password reset email failed:", error.message);
        return res.status(503).json({ success: false, message: "Unable to send password reset email." });
      }
    }

    return res.json({
      success: true,
      message: genericResetMessage,
      ...(process.env.NODE_ENV !== "production" && !smtpConfigured ? { debugOtp: otp } : {}),
    });
  } catch (error) {
    console.error("Forgot password failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to start password reset." });
  }
};

export const verifyResetOtp = async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email.toLowerCase() }).select(
      "+passwordResetOtpHash +passwordResetOtpExpires +passwordResetAttempts"
    );
    if (!user || !user.passwordResetOtpHash || user.passwordResetOtpExpires < new Date()) {
      return res.status(400).json({ success: false, message: "The code is invalid or expired." });
    }
    if (user.passwordResetAttempts >= 5) {
      return res.status(429).json({ success: false, message: "Too many attempts. Request a new code." });
    }

    user.passwordResetAttempts += 1;
    if (hashValue(req.body.otp) !== user.passwordResetOtpHash) {
      await user.save();
      return res.status(400).json({ success: false, message: "The code is invalid or expired." });
    }

    const resetToken = randomBytes(32).toString("hex");
    user.passwordResetOtpHash = undefined;
    user.passwordResetOtpExpires = undefined;
    user.passwordResetTokenHash = hashValue(resetToken);
    user.passwordResetTokenExpires = new Date(Date.now() + 10 * 60_000);
    await user.save();
    return res.json({ success: true, resetToken });
  } catch (error) {
    console.error("OTP verification failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to verify reset code." });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const user = await User.findOne({ passwordResetTokenHash: hashValue(req.body.resetToken) })
      .select("+passwordResetTokenHash +passwordResetTokenExpires");
    if (!user || !user.passwordResetTokenExpires || user.passwordResetTokenExpires < new Date()) {
      return res.status(400).json({ success: false, message: "The reset session is invalid or expired." });
    }

    user.passwordHash = await hashPassword(req.body.password);
    user.passwordResetOtpHash = undefined;
    user.passwordResetOtpExpires = undefined;
    user.passwordResetAttempts = 0;
    user.passwordResetSentAt = undefined;
    user.passwordResetTokenHash = undefined;
    user.passwordResetTokenExpires = undefined;
    await user.save();
    return res.json({ success: true, message: "Password reset successfully. You can now sign in." });
  } catch (error) {
    console.error("Password reset failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to reset password." });
  }
};
