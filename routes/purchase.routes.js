// BackEnd/routes/purchase.routes.js
import express from "express";
import multer from "multer";
import {
  createIndentForm,
  createLocalPurchaseForm,
  getAllIndentForms,
  getAllLocalPurchaseForms,
  getLatestUniqueId,
  getLatestLocalPurchaseUniqueId,
  updatePurchase,
  updateLocalPurchase,
  getIndentFormById,
  updateIndentForm,
  deleteIndentForm,
  uploadComparisonPDF,
  showAllIndentForms,
  getDelayFollowups,
  upsertDelayFollowup,
  add_to_localPurchase,
  getManualClosedStoreItems,
  getIndentFormByUniqueId,
  manualCloseStoreByUniqueId,
  getComparisonPdfByRowId,
  uploadInvoicePDF,
  getInvoicePdfByRowId,

  // Local Purchase bulk update
  bulkUpdateLocalPurchaseSelected,

  // PO PDF
  uploadPoPDF,
  getPoPdfByRowId,

  // Invoice master
  createStoreInvoiceAndLinkItems,
  getStoreInvoiceById,

  // Bulk PO
  createPoAndLinkItems,

  // ✅ INDENT VERIFICATION PDF (bulk + show)
  uploadIndentVerificationPdfBulk,
  getIndentVerificationPdfByRowId,

  // ✅ ADD THESE TWO (THIS IS THE FIX)
  uploadGetQuotationPDF,
  getGetQuotationPdfByRowId,
} from "../controllers/purchase.controller.js";
import { getRecentAuditLogs } from "../controllers/auditLog.controller.js";
import { requireAuditLogAccess, requireAuthToken } from "../middleware/auth.middleware.js";

const router = express.Router();
const isObjectId = (value) => /^[0-9a-fA-F]{24}$/.test(String(value || ""));

/* =========================================================
   ✅ Multer Config — PDF ONLY
   ========================================================= */
const uploadPdfOnly = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      cb(new Error("Only PDF files allowed"), false);
    } else {
      cb(null, true);
    }
  },
});

/* ------------------ Routes ------------------ */
router.post("/", createIndentForm);

// Purchase
router.post("/all", getAllIndentForms);
router.get("/all", showAllIndentForms);
router.post("/delay-followup", getDelayFollowups);
router.put("/delay-followup", upsertDelayFollowup);

// Local Purchase
router.post("/localpurchase", createLocalPurchaseForm);
router.post("/localpurchase/all", getAllLocalPurchaseForms);
router.get("/latest/localpurchase/unique-id", getLatestLocalPurchaseUniqueId);
router.put("/localpurchase/update/:id", updateLocalPurchase);
router.put("/localpurchase/bulk-update", bulkUpdateLocalPurchaseSelected);
router.post("/add-to-localPurchase", add_to_localPurchase);

// Latest Unique ID + Update purchase
router.get("/latest/unique-id", getLatestUniqueId);
router.put("/purchase/update/:id", updatePurchase);

/* ---------- IMPORTANT: keep above `/:id` ---------- */

// Fetch by Unique ID
router.get("/unique/:uniqueId", getIndentFormByUniqueId);

// Manual Close Store
router.post("/store/manual-close", manualCloseStoreByUniqueId);
router.get("/store/manual-closed", getManualClosedStoreItems);

// Comparison PDF
// ✅ COMPARISON PDF (GET)
router.get("/comparison/pdf/:rowId", getComparisonPdfByRowId);

// ✅ COMPARISON PDF (POST) - Support both endpoints
router.post(
  "/upload/comparison-pdf",
  uploadPdfOnly.single("file"),
  uploadComparisonPDF
);
router.post(
  "/comparison/pdf/:rowId",
  uploadPdfOnly.single("file"),
  uploadComparisonPDF
);

// Invoice PDF (single)
router.post("/invoice/pdf/:rowId", uploadPdfOnly.single("file"), uploadInvoicePDF);
router.get("/invoice/pdf/:rowId", getInvoicePdfByRowId);

// Store Invoice Master (bulk)
router.post(
  "/store/invoice/bulk",
  uploadPdfOnly.single("file"),
  createStoreInvoiceAndLinkItems
);
router.get("/store/invoice/:invoiceId", getStoreInvoiceById);

// Bulk PO
router.post("/po/bulk", uploadPdfOnly.single("file"), createPoAndLinkItems);

// PO PDF (single)
router.post("/po/pdf/:rowId", uploadPdfOnly.single("file"), uploadPoPDF);
router.get("/po/pdf/:rowId", getPoPdfByRowId);

/* =========================================================
   ✅ INDENT VERIFICATION PDF (BULK)
   ========================================================= */

// Upload ONE PDF → MANY uniqueIds
router.post(
  "/indent-verification/pdf/bulk",
  uploadPdfOnly.single("file"),
  uploadIndentVerificationPdfBulk
);

// Show PDF for a row
router.get(
  "/indent-verification/pdf/:rowId",
  getIndentVerificationPdfByRowId
);

// Audit logs (7-day window, Minmoy/Mrinmoy only)
router.get("/audit-logs", requireAuthToken, requireAuditLogAccess, getRecentAuditLogs);

/* ---------- By Mongo ID ---------- */
router.get("/:id", (req, res, next) =>
  (isObjectId(req.params.id) ? getIndentFormById(req, res, next) : next()));
router.put("/:id", (req, res, next) =>
  (isObjectId(req.params.id) ? updateIndentForm(req, res, next) : next()));
router.delete("/:id", (req, res, next) =>
  (isObjectId(req.params.id) ? deleteIndentForm(req, res, next) : next()));

// Get Quotation PDF (single)
router.post("/getquotation/pdf/:rowId", uploadPdfOnly.single("file"), uploadGetQuotationPDF);
router.get("/getquotation/pdf/:rowId", getGetQuotationPdfByRowId);

/* ------------------ Multer Error Handler ------------------ */
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err) {
    return res.status(400).json({
      success: false,
      message: err.message || "Upload error",
    });
  }
  next();
});

export default router;
