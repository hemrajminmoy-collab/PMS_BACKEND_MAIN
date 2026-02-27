import express from "express";
import { addUser } from "../controllers/adduser.controller.js";

const router = express.Router();

router.post("/", addUser);

export default router;