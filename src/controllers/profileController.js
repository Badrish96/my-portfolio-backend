import { v2 as cloudinary } from "cloudinary";
import User from "../models/User.js";
import { publicUser } from "../services/authService.js";

const uploadBuffer = (buffer) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream(
    { folder: "portfolio/profile-images", resource_type: "image", transformation: [{ width: 600, height: 600, crop: "fill", gravity: "face" }] },
    (error, result) => (error ? reject(error) : resolve(result)),
  );
  stream.end(buffer);
});

export const uploadProfileImage = async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "Choose an image to upload." });

  try {
    const result = await uploadBuffer(req.file.buffer);
    const user = await User.findByIdAndUpdate(req.user._id, { avatar: result.secure_url }, { new: true });
    return res.json({ success: true, user: publicUser(user) });
  } catch (error) {
    console.error("Profile image upload failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to upload profile image." });
  }
};
