import express from "express";
import {
	forgotPassword,
	currentUser,
	googleSignin,
	resetPassword,
	signin,
	signup,
	verifyResetOtp,
} from "../controllers/authController.js";
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

router.get("/me", authenticate, currentUser);
router.post("/signup", validate(signupValidation), signup);
router.post("/signin", validate(signinValidation), signin);
router.post("/login", validate(signinValidation), signin);
router.post("/google", googleSignin);
router.post("/forgot-password", validate(forgotPasswordValidation), forgotPassword);
router.post("/verify-reset-otp", validate(verifyResetOtpValidation), verifyResetOtp);
router.post("/reset-password", validate(resetPasswordValidation), resetPassword);

export default router;
