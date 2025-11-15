import express from "express";
import { signup, signin, googleSignin, verifyEmail } from "../controllers/authController.js";
import { signupValidation, signinValidation, validate } from "../middleware/validations.js";

const router = express.Router();

router.post("/signup", validate(signupValidation), signup);
router.get("/verify-email", verifyEmail);
router.post("/signin", validate(signinValidation), signin);
router.post("/google", googleSignin);

export default router;
