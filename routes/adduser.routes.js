import express from "express";
import { addUser } from "../controllers/adduser.controller.js";
import { requireAuthToken } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/", requireAuthToken, addUser);

export default router;
