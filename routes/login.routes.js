import express from "express";
import { loginUser, editPassword } from "../controllers/login.controller.js";

const router = express.Router();

// ✅ Login API
router.post("/login", loginUser);
router.post("/edit-password", editPassword);

export default router;
