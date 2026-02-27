import express from "express";
import { bulkCreateTransport, getAllTransportRecords, bulkUpdateTransport } from "../controllers/transport.controller.js";

const router = express.Router();

router.get("/", getAllTransportRecords);
router.post("/bulk-create", bulkCreateTransport);
router.put("/bulk-update", bulkUpdateTransport);

export default router;