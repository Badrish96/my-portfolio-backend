import express from "express";
import multer from "multer";
import {
	forgotPassword,
	currentUser,
	googleSignin,
	resetPassword,
	signin,
	signup,
	verifyResetOtp,
	updateProfile,
} from "../controllers/authController.js";
import { uploadProfileImage } from "../controllers/profileController.js";
import { authenticate } from "../middleware/authenticate.js";
import {
	forgotPasswordValidation,
	resetPasswordValidation,
	signinValidation,
	signupValidation,
	validate,
	verifyResetOtpValidation,
} from "../middleware/validations.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.get("/me", authenticate, currentUser);
router.patch("/profile", authenticate, updateProfile);
router.post("/profile/avatar", authenticate, upload.single("avatar"), uploadProfileImage);
router.post("/signup", validate(signupValidation), signup);
router.post("/signin", validate(signinValidation), signin);
router.post("/login", validate(signinValidation), signin);
router.post("/google", googleSignin);
router.post("/forgot-password", validate(forgotPasswordValidation), forgotPassword);
router.post("/verify-reset-otp", validate(verifyResetOtpValidation), verifyResetOtp);
router.post("/reset-password", validate(resetPasswordValidation), resetPassword);

export default router;
