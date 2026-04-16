import { uploadToGoogleDrive } from "../config/googleDrive.js";
import Purchase from "../models/purchase.model.js";
import LocalPurchase from "../models/localpurchase.model.js";
import DelayFollowup from "../models/delayFollowup.model.js";
import VendorMaster from "../models/vendorMaster.model.js";
import mongoose from "mongoose";
import crypto from "crypto";
import StoreInvoice from "../models/storeInvoice.model.js";
import { buildFieldChanges, writeAuditLogSafe } from "../utils/auditLog.js";

/* ------------------ Base64 PDF Helpers ------------------ */
const parseBase64Pdf = (value) => {
  if (!value || typeof value !== "string") return null;

  // Supports: data:application/pdf;base64,XXXX or raw base64
  const dataUrlMatch = value.match(/^data:([^;]+);base64,(.*)$/);
  if (dataUrlMatch) {
    const mimeType = dataUrlMatch[1];
    const b64 = dataUrlMatch[2];
    return { buffer: Buffer.from(b64, "base64"), mimeType };
  }

  // Raw base64
  return { buffer: Buffer.from(value, "base64"), mimeType: "application/pdf" };
};

const getPdfFileFromReq = (req) => {
  if (req.file) return req.file;

  const base64 =
    req.body?.pdfBase64 ||
    req.body?.fileBase64 ||
    req.body?.base64 ||
    "";

  if (!base64) return null;

  const parsed = parseBase64Pdf(base64);
  if (!parsed?.buffer) return null;

  const mimeType = req.body?.pdfMimeType || parsed.mimeType || "application/pdf";

  return {
    buffer: parsed.buffer,
    mimetype: mimeType,
  };
};

const AUDIT_META_KEYS = new Set(["username", "role", "systemName"]);

const stripAuditMetaFields = (payload = {}) =>
  Object.fromEntries(
    Object.entries(payload || {}).filter(([key]) => !AUDIT_META_KEYS.has(key))
  );

const summarizeIds = (ids = [], limit = 10) => {
  const arr = Array.isArray(ids) ? ids.map((id) => String(id)) : [];
  if (arr.length <= limit) return arr;
  return [...arr.slice(0, limit), `+${arr.length - limit} more`];
};

const normalizeComparableText = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeComparableKey = (value) =>
  normalizeComparableText(value)
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const getCanonicalVendorNameFromMaster = async (value) => {
  const normalizedValue = normalizeComparableText(value);
  if (!normalizedValue) return "";

  const compareKey = normalizeComparableKey(normalizedValue);
  const vendorRows = await VendorMaster.find(
    { isActive: true },
    { name: 1 },
  ).lean();

  const matchedVendor = (vendorRows || []).find((vendor) => {
    return normalizeComparableKey(vendor?.name) === compareKey;
  });

  return normalizeComparableText(matchedVendor?.name || "");
};

const normalizeVendorNameOrThrow = async (value) => {
  const normalized = normalizeComparableText(value);
  if (!normalized) return "";

  // Try to find in master, but don't throw if missing
  const canonical = await getCanonicalVendorNameFromMaster(normalized);
  return canonical || normalized; // fallback to user input
};

/* ------------------ Indian Holidays (YYYY-MM-DD) ------------------ */
const INDIAN_HOLIDAYS = ["2025-01-26", "2025-08-15", "2025-10-02", "2025-12-25"];

/* ------------------ Helper Functions ------------------ */

// Check Sunday or holiday
const isHoliday = (date) => {
  const yyyyMmDd = date.toISOString().split("T")[0];
  return date.getDay() === 0 || INDIAN_HOLIDAYS.includes(yyyyMmDd);
};

// Add working days
const addWorkingDays = (startDate, days) => {
  let date = new Date(startDate);
  let count = 0;

  while (count < days) {
    date.setDate(date.getDate() + 1);
    if (!isHoliday(date)) count++;
  }
  return date;
};

// Calculate delay in days only
const calculateDelayDays = (planned, actual) => {
  const msDiff = actual - planned;
  if (msDiff <= 0) return "0 days";
  const days = Math.floor(msDiff / (1000 * 60 * 60 * 24));
  return `${days} days`;
};

const parseDateSafe = (value) => {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
};

// Delay starts only after planned date is over.
// If actual date is missing, current time is used for running delay.
const computeRunningDelay = (plannedValue, actualValue, now = new Date()) => {
  const planned = parseDateSafe(plannedValue);
  if (!planned) return "";

  const actual = parseDateSafe(actualValue);
  const end = actual || now;
  return calculateDelayDays(planned, end);
};

/* ------------------ Planned Date Logic (PC Follow Up) ------------------ */

const parseYyyyMmDd = (s) => {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return { y, mo, d };
};

const addDaysToDateOnly = (yyyyMmDd, daysToAdd) => {
  const parts = parseYyyyMmDd(yyyyMmDd);
  if (!parts) return "";
  const dt = new Date(Date.UTC(parts.y, parts.mo - 1, parts.d, 0, 0, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + Number(daysToAdd || 0));
  return dt.toISOString().slice(0, 10);
};

// Create a UTC Date that corresponds to IST local time.
const makeUtcDateFromIst = ({ y, mo, d, hour, minute }) => {
  const IST_OFFSET_MIN = 330;
  const baseUtcMs = Date.UTC(y, mo - 1, d, 0, 0, 0, 0) - IST_OFFSET_MIN * 60 * 1000;
  const timeMs = (Number(hour) * 60 + Number(minute)) * 60 * 1000;
  return new Date(baseUtcMs + timeMs);
};

const deterministicRandInt = (seed, min, max) => {
  const h = crypto.createHash("md5").update(String(seed)).digest("hex");
  const n = parseInt(h.slice(0, 8), 16);
  const span = max - min + 1;
  return min + (n % span);
};

const computePlannedPcFollowUp1 = (leadDays, poDate) => {
  const k = Number(leadDays);
  if (!poDate || !Number.isFinite(k) || k <= 0) return "";
  if (k <= 7) return addDaysToDateOnly(poDate, 1);
  if (k <= 15) return addDaysToDateOnly(poDate, 6);
  if (k <= 21) return addDaysToDateOnly(poDate, 12);
  if (k <= 30) return addDaysToDateOnly(poDate, 15);
  if (k <= 45) return addDaysToDateOnly(poDate, 15);
  if (k <= 60) return addDaysToDateOnly(poDate, 20);
  if (k <= 90) return addDaysToDateOnly(poDate, 25);
  return "";
};

const computePlannedPcFollowUp2 = (leadDays, poDate, seed) => {
  const k = Number(leadDays);
  if (!poDate || !Number.isFinite(k) || k <= 0) return "";
  if (k <= 7) return "";
  if (k > 90) return "";

  const parts = parseYyyyMmDd(poDate);
  if (!parts) return "";

  const daysToAdd = k - 1;
  const baseDateOnly = addDaysToDateOnly(poDate, daysToAdd);
  const baseParts = parseYyyyMmDd(baseDateOnly);
  if (!baseParts) return "";

  const hour = deterministicRandInt(`${seed}-h`, 10, 18);
  const minute = deterministicRandInt(`${seed}-m`, 0, 59);
  const dt = makeUtcDateFromIst({ ...baseParts, hour, minute });
  return dt.toISOString();
};

const computePlannedPcFollowUp3 = (leadDays, poDate) => {
  const k = Number(leadDays);
  if (!poDate || !Number.isFinite(k) || k <= 0) return "";
  if (k < 31) return "";
  if (k >= 31 && k <= 45) return addDaysToDateOnly(poDate, 42);
  if (k >= 46 && k <= 60) return addDaysToDateOnly(poDate, 56);
  if (k >= 61 && k <= 90) return addDaysToDateOnly(poDate, 80);
  return "";
};

const applyPcPlannedDates = (updateData, existingDoc) => {
  const poDate = Object.prototype.hasOwnProperty.call(updateData, "poDate")
    ? updateData.poDate
    : existingDoc?.poDate;

  const leadDays = Object.prototype.hasOwnProperty.call(updateData, "leadDays")
    ? updateData.leadDays
    : existingDoc?.leadDays;

  const uniqueId = Object.prototype.hasOwnProperty.call(updateData, "uniqueId")
    ? updateData.uniqueId
    : existingDoc?.uniqueId;

  if (!poDate) return;

  const k = Number(leadDays);
  if (!Number.isFinite(k) || k <= 0) return;

  const seed = `${uniqueId || ""}-${poDate}-${k}`;

  updateData.plannedPCFollowUp1 = computePlannedPcFollowUp1(k, poDate);
  updateData.plannedPCFollowUp2 = computePlannedPcFollowUp2(k, poDate, seed);
  updateData.plannedPCFollowUp3 = computePlannedPcFollowUp3(k, poDate);
};

/* ------------------ Payment Planned-Date Helpers ------------------ */

const computePlannedPaymentPWP = (poDate) => {
  if (!poDate) return "";
  return addDaysToDateOnly(poDate, 2);
};

const computePlannedPaymentBBD = (poDate, leadDays) => {
  if (!poDate) return "";
  const k = Number(leadDays);
  if (!Number.isFinite(k) || k <= 0) return "";
  return addDaysToDateOnly(poDate, k - 7);
};

const computePlannedPaymentFAR = (storeReceivedDate) => {
  if (!storeReceivedDate) return "";
  return addDaysToDateOnly(storeReceivedDate, 12);
};

const computePlannedPaymentPAPW = (poDate, papwDays) => {
  if (!poDate) return "";
  const d = Number(papwDays);
  if (!Number.isFinite(d) || d <= 0) return "";
  return addDaysToDateOnly(poDate, d);
};

const paymentConditionHas = (paymentCondition, token) => {
  const c = String(paymentCondition || "").toUpperCase();
  return c.includes(token.toUpperCase());
};

const applyPaymentPlannedDates = (updateData, existingDoc) => {
  const poDate = Object.prototype.hasOwnProperty.call(updateData, "poDate")
    ? updateData.poDate
    : existingDoc?.poDate;

  const leadDays = Object.prototype.hasOwnProperty.call(updateData, "leadDays")
    ? updateData.leadDays
    : existingDoc?.leadDays;

  const storeReceivedDate = Object.prototype.hasOwnProperty.call(updateData, "storeReceivedDate")
    ? updateData.storeReceivedDate
    : existingDoc?.storeReceivedDate;

  const paymentCondition = Object.prototype.hasOwnProperty.call(updateData, "paymentCondition")
    ? updateData.paymentCondition
    : existingDoc?.paymentCondition;

  const papwDays = Object.prototype.hasOwnProperty.call(updateData, "papwDays")
    ? updateData.papwDays
    : existingDoc?.papwDays;

  if (poDate) updateData.plannedPaymentPWP = computePlannedPaymentPWP(poDate);

  if (poDate && Number.isFinite(Number(leadDays)) && Number(leadDays) > 0) {
    updateData.plannedPaymentBBD = computePlannedPaymentBBD(poDate, leadDays);
  }

  if (storeReceivedDate) updateData.plannedPaymentFAR = computePlannedPaymentFAR(storeReceivedDate);

  if (poDate && paymentConditionHas(paymentCondition, "PAPW")) {
    updateData.plannedPaymentPAPW = computePlannedPaymentPAPW(poDate, papwDays);
  } else {
    updateData.plannedPaymentPAPW = "";
  }
};

/* ------------------ Material Received Planned-Date Helpers ------------------ */

const computePlannedMaterialReceived = (poDate, leadDays) => {
  if (!poDate) return "";
  const k = Number(leadDays);
  if (!Number.isFinite(k) || k <= 0) return "";

  let base;
  if (poDate instanceof Date) {
    base = new Date(poDate.getTime());
  } else if (typeof poDate === "string") {
    const parts = parseYyyyMmDd(poDate);
    base = parts ? new Date(Date.UTC(parts.y, parts.mo - 1, parts.d, 0, 0, 0, 0)) : new Date(poDate);
  } else {
    base = new Date(poDate);
  }
  if (Number.isNaN(base.getTime())) return "";

  base.setUTCDate(base.getUTCDate() + k);

  const IST_OFFSET_MIN = 330;
  const toIst = (d) => new Date(d.getTime() + IST_OFFSET_MIN * 60 * 1000);
  const toUtcFromIst = (dIst) => new Date(dIst.getTime() - IST_OFFSET_MIN * 60 * 1000);

  const isHolidayIst = (dIst) => {
    const ymd = dIst.toISOString().slice(0, 10);
    const dow = dIst.getUTCDay();
    return dow === 0 || INDIAN_HOLIDAYS.includes(ymd);
  };

  let ist = toIst(base);

  const OFFICE_START_HOUR_IST = 10;
  if (ist.getUTCHours() >= 19) {
    ist.setUTCDate(ist.getUTCDate() + 1);
    ist.setUTCHours(OFFICE_START_HOUR_IST, 0, 0, 0);
  }

  while (isHolidayIst(ist)) {
    ist.setUTCDate(ist.getUTCDate() + 1);
    ist.setUTCHours(OFFICE_START_HOUR_IST, 0, 0, 0);
  }

  const finalUtc = toUtcFromIst(ist);
  return finalUtc.toISOString().slice(0, 10);
};

const computeActualMaterialReceived = (materialReceivedDate, storeReceivedDate) => {
  const s = String(storeReceivedDate || "");
  if (s) return s;
  const m = String(materialReceivedDate || "");
  if (m) return m;
  return "";
};

const applyMaterialReceivedDates = (updateData, existingDoc) => {
  const poDate = Object.prototype.hasOwnProperty.call(updateData, "poDate")
    ? updateData.poDate
    : existingDoc?.poDate;

  const leadDays = Object.prototype.hasOwnProperty.call(updateData, "leadDays")
    ? updateData.leadDays
    : existingDoc?.leadDays;

  const materialReceivedDate = Object.prototype.hasOwnProperty.call(updateData, "materialReceivedDate")
    ? updateData.materialReceivedDate
    : existingDoc?.materialReceivedDate;

  const storeReceivedDate = Object.prototype.hasOwnProperty.call(updateData, "storeReceivedDate")
    ? updateData.storeReceivedDate
    : existingDoc?.storeReceivedDate;

  const planned = computePlannedMaterialReceived(poDate, leadDays);
  if (planned) updateData.plannedMaterialReceived = planned;

  const actual = computeActualMaterialReceived(materialReceivedDate, storeReceivedDate);
  if (actual) updateData.actualMaterialReceived = actual;

  if (planned && actual) {
    const plannedDt = new Date(planned);
    const actualDt = new Date(actual);
    if (!Number.isNaN(plannedDt.getTime()) && !Number.isNaN(actualDt.getTime())) {
      updateData.timeDelayMaterialReceived = calculateDelayDays(plannedDt, actualDt);
    }
  }
};

/* =========================================================
   ✅ UPDATE PURCHASE
   ========================================================= */

export const updatePurchase = async (req, res) => {
  try {
    const updateData = stripAuditMetaFields({ ...req.body });
    if (Object.prototype.hasOwnProperty.call(updateData, "vendorName")) {
      updateData.vendorName = await normalizeVendorNameOrThrow(updateData.vendorName);
    }

    const purchase = await Purchase.findById(req.params.id);
    if (!purchase) {
      return res.status(404).json({ success: false, message: "Record not found" });
    }

    /* -------- Planned dates (flow) -------- */
    if (purchase.date) {
      const baseDate = new Date(purchase.date);
      const plannedDate = addWorkingDays(baseDate, 3);
      updateData.plannedGetQuotation = plannedDate.toISOString().split("T")[0];
    }

    if (updateData.actualGetQuotation && purchase.plannedGetQuotation) {
      const planned = new Date(purchase.plannedGetQuotation);
      const actual = new Date(updateData.actualGetQuotation);
      updateData.timeDelayGetQuotation = calculateDelayDays(planned, actual);
    }

    if (updateData.actualGetQuotation) {
      const baseDate = new Date(updateData.actualGetQuotation);
      const plannedTechDate = addWorkingDays(baseDate, 3);
      updateData.plannedTechApproval = plannedTechDate.toISOString().split("T")[0];
    }

    if (updateData.actualTechApproval && purchase.plannedTechApproval) {
      const planned = new Date(purchase.plannedTechApproval);
      const actual = new Date(updateData.actualTechApproval);
      updateData.timeDelayTechApproval = calculateDelayDays(planned, actual);
    }

    if (updateData.actualTechApproval) {
      const baseDate = new Date(updateData.actualTechApproval);
      const plannedDate = addWorkingDays(baseDate, 3);
      updateData.plannedCommercialNegotiation = plannedDate.toISOString().split("T")[0];
    }

    if (updateData.actualCommercialNegotiation && purchase.plannedCommercialNegotiation) {
      const planned = new Date(purchase.plannedCommercialNegotiation);
      const actual = new Date(updateData.actualCommercialNegotiation);
      updateData.timeDelayCommercialNegotiation = calculateDelayDays(planned, actual);
    }

    if (updateData.actualCommercialNegotiation) {
      const baseDate = new Date(updateData.actualCommercialNegotiation);
      const plannedDate = addWorkingDays(baseDate, 3);
      updateData.plannedPoGeneration = plannedDate.toISOString().split("T")[0];
    }

    if (updateData.actualPoGeneration && purchase.plannedPoGeneration) {
      const planned = new Date(purchase.plannedPoGeneration);
      const actual = new Date(updateData.actualPoGeneration);
      updateData.timeDelayPoGeneration = calculateDelayDays(planned, actual);
    }

    // ✅ recompute all planned dates
    applyPaymentPlannedDates(updateData, purchase);
    applyMaterialReceivedDates(updateData, purchase);
    applyPcPlannedDates(updateData, purchase);

    // Payment delays
    if (updateData.actualPaymentPWP && purchase.plannedPaymentPWP) {
      const planned = new Date(purchase.plannedPaymentPWP);
      const actual = new Date(updateData.actualPaymentPWP);
      updateData.timeDelayPaymentPWP = calculateDelayDays(planned, actual);
    }

    if (updateData.actualPaymentBBD && (updateData.plannedPaymentBBD || purchase.plannedPaymentBBD)) {
      const planned = new Date(updateData.plannedPaymentBBD || purchase.plannedPaymentBBD);
      const actual = new Date(updateData.actualPaymentBBD);
      updateData.timeDelayPaymentBBD = calculateDelayDays(planned, actual);
    }

    if (updateData.actualPaymentFAR && (updateData.plannedPaymentFAR || purchase.plannedPaymentFAR)) {
      const planned = new Date(updateData.plannedPaymentFAR || purchase.plannedPaymentFAR);
      const actual = new Date(updateData.actualPaymentFAR);
      updateData.timeDelayPaymentFAR = calculateDelayDays(planned, actual);
    }

    if (updateData.actualPaymentPAPW && (updateData.plannedPaymentPAPW || purchase.plannedPaymentPAPW)) {
      const planned = new Date(updateData.plannedPaymentPAPW || purchase.plannedPaymentPAPW);
      const actual = new Date(updateData.actualPaymentPAPW);
      updateData.timeDelayPaymentPAPW = calculateDelayDays(planned, actual);
    }

    const updated = await Purchase.findByIdAndUpdate(req.params.id, updateData, { new: true });

    await writeAuditLogSafe({
      req,
      action: "PURCHASE_UPDATE",
      targetModel: "Purchase",
      targetId: updated?._id || req.params.id,
      uniqueId: updated?.uniqueId || purchase.uniqueId || "",
      changedFields: buildFieldChanges(purchase, updateData, Object.keys(updateData)),
      summary: `Purchase updated: ${updated?.uniqueId || req.params.id}`,
    });

    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("❌ Update error:", error);
    const statusCode = error?.statusCode || 500;
    return res.status(statusCode).json({ success: false, error: error.message });
  }
};

export const updateLocalPurchase = async (req, res) => {
  try {
    const localPurchase = await LocalPurchase.findById(req.params.id);
    if (!localPurchase) {
      return res.status(404).json({ success: false, message: "Record not found" });
    }

    const updateData = stripAuditMetaFields({ ...req.body });
    if (Object.prototype.hasOwnProperty.call(updateData, "vendorName")) {
      updateData.vendorName = await normalizeVendorNameOrThrow(updateData.vendorName);
    }
    const updated = await LocalPurchase.findByIdAndUpdate(req.params.id, updateData, { new: true });

    await writeAuditLogSafe({
      req,
      action: "LOCAL_PURCHASE_UPDATE",
      targetModel: "LocalPurchase",
      targetId: updated?._id || req.params.id,
      uniqueId: updated?.uniqueId || localPurchase.uniqueId || "",
      changedFields: buildFieldChanges(localPurchase, updateData, Object.keys(updateData)),
      summary: `Local Purchase updated: ${updated?.uniqueId || req.params.id}`,
    });

    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("❌ Update LocalPurchase error:", error);
    const statusCode = error?.statusCode || 500;
    return res.status(statusCode).json({ success: false, error: error.message });
  }
};

/* =========================================================
   ✅ CREATE FORMS
   ========================================================= */

{/*export const createIndentForm = async (req, res) => {
  try {
    const form = await Purchase.create(req.body);
    return res.status(201).json({
      success: true,
      message: "Indent Form Created Successfully",
      data: form,
    });
  } catch (error) {
    console.error("❌ Error Creating Indent Form:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const createLocalPurchaseForm = async (req, res) => {
  try {
    const form = await LocalPurchase.create(req.body);
    return res.status(201).json({
      success: true,
      message: "Local Purchase Form Created Successfully",
      data: form,
    });
  } catch (error) {
    console.error("❌ Error Creating Local Purchase Form:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};*/}
export const createIndentForm = async (req, res) => {
  try {
    const {
      site,
      section,
      uniqueId,
      indentNumber,
      itemNumber,
      itemDescription,
      uom,
      totalQuantity,
      submittedBy,

      // ✅ NEW fields
      applicationArea = "",
      oldMaterialStatus = "",
      orderApprovedBy = "",
    } = req.body || {};

    const normalizedIndentNumber = normalizeComparableText(indentNumber);
    const normalizedItemDescription = normalizeComparableText(itemDescription);

    if (!normalizedIndentNumber || !normalizedItemDescription) {
      return res.status(400).json({
        success: false,
        message: "Indent Number and Item Description are required.",
      });
    }

    const duplicateIndent = await Purchase.findOne({
      $expr: {
        $and: [
          {
            $eq: [
              {
                $toLower: {
                  $trim: { input: { $ifNull: ["$indentNumber", ""] } },
                },
              },
              normalizeComparableLower(normalizedIndentNumber),
            ],
          },
          {
            $eq: [
              {
                $toLower: {
                  $trim: { input: { $ifNull: ["$itemDescription", ""] } },
                },
              },
              normalizeComparableLower(normalizedItemDescription),
            ],
          },
        ],
      },
    }).select("_id uniqueId indentNumber itemDescription");

    if (duplicateIndent) {
      await writeAuditLogSafe({
        req,
        action: "PURCHASE_CREATE_SKIPPED_DUPLICATE",
        targetModel: "Purchase",
        targetId: duplicateIndent._id,
        uniqueId: duplicateIndent.uniqueId || "",
        changedFields: [],
        summary: `Duplicate indent skipped for indentNumber=${normalizedIndentNumber}`,
        actor: { username: submittedBy || "" },
        metadata: {
          duplicateBy: ["indentNumber", "itemDescription"],
          indentNumber: normalizedIndentNumber,
          itemDescription: normalizedItemDescription,
          existingRowId: String(duplicateIndent._id),
          existingUniqueId: duplicateIndent.uniqueId || "",
        },
      });

      return res.status(200).json({
        success: true,
        skipped: true,
        message:
          "Duplicate skipped: same Indent Number and Item Description already exists.",
        data: {
          existingRowId: duplicateIndent._id,
          existingUniqueId: duplicateIndent.uniqueId || "",
          indentNumber: duplicateIndent.indentNumber || normalizedIndentNumber,
          itemDescription:
            duplicateIndent.itemDescription || normalizedItemDescription,
        },
      });
    }

    const form = await Purchase.create({
      site,
      section,
      uniqueId,
      indentNumber: normalizedIndentNumber,
      itemNumber,
      itemDescription: normalizedItemDescription,
      uom,
      totalQuantity,
      submittedBy,

      applicationArea,
      oldMaterialStatus,
      orderApprovedBy,
    });

    await writeAuditLogSafe({
      req,
      action: "PURCHASE_CREATE",
      targetModel: "Purchase",
      targetId: form._id,
      uniqueId: form.uniqueId || "",
      changedFields: buildFieldChanges(
        {},
        {
          site,
          section,
          uniqueId,
          indentNumber: normalizedIndentNumber,
          itemNumber,
          itemDescription: normalizedItemDescription,
          uom,
          totalQuantity,
          submittedBy,
          applicationArea,
          oldMaterialStatus,
          orderApprovedBy,
        },
        [
          "site",
          "section",
          "uniqueId",
          "indentNumber",
          "itemNumber",
          "itemDescription",
          "uom",
          "totalQuantity",
          "submittedBy",
          "applicationArea",
          "oldMaterialStatus",
          "orderApprovedBy",
        ]
      ),
      summary: `Indent created: ${form.uniqueId || form._id}`,
      actor: { username: submittedBy || "" },
    });

    return res.status(201).json({
      success: true,
      message: "Indent Form Created Successfully",
      data: form,
    });
  } catch (error) {
    console.error("❌ Error Creating Indent Form:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

//create localpurchase form
export const createLocalPurchaseForm = async (req, res) => {
  try {
    const payload = stripAuditMetaFields(req.body || {});
    const form = await LocalPurchase.create(payload);

    await writeAuditLogSafe({
      req,
      action: "LOCAL_PURCHASE_CREATE",
      targetModel: "LocalPurchase",
      targetId: form._id,
      uniqueId: form.uniqueId || "",
      changedFields: buildFieldChanges({}, payload, Object.keys(payload)),
      summary: `Local purchase created: ${form.uniqueId || form._id}`,
      actor: { username: payload.submittedBy || "" },
    });

    return res.status(201).json({
      success: true,
      message: "Local Purchase Form Created Successfully",
      data: form,
    });
  } catch (error) {
    console.error("❌ Error Creating Local Purchase Form:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};


/* =========================================================
   ✅ UNIQUE ID HELPERS
   ========================================================= */

export const getLatestUniqueId = async (req, res) => {
  try {
    const lastRecord = await Purchase.findOne().sort({ createdAt: -1 });

    if (!lastRecord) {
      return res.json({ success: true, uniqueId: "INT2_12000" });
    }

    const prevId = lastRecord.uniqueId;
    const [prefix, numPart] = String(prevId).split("_");
    const newNumber = Number(numPart) + 1;
    const newUniqueId = `${prefix}_${newNumber}`;

    return res.json({ success: true, uniqueId: newUniqueId });
  } catch (error) {
    console.error("❌ Error Fetching Latest Unique ID:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getLatestLocalPurchaseUniqueId = async (req, res) => {
  try {
    const lastRecord = await LocalPurchase.findOne().sort({ createdAt: -1 });

    if (!lastRecord) {
      return res.json({ success: true, uniqueId: "INTLP2_12000" });
    }

    const prevId = lastRecord.uniqueId;
    const [prefix, numPart] = String(prevId).split("_");
    const newNumber = Number(numPart) + 1;
    const newUniqueId = `${prefix}_${newNumber}`;

    return res.json({ success: true, uniqueId: newUniqueId });
  } catch (error) {
    console.error("❌ Error Fetching Latest LocalPurchase Unique ID:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/* =========================================================
   ✅ ADD TO LOCAL PURCHASE (bulk)
   ========================================================= */

export const add_to_localPurchase = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { indentIds, doerName } = req.body;

    if (!Array.isArray(indentIds) || indentIds.length === 0) {
      return res.status(400).json({ success: false, message: "indentIds array is required" });
    }

    const normalizeLocalDoer = (v) => {
      if (!v) return "";
      const s = String(v).trim();
      if (s === "Local Purchase 1") return "Local 1";
      if (s === "Local Purchase 2") return "Local 2";
      if (s === "Local Purchase 3") return "Local 3";
      return s;
    };

    const normalizedDoerName = normalizeLocalDoer(doerName);
    const allowed = new Set(["Local 1", "Local 2", "Local 3"]);

    if (!allowed.has(normalizedDoerName)) {
      return res.status(200).json({ success: true, message: "Skipped: Not Local Purchase" });
    }

    session.startTransaction();

    const indents = await Purchase.find({ _id: { $in: indentIds } }, null, { session });
    if (indents.length === 0) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "No valid indents found" });
    }

    const indentUniqueIds = indents.map((i) => i.uniqueId).filter(Boolean);
    const existing = await LocalPurchase.find(
      { uniqueId: { $in: indentUniqueIds } },
      { uniqueId: 1 },
      { session }
    );
    const existingUniqueIds = new Set(existing.map((e) => String(e.uniqueId)));

    const bulkInsertData = [];

    for (const indent of indents) {
      if (existingUniqueIds.has(String(indent.uniqueId))) continue;

      bulkInsertData.push({
        site: indent.site,
        section: indent.section,
        // Keep SAME uniqueId as indent so both sections show identical number
        uniqueId: indent.uniqueId,
        indentNumber: indent.indentNumber,
        itemNumber: indent.itemNumber,
        itemDescription: indent.itemDescription,
        uom: indent.uom,
        totalQuantity: indent.totalQuantity,
        submittedBy: indent.submittedBy,
        doerName: normalizedDoerName,
        // ✅ NEW fields
        applicationArea: indent.applicationArea || "",
        oldMaterialStatus: indent.oldMaterialStatus || "",
        orderApprovedBy: indent.orderApprovedBy || "",
      });

    }

    if (bulkInsertData.length === 0) {
      await session.abortTransaction();
      return res.status(200).json({ success: true, message: "All records already exist" });
    }

    await LocalPurchase.insertMany(bulkInsertData, { ordered: false, session });
    // await Purchase.deleteMany({ _id: { $in: purchaseIdsToDelete } }, { session });

    await session.commitTransaction();

    await writeAuditLogSafe({
      req,
      action: "LOCAL_PURCHASE_BULK_CREATE",
      targetModel: "LocalPurchase",
      changedFields: [
        { field: "doerName", before: null, after: normalizedDoerName },
        { field: "insertedCount", before: 0, after: bulkInsertData.length },
      ],
      summary: `Bulk Local Purchase created: ${bulkInsertData.length} row(s)`,
      metadata: {
        requestedCount: indentIds.length,
        insertedUniqueIds: summarizeIds(bulkInsertData.map((row) => row.uniqueId)),
      },
    });

    return res.status(201).json({
      success: true,
      message: "Bulk Local Purchase completed",
      summary: {
        requested: indentIds.length,
        inserted: bulkInsertData.length,
        skipped: indentIds.length - bulkInsertData.length,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("❌ BULK LocalPurchase Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    session.endSession();
  }
};

/* =========================================================
   ✅ GET ALL / SHOW ALL
   ========================================================= */

export const getAllIndentForms = async (req, res) => {
  try {
    const { role, username } = req.body;
    const normalizedRole = String(role || "").trim().toUpperCase();
    const normalizedUsername = String(username || "").trim();
    const normalizedLowerUsername = normalizedUsername.toLowerCase();
    const isDebasishPoUploadOnlyUser =
      normalizedRole === "PA" &&
      (normalizedLowerUsername === "debasish samanta po" ||
        normalizedLowerUsername === "debasis samanta po");
    let filter = {};

    if (normalizedRole === "PSE") {
      filter = { submittedBy: normalizedUsername };
    } else if (normalizedRole === "PA" && !isDebasishPoUploadOnlyUser) {
      filter = { doerName: normalizedUsername };
    }

    const forms = await Purchase.find(filter).sort({ createdAt: 1 });

    const enriched = forms.map((doc) => {
      const obj = doc.toObject();
      const k = Number(obj.leadDays);

      if (obj.poDate && Number.isFinite(k) && k > 0) {
        if (!obj.plannedPCFollowUp1) obj.plannedPCFollowUp1 = computePlannedPcFollowUp1(k, obj.poDate);
        if (!obj.plannedPCFollowUp2)
          obj.plannedPCFollowUp2 = computePlannedPcFollowUp2(k, obj.poDate, `${obj.uniqueId || ""}-${obj.poDate}-${k}`);
        if (!obj.plannedPCFollowUp3) obj.plannedPCFollowUp3 = computePlannedPcFollowUp3(k, obj.poDate);
      }

      if (obj.poDate) {
        if (!obj.plannedPaymentPWP) obj.plannedPaymentPWP = computePlannedPaymentPWP(obj.poDate);
        const lk = Number(obj.leadDays);
        if (Number.isFinite(lk) && lk > 0) {
          if (!obj.plannedPaymentBBD) obj.plannedPaymentBBD = computePlannedPaymentBBD(obj.poDate, lk);
        }
        if (paymentConditionHas(obj.paymentCondition, "PAPW")) {
          if (!obj.plannedPaymentPAPW) obj.plannedPaymentPAPW = computePlannedPaymentPAPW(obj.poDate, obj.papwDays);
        }
      }

      if (obj.storeReceivedDate) {
        if (!obj.plannedPaymentFAR) obj.plannedPaymentFAR = computePlannedPaymentFAR(obj.storeReceivedDate);
      }

      if (obj.poDate) {
        const lk = Number(obj.leadDays);
        if (Number.isFinite(lk) && lk > 0) {
          if (!obj.plannedMaterialReceived) obj.plannedMaterialReceived = computePlannedMaterialReceived(obj.poDate, lk);
        }
      }

      if (!obj.actualMaterialReceived) {
        const actualMr = computeActualMaterialReceived(obj.materialReceivedDate, obj.storeReceivedDate);
        if (actualMr) obj.actualMaterialReceived = actualMr;
      }

      // Recompute delay values dynamically:
      // delay remains 0 days until planned date is crossed.
      obj.timeDelayGetQuotation = computeRunningDelay(
        obj.plannedGetQuotation,
        obj.actualGetQuotation,
      );
      obj.timeDelayTechApproval = computeRunningDelay(
        obj.plannedTechApproval,
        obj.actualTechApproval,
      );
      obj.timeDelayCommercialNegotiation = computeRunningDelay(
        obj.plannedCommercialNegotiation,
        obj.actualCommercialNegotiation,
      );
      obj.timeDelayPoGeneration = computeRunningDelay(
        obj.plannedPoGeneration,
        obj.actualPoGeneration,
      );
      obj.timeDelayPCFollowUp1 = computeRunningDelay(
        obj.plannedPCFollowUp1,
        obj.actualPCFollowUp1,
      );
      obj.timeDelayPCFollowUp2 = computeRunningDelay(
        obj.plannedPCFollowUp2,
        obj.actualPCFollowUp2,
      );
      obj.timeDelayPCFollowUp3 = computeRunningDelay(
        obj.plannedPCFollowUp3,
        obj.actualPCFollowUp3,
      );
      obj.timeDelayPaymentPWP = computeRunningDelay(
        obj.plannedPaymentPWP,
        obj.actualPaymentPWP,
      );
      obj.timeDelayPaymentBBD = computeRunningDelay(
        obj.plannedPaymentBBD,
        obj.actualPaymentBBD,
      );
      obj.timeDelayPaymentFAR = computeRunningDelay(
        obj.plannedPaymentFAR,
        obj.actualPaymentFAR,
      );
      obj.timeDelayPaymentPAPW = computeRunningDelay(
        obj.plannedPaymentPAPW,
        obj.actualPaymentPAPW,
      );
      obj.timeDelayMaterialReceived = computeRunningDelay(
        obj.plannedMaterialReceived,
        obj.actualMaterialReceived,
      );

      return obj;
    });

    return res.json({ success: true, data: enriched });
  } catch (error) {
    console.error("❌ Error Fetching Forms:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const getAllLocalPurchaseForms = async (req, res) => {
  try {
    const { role, username } = req.body;
    let filter = {};

    if (role === "PSE") filter = { submittedBy: username };
    else if (role === "PA") filter = { doerName: username };

    const forms = await LocalPurchase.find(filter).sort({ createdAt: 1 });
    return res.json({ success: true, data: forms });
  } catch (error) {
    console.error("❌ Error Fetching LocalPurchase Forms:", error);
    return res.status(error?.statusCode || 500).json({ success: false, error: error.message });
  }
};

export const getVendorMasterList = async (req, res) => {
  try {
    const query = String(req.query.query || req.query.q || "").trim();
    const filter = { isActive: true };

    if (query) {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      filter.name = regex;
    } else {
      return res.json({ success: true, data: [] });
    }

    const vendors = await VendorMaster.find(filter, { name: { $regex: new RegExp(`^${normalizedInput}$`, 'i') }, code: 1 })
      .sort({ name: 1 })
      .limit(50)
      .lean();

    return res.json({
      success: true,
      data: (vendors || []).map((vendor) => ({
        _id: vendor._id,
        name: normalizeComparableText(vendor.name),
        code: normalizeComparableText(vendor.code),
      })),
    });
  } catch (error) {
    console.error("Vendor master fetch failed:", error);
    return res.status(error?.statusCode || 500).json({ success: false, error: error.message });
  }
};

export const showAllIndentForms = async (req, res) => {
  try {
    const forms = await Purchase.find().sort({ createdAt: 1 });
    return res.json({ success: true, data: forms });
  } catch (error) {
    console.error("❌ Error Fetching All Forms:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/* =========================================================
   ✅ GET / UPDATE / DELETE by Mongo ID
   ========================================================= */

export const getDelayFollowups = async (req, res) => {
  try {
    const { role, username } = req.body || {};
    const normalizedRole = String(role || "").trim().toUpperCase();
    const normalizedUsername = String(username || "").trim();

    let filter = {};
    if (normalizedRole === "PSE") {
      filter = { pseName: normalizedUsername };
    }

    const rows = await DelayFollowup.find(filter).sort({ updatedAt: -1, createdAt: -1 });
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("âŒ Error Fetching Delay Followups:", error);
    return res.status(error?.statusCode || 500).json({ success: false, error: error.message });
  }
};

export const upsertDelayFollowup = async (req, res) => {
  try {
    const payload = stripAuditMetaFields(req.body || {});

    const uniqueId = String(payload.uniqueId || "").trim();
    const stageId = String(payload.stageId || "").trim();
    const stageLabel = String(payload.stageLabel || "").trim();
    const pseName = String(payload.pseName || "").trim();
    const remarks = String(payload.remarks || "").trim();
    const estimatedCompletionDate = String(payload.estimatedCompletionDate || "").trim();
    const isCompleted = Boolean(payload.isCompleted);
    const changedBy = String(
      req.body?.username || req.headers?.["x-username"] || pseName || "",
    ).trim();

    if (!uniqueId || !stageId || !stageLabel || !pseName || !estimatedCompletionDate) {
      return res.status(400).json({
        success: false,
        message: "uniqueId, stageId, stageLabel, pseName and estimatedCompletionDate are required.",
      });
    }

    const existing = await DelayFollowup.findOne({ uniqueId, stageId, pseName });

    if (!existing) {
      const created = await DelayFollowup.create({
        uniqueId,
        stageId,
        stageLabel,
        pseName,
        remarks,
        estimatedCompletionDate,
        isCompleted,
        completedAt: isCompleted ? new Date() : null,
      });

      return res.status(201).json({
        success: true,
        message: "Delay followup created.",
        data: created,
      });
    }

    const estimateChanged = existing.estimatedCompletionDate !== estimatedCompletionDate;
    if (estimateChanged) {
      existing.estimateHistory.push({
        estimatedCompletionDate: existing.estimatedCompletionDate || "",
        remarks: existing.remarks || "",
        changedAt: new Date(),
        changedBy,
      });
    }

    existing.stageLabel = stageLabel;
    existing.remarks = remarks;
    existing.estimatedCompletionDate = estimatedCompletionDate;
    existing.isCompleted = isCompleted;
    existing.completedAt = isCompleted ? existing.completedAt || new Date() : null;

    await existing.save();

    return res.json({
      success: true,
      message: estimateChanged
        ? "Delay followup updated with new estimated date."
        : "Delay followup updated.",
      data: existing,
    });
  } catch (error) {
    console.error("âŒ Error Upserting Delay Followup:", error);
    return res.status(error?.statusCode || 500).json({ success: false, error: error.message });
  }
};

export const getIndentFormById = async (req, res) => {
  try {
    const form = await Purchase.findById(req.params.id);
    if (!form) return res.status(404).json({ success: false, message: "Not Found" });
    return res.json({ success: true, data: form });
  } catch (error) {
    console.error("❌ Error Fetching Form:", error);
    return res.status(error?.statusCode || 500).json({ success: false, error: error.message });
  }
};

export const updateIndentForm = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id format" });
    }

    const existing = await Purchase.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: "Not Found" });

    const payload = stripAuditMetaFields(req.body || {});
    const form = await Purchase.findByIdAndUpdate(req.params.id, payload, { new: true });

    await writeAuditLogSafe({
      req,
      action: "PURCHASE_UPDATE_GENERIC",
      targetModel: "Purchase",
      targetId: form?._id || req.params.id,
      uniqueId: form?.uniqueId || existing.uniqueId || "",
      changedFields: buildFieldChanges(existing, payload, Object.keys(payload)),
      summary: `Purchase updated (generic): ${form?.uniqueId || req.params.id}`,
    });

    return res.json({ success: true, message: "Form Updated Successfully", data: form });
  } catch (error) {
    console.error("❌ Error Updating Form:", error);
    return res.status(error?.statusCode || 500).json({ success: false, error: error.message });
  }
};

export const deleteIndentForm = async (req, res) => {
  try {
    const actorRole = String(
      req.body?.role || req.headers?.["x-user-role"] || "",
    )
      .trim()
      .toUpperCase();
    const actorUsername = String(
      req.body?.username || req.headers?.["x-username"] || "",
    )
      .trim()
      .toLowerCase();
    const isAllowedDeleteUser =
      actorRole === "ADMIN" &&
      (actorUsername === "minmoy" || actorUsername === "mrinmoy");

    if (!isAllowedDeleteUser) {
      return res.status(403).json({
        success: false,
        message: "Delete is allowed only for Admin user Minmoy.",
      });
    }

    const existing = await Purchase.findById(req.params.id);
    await Purchase.findByIdAndDelete(req.params.id);

    await writeAuditLogSafe({
      req,
      action: "PURCHASE_DELETE",
      targetModel: "Purchase",
      targetId: req.params.id,
      uniqueId: existing?.uniqueId || "",
      changedFields: [{ field: "deleted", before: false, after: true }],
      summary: `Purchase deleted: ${existing?.uniqueId || req.params.id}`,
    });

    return res.json({ success: true, message: "Form Deleted Successfully" });
  } catch (error) {
    console.error("❌ Error Deleting Form:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/* =========================================================
   ✅ UNIQUE ID fetch + manual close store
   ========================================================= */

export const getIndentFormByUniqueId = async (req, res) => {
  try {
    const { uniqueId } = req.params;
    const form = await Purchase.findOne({ uniqueId });
    if (!form) {
      return res.status(404).json({ success: false, message: "Unique ID not found" });
    }
    return res.json({ success: true, data: form });
  } catch (error) {
    console.error("❌ Error Fetching By Unique ID:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const manualCloseStoreByUniqueId = async (req, res) => {
  try {
    const { uniqueId, closedBy = "", reason = "" } = req.body || {};

    if (!uniqueId) return res.status(400).json({ success: false, message: "uniqueId is required" });
    if (!reason || !String(reason).trim()) return res.status(400).json({ success: false, message: "reason is required" });

    const purchases = await Purchase.find({ uniqueId });
    if (!purchases || purchases.length === 0) {
      return res.status(404).json({ success: false, message: "Unique ID not found" });
    }

    const toClose = purchases.filter((p) => {
      const totalQty = Number(p.totalQuantity ?? 0) || 0;
      const receivedQty = Number(p.storeReceivedQuantity ?? 0) || 0;
      return receivedQty > totalQty;
    });

    if (toClose.length === 0) {
      const p0 = purchases[0];
      const totalQty = Number(p0.totalQuantity ?? 0) || 0;
      const receivedQty = Number(p0.storeReceivedQuantity ?? 0) || 0;

      return res.status(400).json({
        success: false,
        message: `Manual close allowed only when Store Received Qty is greater than Total Qty. Current: Received (${receivedQty}) <= Total (${totalQty}).`,
      });
    }

    await Purchase.updateMany(
      { _id: { $in: toClose.map((x) => x._id) } },
      {
        $set: {
          storeManualClosed: true,
          storeManualClosedAt: new Date(),
          storeManualClosedBy: closedBy || "",
          storeManualCloseReason: reason,
          storeStatus: "Manually Closed",
          storeBalanceQuantity: 0,
        },
      }
    );

    const updatedRows = await Purchase.find({ uniqueId });

    await writeAuditLogSafe({
      req,
      action: "STORE_MANUAL_CLOSE",
      targetModel: "Purchase",
      uniqueId,
      changedFields: [
        { field: "storeManualClosed", before: false, after: true },
        { field: "storeStatus", before: "", after: "Manually Closed" },
        { field: "storeManualCloseReason", before: "", after: reason },
      ],
      summary: `Manual close completed for ${uniqueId} (${toClose.length} row(s))`,
      actor: { username: closedBy || "" },
      metadata: {
        closedRowIds: summarizeIds(toClose.map((row) => row._id)),
        rowCount: toClose.length,
      },
    });

    return res.json({
      success: true,
      message: `Manually closed successfully (${toClose.length} row(s) updated)`,
      data: updatedRows,
    });
  } catch (error) {
    console.error("❌ Error Manual Closing Store:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const getManualClosedStoreItems = async (req, res) => {
  try {
    const rows = await Purchase.find({ storeManualClosed: true }).sort({ storeManualClosedAt: -1 });
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* =========================================================
   ✅ COMPARISON PDF (upload + fetch)
   ========================================================= */

export const getComparisonPdfByRowId = async (req, res) => {
  try {
    const rowId = req.params?.rowId || req.body?.rowId || req.body?.rowID || req.body?.id || "";
    if (!rowId) return res.status(400).json({ success: false, message: "Row ID missing" });

    const purchase = await Purchase.findById(rowId);
    if (!purchase) return res.status(404).json({ success: false, message: "Row not found" });

    return res.json({
      success: true,
      driveFileId: purchase.comparisonPdfDriveFileId || "",
      webViewLink: purchase.comparisonStatementPdf || "",
      uniqueId: purchase.uniqueId || "",
    });
  } catch (error) {
    console.error("❌ getComparisonPdfByRowId error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const uploadComparisonPDF = async (req, res) => {
  try {
    const rowId = req.params?.rowId || req.body?.rowId || req.body?.rowID || req.body?.id || "";
    const file = getPdfFileFromReq(req);

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "No PDF provided. Send multipart file or pdfBase64.",
      });
    }
    if (!rowId) return res.status(400).json({ success: false, message: "Row ID missing" });

    const purchase = await Purchase.findById(rowId);
    if (!purchase) return res.status(404).json({ success: false, message: "Row not found" });

    // ✅ Upload to Google Drive with error handling
    let uploaded;
    try {
      uploaded = await uploadToGoogleDrive(file, `comparison_${rowId}`);
    } catch (driveError) {
      console.error("❌ Google Drive Error:", driveError.message);
      return res.status(503).json({
        success: false,
        message: "Google Drive upload failed",
        error: driveError.message,
      });
    }

    const driveFileId = uploaded?.driveFileId || uploaded?.fileId || "";
    let webViewLink = uploaded?.webViewLink || uploaded?.webLink || uploaded?.fileUrl || "";
    if (!webViewLink && driveFileId) webViewLink = `https://drive.google.com/file/d/${driveFileId}/view`;

    if (!driveFileId || !webViewLink) {
      return res.status(500).json({ success: false, message: "Google Drive upload did not return link/fileId" });
    }

    const updated = await Purchase.findByIdAndUpdate(
      rowId,
      { $set: { comparisonStatementPdf: webViewLink, comparisonPdfDriveFileId: driveFileId } },
      { new: true }
    );

    await writeAuditLogSafe({
      req,
      action: "PURCHASE_UPLOAD_COMPARISON_PDF",
      targetModel: "Purchase",
      targetId: updated?._id || rowId,
      uniqueId: updated?.uniqueId || purchase.uniqueId || "",
      changedFields: [
        { field: "comparisonStatementPdf", before: purchase.comparisonStatementPdf || "", after: webViewLink },
        { field: "comparisonPdfDriveFileId", before: purchase.comparisonPdfDriveFileId || "", after: driveFileId },
      ],
      summary: `Comparison PDF uploaded for ${updated?.uniqueId || rowId}`,
    });

    return res.status(200).json({
      success: true,
      driveFileId: updated?.comparisonPdfDriveFileId || driveFileId,
      webViewLink: updated?.comparisonStatementPdf || webViewLink,
      uniqueId: updated?.uniqueId || purchase.uniqueId || "",
    });
  } catch (error) {
    console.error("❌ Upload Comparison PDF Error:", error);
    return res.status(500).json({
      success: false,
      message: "PDF upload failed",
      error: error.message || error.toString(),
    });
  }
};

/* =========================================================
   ✅ STORE INVOICE (single-row legacy PDF upload + fetch)
   ========================================================= */

export const getInvoicePdfByRowId = async (req, res) => {
  try {
    const rowId = req.params?.rowId || req.body?.rowId || req.body?.rowID || req.body?.id || "";
    if (!rowId) return res.status(400).json({ success: false, message: "Row ID missing" });

    const purchase = await Purchase.findById(rowId);
    if (!purchase) return res.status(404).json({ success: false, message: "Row not found" });

    return res.json({
      success: true,
      driveFileId: purchase.invoicePdfDriveFileId || "",
      webViewLink: purchase.invoicePdfWebViewLink || "",
      uniqueId: purchase.uniqueId || "",
    });
  } catch (error) {
    console.error("❌ getInvoicePdfByRowId error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const uploadInvoicePDF = async (req, res) => {
  try {
    const rowId = req.params?.rowId || req.body?.rowId || req.body?.rowID || req.body?.id || "";
    const file = getPdfFileFromReq(req);

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "No PDF provided. Send multipart file or pdfBase64.",
      });
    }
    if (!rowId) return res.status(400).json({ success: false, message: "Row ID missing" });

    const purchase = await Purchase.findById(rowId);
    if (!purchase) return res.status(404).json({ success: false, message: "Row not found" });

    // ✅ Upload to Google Drive with error handling
    let uploaded;
    try {
      uploaded = await uploadToGoogleDrive(file, `invoice_${rowId}`);
    } catch (driveError) {
      console.error("❌ Google Drive Error:", driveError.message);
      return res.status(503).json({
        success: false,
        message: "Google Drive upload failed",
        error: driveError.message,
      });
    }

    const driveFileId = uploaded?.driveFileId || uploaded?.fileId || "";
    let webViewLink = uploaded?.webViewLink || uploaded?.webLink || uploaded?.fileUrl || "";
    if (!webViewLink && driveFileId) webViewLink = `https://drive.google.com/file/d/${driveFileId}/view`;

    if (!driveFileId || !webViewLink) {
      return res.status(500).json({ success: false, message: "Google Drive upload did not return link/fileId" });
    }

    const updated = await Purchase.findByIdAndUpdate(
      rowId,
      {
        $set: {
          invoicePdfDriveFileId: driveFileId,
          invoicePdfWebViewLink: webViewLink,
          invoicePdfUploadedAt: new Date(),
        },
        $push: {
          storeInvoicePdfHistory: {
            driveFileId,
            webViewLink,
            uploadedAt: new Date(),
            uploadedBy: req.body?.username || "",
          },
        },
      },
      { new: true }
    );

    await writeAuditLogSafe({
      req,
      action: "PURCHASE_UPLOAD_INVOICE_PDF",
      targetModel: "Purchase",
      targetId: updated?._id || rowId,
      uniqueId: updated?.uniqueId || purchase.uniqueId || "",
      changedFields: [
        { field: "invoicePdfDriveFileId", before: purchase.invoicePdfDriveFileId || "", after: driveFileId },
        { field: "invoicePdfWebViewLink", before: purchase.invoicePdfWebViewLink || "", after: webViewLink },
      ],
      summary: `Invoice PDF uploaded for ${updated?.uniqueId || rowId}`,
    });

    return res.status(200).json({
      success: true,
      driveFileId: updated?.invoicePdfDriveFileId || driveFileId,
      webViewLink: updated?.invoicePdfWebViewLink || webViewLink,
      uniqueId: updated?.uniqueId || purchase.uniqueId || "",
    });
  } catch (error) {
    console.error("❌ Upload Invoice PDF Error:", error);
    return res.status(500).json({
      success: false,
      message: "Invoice PDF upload failed",
      error: error.message || error.toString(),
    });
  }
};

/* =========================================================
   ✅ PO PDF (single-row upload + fetch) + HISTORY
   ========================================================= */

export const getPoPdfByRowId = async (req, res) => {
  try {
    const rowId = req.params?.rowId || req.body?.rowId || req.body?.rowID || req.body?.id || "";
    if (!rowId) return res.status(400).json({ success: false, message: "Row ID missing" });

    const purchase = await Purchase.findById(rowId);
    if (!purchase) return res.status(404).json({ success: false, message: "Row not found" });

    return res.json({
      success: true,
      driveFileId: purchase.poPdfDriveFileId || "",
      webViewLink: purchase.poPdfWebViewLink || "",
      uniqueId: purchase.uniqueId || "",
    });
  } catch (error) {
    console.error("❌ getPoPdfByRowId error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const uploadPoPDF = async (req, res) => {
  try {
    const rowId = req.params?.rowId || req.body?.rowId || req.body?.rowID || req.body?.id || "";
    const file = getPdfFileFromReq(req);
    const role = req.body?.role || "";
    const username = req.body?.username || "";
    const normalizedLowerUsername = String(username || "").trim().toLowerCase();
    const isDebasishPoUploadOnlyUser =
      normalizedLowerUsername === "debasish samanta po" ||
      normalizedLowerUsername === "debasis samanta po";

    if (!file) return res.status(400).json({ success: false, message: "No file uploaded" });
    if (!rowId) return res.status(400).json({ success: false, message: "Row ID missing" });

    const purchase = await Purchase.findById(rowId);
    if (!purchase) return res.status(404).json({ success: false, message: "Row not found" });

    const alreadyUploaded = Boolean(purchase.poPdfDriveFileId || purchase.poPdfWebViewLink);
    if (
      alreadyUploaded &&
      String(role).toUpperCase() === "PA" &&
      !isDebasishPoUploadOnlyUser
    ) {
      return res.status(403).json({
        success: false,
        message: "PO PDF already uploaded. PA cannot upload again. Please contact PSE/Admin.",
      });
    }

    // ✅ Upload to Google Drive with error handling
    let uploaded;
    try {
      uploaded = await uploadToGoogleDrive(file, `po_${rowId}`);
    } catch (driveError) {
      console.error("❌ Google Drive Error:", driveError.message);
      return res.status(503).json({
        success: false,
        message: "Google Drive upload failed",
        error: driveError.message,
      });
    }

    const driveFileId = uploaded?.driveFileId || uploaded?.fileId || "";
    let webViewLink = uploaded?.webViewLink || uploaded?.webLink || uploaded?.fileUrl || "";
    if (!webViewLink && driveFileId) webViewLink = `https://drive.google.com/file/d/${driveFileId}/view`;

    if (!driveFileId || !webViewLink) {
      return res.status(500).json({ success: false, message: "Google Drive upload did not return link/fileId" });
    }

    const now = new Date();

    const updated = await Purchase.findByIdAndUpdate(
      rowId,
      {
        $set: {
          poPdfDriveFileId: driveFileId,
          poPdfWebViewLink: webViewLink,
          poPdfUploadedAt: now,
          poPdfUploadedBy: username,
          poPdfUploadedRole: role,
        },
        $push: {
          poPdfHistory: {
            driveFileId,
            webViewLink,
            uploadedAt: now,
            uploadedBy: username,
            uploadedRole: role,
          },
        },
      },
      { new: true }
    );

    await writeAuditLogSafe({
      req,
      action: "PURCHASE_UPLOAD_PO_PDF",
      targetModel: "Purchase",
      targetId: updated?._id || rowId,
      uniqueId: updated?.uniqueId || purchase.uniqueId || "",
      changedFields: [
        { field: "poPdfDriveFileId", before: purchase.poPdfDriveFileId || "", after: driveFileId },
        { field: "poPdfWebViewLink", before: purchase.poPdfWebViewLink || "", after: webViewLink },
      ],
      summary: `PO PDF uploaded for ${updated?.uniqueId || rowId}`,
      actor: { username, role },
    });

    return res.status(200).json({
      success: true,
      driveFileId: updated.poPdfDriveFileId,
      webViewLink: updated.poPdfWebViewLink,
      uniqueId: updated.uniqueId || "",
    });
  } catch (error) {
    console.error("❌ Upload PO PDF Error:", error);
    return res.status(500).json({
      success: false,
      message: "PO PDF upload failed",
      error: error.message || error.toString(),
    });
  }
};
//3field bulk upload for local purchase 
// ✅ Bulk update for LocalPurchase (selected rows)
export const bulkUpdateLocalPurchaseSelected = async (req, res) => {
  try {
    let {
      rowIds = [],
      invoiceDate = "",
      invoiceNumber = "",
      vendorName = "",
      modeOfTransport = "",
      transporterName = "",
      remarks = "",
    } = req.body || {};

    // allow stringified rowIds
    if (typeof rowIds === "string") {
      rowIds = JSON.parse(rowIds);
    }

    if (!Array.isArray(rowIds) || rowIds.length === 0) {
      return res.status(400).json({ success: false, message: "rowIds array is required" });
    }

    vendorName = await normalizeVendorNameOrThrow(vendorName);

    // ✅ normalize transport dropdown values
    const normalizeMode = (v) => {
      const s = String(v || "").trim();
      if (!s) return "";
      if (s === "By Hand" || s === "By Transport") return s;
      return ""; // reject any unknown value
    };

    const updateData = {
      invoiceDate: String(invoiceDate || ""),
      invoiceNumber: String(invoiceNumber || ""),
      vendorName,
      modeOfTransport: normalizeMode(modeOfTransport),
      transporterName: String(transporterName || ""),
      remarks: String(remarks || ""),
    };

    const existingRows = await LocalPurchase.find({ _id: { $in: rowIds } });

    const result = await LocalPurchase.updateMany(
      { _id: { $in: rowIds } },
      { $set: updateData }
    );

    for (const row of existingRows) {
      await writeAuditLogSafe({
        req,
        action: "LOCAL_PURCHASE_BULK_UPDATE",
        targetModel: "LocalPurchase",
        targetId: row._id,
        uniqueId: row.uniqueId || "",
        changedFields: buildFieldChanges(row, updateData, Object.keys(updateData)),
        summary: `Local Purchase bulk-updated: ${row.uniqueId || row._id}`,
      });
    }

    return res.json({
      success: true,
      message: `LocalPurchase bulk updated for ${result.modifiedCount || 0} row(s)`,
      result,
    });
  } catch (error) {
    console.error("❌ bulkUpdateLocalPurchaseSelected error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/* =========================================================
   ✅ BULK PO (ONE PO → MANY ITEMS) + HISTORY
   Route: POST /indent/po/bulk
   ========================================================= */

export const createPoAndLinkItems = async (req, res) => {
  try {
    let {
      rowIds = [],
      poNumber = "",
      poDate = "",
      vendorName = "",
      leadDays = 0,
      paymentCondition = "",
      papwDays = 0,
      username = "",
      role = "",
    } = req.body || {};

    const file = getPdfFileFromReq(req);

    if (typeof rowIds === "string") {
  try { rowIds = JSON.parse(rowIds); }
  catch { return res.status(400).json({ success:false, message:"rowIds must be a valid JSON array" }); }
}

    if (!Array.isArray(rowIds) || rowIds.length === 0) {
      return res.status(400).json({ success: false, message: "rowIds required" });
    }

    vendorName = await normalizeVendorNameOrThrow(vendorName);

    let driveFileId = "";
    let webViewLink = "";

    // Optional PDF: PO details can be applied first, and PDF can be uploaded later.
    if (file) {
      const uploaded = await uploadToGoogleDrive(file, `bulk_po_${Date.now()}`);
      driveFileId = uploaded?.driveFileId || uploaded?.fileId || "";
      webViewLink = uploaded?.webViewLink || uploaded?.fileUrl || "";

      if (!webViewLink && driveFileId) {
        webViewLink = `https://drive.google.com/file/d/${driveFileId}/view`;
      }

      if (!driveFileId || !webViewLink) {
        return res.status(500).json({ success: false, message: "Drive upload failed" });
      }
    }

    const rows = await Purchase.find({ _id: { $in: rowIds } });
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "No rows found" });
    }

    const bulkOps = [];
    const auditEntries = [];
    const now = new Date();

    for (const row of rows) {
      const updateData = {
        poNumber,
        poDate,
        vendorName,
        leadDays: Number(leadDays || 0),
        paymentCondition,
        papwDays: Number(papwDays || 0),
      };

      if (driveFileId && webViewLink) {
        updateData.poPdfDriveFileId = driveFileId;
        updateData.poPdfWebViewLink = webViewLink;
        updateData.poPdfUploadedAt = now;
        updateData.poPdfUploadedBy = username;
        updateData.poPdfUploadedRole = role;
      }

      // 🔥 EXACT SAME LOGIC AS SINGLE UPDATE
      applyPcPlannedDates(updateData, row);
      applyPaymentPlannedDates(updateData, row);
      applyMaterialReceivedDates(updateData, row);

      auditEntries.push({
        targetId: row._id,
        uniqueId: row.uniqueId || "",
        changedFields: buildFieldChanges(row, updateData, Object.keys(updateData)),
      });

      const pushData = {
        poHistory: {
          poNumber,
          poDate,
          vendorName,
          leadDays: Number(leadDays || 0),
          paymentCondition,
          papwDays: Number(papwDays || 0),
          changedAt: now,
          changedBy: username,
        },
      };

      if (driveFileId && webViewLink) {
        pushData.poPdfHistory = {
          driveFileId,
          webViewLink,
          uploadedAt: now,
          uploadedBy: username,
          uploadedRole: role,
        };
      }

      bulkOps.push({
        updateOne: {
          filter: { _id: row._id },
          update: {
            $set: updateData,
            $push: pushData,
          },
        },
      });
    }

    await Purchase.bulkWrite(bulkOps);

    for (const entry of auditEntries) {
      await writeAuditLogSafe({
        req,
        action: "PURCHASE_BULK_PO_UPDATE",
        targetModel: "Purchase",
        targetId: entry.targetId,
        uniqueId: entry.uniqueId,
        changedFields: entry.changedFields,
        summary: `Bulk PO update applied: ${entry.uniqueId || entry.targetId}`,
        actor: { username, role },
      });
    }

    return res.json({
      success: true,
      message: file
        ? `Bulk PO applied correctly to ${rows.length} item(s)`
        : `Bulk PO details applied correctly to ${rows.length} item(s). Upload PO PDF later if needed.`,
      data: {
        linkedRows: rows.length,
        driveFileId,
        webViewLink,
        pdfAttached: Boolean(file),
      },
    });
  } catch (error) {
    console.error("❌ BULK PO ERROR:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};


/* =========================================================
   ✅ STORE INVOICE MASTER (ONE INVOICE → MANY ITEMS)
   Route: POST /indent/store/invoice/bulk
   + GET invoice master by invoiceId
   ========================================================= */

export const createStoreInvoiceAndLinkItems = async (req, res) => {
  try {
    let {
      rowIds = [],
      vendorName = "",
      invoiceNumber = "",
      invoiceDate = "",
      receivedDate = "",
      username = "",
    } = req.body || {};

    const file = getPdfFileFromReq(req);

    if (typeof rowIds === "string") {
      try {
        rowIds = JSON.parse(rowIds);
      } catch {
        return res.status(400).json({ success: false, message: "rowIds must be a valid JSON array string" });
      }
    }

    if (!Array.isArray(rowIds) || rowIds.length === 0) {
      return res.status(400).json({ success: false, message: "rowIds array is required" });
    }

    vendorName = await normalizeVendorNameOrThrow(vendorName);

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "Invoice PDF file is required. Send multipart file or pdfBase64.",
      });
    }

    const rows = await Purchase.find({ _id: { $in: rowIds } });
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: "No items found for given rowIds" });
    }

    // Create invoice master (NO vendorName stored here)
    const invoiceDoc = await StoreInvoice.create({
      invoiceNumber,
      invoiceDate,
      receivedDate,
      uploadedBy: username,
      itemRowIds: rowIds,
      uniqueIds: [...new Set(rows.map((r) => r.uniqueId).filter(Boolean))],
    });

    const uploaded = await uploadToGoogleDrive(file, `store_invoice_${invoiceDoc._id}`);

    const driveFileId = uploaded?.driveFileId || uploaded?.fileId || "";
    let webViewLink = uploaded?.webViewLink || uploaded?.webLink || uploaded?.fileUrl || "";
    if (!webViewLink && driveFileId) webViewLink = `https://drive.google.com/file/d/${driveFileId}/view`;

    if (!driveFileId || !webViewLink) {
      await StoreInvoice.findByIdAndDelete(invoiceDoc._id);
      return res.status(500).json({ success: false, message: "Google Drive upload did not return link/fileId" });
    }

    invoiceDoc.driveFileId = driveFileId;
    invoiceDoc.webViewLink = webViewLink;
    invoiceDoc.uploadedAt = new Date();
    await invoiceDoc.save();

    await Purchase.updateMany(
      { _id: { $in: rowIds } },
      {
        $set: {
          storeInvoiceId: invoiceDoc._id,

          // vendorName stored only in Purchase rows (if your UI still sends it)
          ...(vendorName ? { vendorName } : {}),

          storeInvoiceNumber: invoiceNumber,
          storeInvoiceDate: invoiceDate,
          storeReceivedDate: receivedDate,

          invoicePdfDriveFileId: driveFileId,
          invoicePdfWebViewLink: webViewLink,
          invoicePdfUploadedAt: new Date(),
        },
        $push: {
          storeInvoiceIdHistory: {
            invoiceId: invoiceDoc._id,
            linkedAt: new Date(),
            linkedBy: username,
          },
          storeInvoicePdfHistory: {
            driveFileId,
            webViewLink,
            uploadedAt: new Date(),
            uploadedBy: username,
          },
          storeInvoiceHistory: {
            invoiceNumber,
            invoiceDate,
            changedAt: new Date(),
          },
        },
      }
    );

    for (const row of rows) {
      const updateSnapshot = {
        storeInvoiceId: invoiceDoc._id,
        ...(vendorName ? { vendorName } : {}),
        storeInvoiceNumber: invoiceNumber,
        storeInvoiceDate: invoiceDate,
        storeReceivedDate: receivedDate,
        invoicePdfDriveFileId: driveFileId,
        invoicePdfWebViewLink: webViewLink,
      };

      await writeAuditLogSafe({
        req,
        action: "PURCHASE_BULK_STORE_INVOICE_LINK",
        targetModel: "Purchase",
        targetId: row._id,
        uniqueId: row.uniqueId || "",
        changedFields: buildFieldChanges(row, updateSnapshot, Object.keys(updateSnapshot)),
        summary: `Store invoice linked: ${row.uniqueId || row._id}`,
        actor: { username },
      });
    }

    return res.json({
      success: true,
      message: `Invoice created & linked to ${rowIds.length} item(s)`,
      data: {
        invoiceId: invoiceDoc._id,
        driveFileId,
        webViewLink,
        invoiceNumber,
        invoiceDate,
        receivedDate,
        linkedRows: rowIds.length,
      },
    });
  } catch (error) {
    console.error("❌ createStoreInvoiceAndLinkItems error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const getStoreInvoiceById = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    if (!invoiceId) return res.status(400).json({ success: false, message: "invoiceId required" });

    const doc = await StoreInvoice.findById(invoiceId);
    if (!doc) return res.status(404).json({ success: false, message: "Invoice not found" });

    return res.json({ success: true, data: doc });
  } catch (error) {
    console.error("❌ getStoreInvoiceById error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
/* =========================================================
   ✅ INDENT VERIFICATION PDF (BULK upload + fetch)
   - Upload ONE PDF to Drive
   - Apply SAME PDF to ALL selected uniqueIds
   - DB stores only driveFileId + webViewLink (+ history)
   ========================================================= */

// (Optional) fetch per row (useful if your frontend calls like PO/store single fetch)
export const getIndentVerificationPdfByRowId = async (req, res) => {
  try {
    const rowId = req.params?.rowId || req.body?.rowId || req.body?.id || "";
    if (!rowId) return res.status(400).json({ success: false, message: "Row ID missing" });

    const purchase = await Purchase.findById(rowId);
    if (!purchase) return res.status(404).json({ success: false, message: "Row not found" });

    return res.json({
      success: true,
      driveFileId: purchase.indentVerificationPdfDriveFileId || "",
      webViewLink: purchase.indentVerificationPdfWebViewLink || "",
      uniqueId: purchase.uniqueId || "",
    });
  } catch (error) {
    console.error("❌ getIndentVerificationPdfByRowId error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ✅ BULK upload: one PDF → many uniqueIds
export const uploadIndentVerificationPdfBulk = async (req, res) => {
  try {
    let { uniqueIds = [], username = "", role = "" } = req.body || {};
    const file = getPdfFileFromReq(req);

    // allow stringified uniqueIds
    if (typeof uniqueIds === "string") {
      try {
        uniqueIds = JSON.parse(uniqueIds);
      } catch {
        return res.status(400).json({ success: false, message: "uniqueIds must be a valid JSON array" });
      }
    }

    if (!Array.isArray(uniqueIds) || uniqueIds.length === 0) {
      return res.status(400).json({ success: false, message: "uniqueIds array is required" });
    }

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "Indent Verification PDF is required. Send multipart file or pdfBase64.",
      });
    }

    // ✅ Upload ONCE to Drive
    const uploaded = await uploadToGoogleDrive(file, `indent_verification_pdf_${Date.now()}`);

    const driveFileId = uploaded?.driveFileId || uploaded?.fileId || "";
    let webViewLink = uploaded?.webViewLink || uploaded?.webLink || uploaded?.fileUrl || "";

    if (!webViewLink && driveFileId) {
      webViewLink = `https://drive.google.com/file/d/${driveFileId}/view`;
    }

    if (!driveFileId || !webViewLink) {
      return res.status(500).json({ success: false, message: "Drive upload failed (no link/fileId)" });
    }

    const now = new Date();

    // ✅ Apply to ALL rows that match these uniqueIds
    const result = await Purchase.updateMany(
      { uniqueId: { $in: uniqueIds } },
      {
        $set: {
          indentVerificationPdfDriveFileId: driveFileId,
          indentVerificationPdfWebViewLink: webViewLink,
          indentVerificationPdfUploadedAt: now,
          indentVerificationPdfUploadedBy: username,
          indentVerificationPdfUploadedRole: role,
        },
        $push: {
          indentVerificationPdfHistory: {
            driveFileId,
            webViewLink,
            uploadedAt: now,
            uploadedBy: username,
            uploadedRole: role,
          },
        },
      }
    );

    await writeAuditLogSafe({
      req,
      action: "PURCHASE_BULK_UPLOAD_INDENT_VERIFICATION_PDF",
      targetModel: "Purchase",
      changedFields: [
        { field: "indentVerificationPdfDriveFileId", before: "", after: driveFileId },
        { field: "indentVerificationPdfWebViewLink", before: "", after: webViewLink },
      ],
      summary: `Indent verification PDF uploaded for ${result.modifiedCount || 0} row(s)`,
      actor: { username, role },
      metadata: {
        updatedUniqueIds: summarizeIds(uniqueIds),
        modifiedCount: result.modifiedCount || 0,
      },
    });

    return res.json({
      success: true,
      message: `Indent Verification PDF uploaded for ${result.modifiedCount || 0} row(s)`,
      driveFileId,
      webViewLink,
      updatedUniqueIds: uniqueIds,
    });
  } catch (error) {
    console.error("❌ uploadIndentVerificationPdfBulk error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
/* =========================================================
   ✅ GET QUOTATION PDF (single-row upload + fetch) + HISTORY
   ========================================================= */

export const getGetQuotationPdfByRowId = async (req, res) => {
  try {
    const rowId = req.params?.rowId || "";
    if (!rowId) return res.status(400).json({ success: false, message: "Row ID missing" });

    const purchase = await Purchase.findById(rowId);
    if (!purchase) return res.status(404).json({ success: false, message: "Row not found" });

    return res.json({
      success: true,
      driveFileId: purchase.getQuotationPdfDriveFileId || "",
      webViewLink: purchase.getQuotationPdfWebViewLink || "",
      uniqueId: purchase.uniqueId || "",
    });
  } catch (error) {
    console.error("❌ getGetQuotationPdfByRowId error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const uploadGetQuotationPDF = async (req, res) => {
  try {
    const rowId = req.params?.rowId || "";
    const file = getPdfFileFromReq(req);

    const role = req.body?.role || "";
    const username = req.body?.username || "";

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "No PDF provided. Send multipart file or pdfBase64.",
      });
    }
    if (!rowId) return res.status(400).json({ success: false, message: "Row ID missing" });

    const purchase = await Purchase.findById(rowId);
    if (!purchase) return res.status(404).json({ success: false, message: "Row not found" });

    const uploaded = await uploadToGoogleDrive(file, `get_quotation_${rowId}`);

    const driveFileId = uploaded?.driveFileId || uploaded?.fileId || "";
    let webViewLink = uploaded?.webViewLink || uploaded?.webLink || uploaded?.fileUrl || "";
    if (!webViewLink && driveFileId) webViewLink = `https://drive.google.com/file/d/${driveFileId}/view`;

    if (!driveFileId || !webViewLink) {
      return res.status(500).json({ success: false, message: "Google Drive upload did not return link/fileId" });
    }

    const now = new Date();

    const updated = await Purchase.findByIdAndUpdate(
      rowId,
      {
        $set: {
          getQuotationPdfDriveFileId: driveFileId,
          getQuotationPdfWebViewLink: webViewLink,
          getQuotationPdfUploadedAt: now,
          getQuotationPdfUploadedBy: username,
          getQuotationPdfUploadedRole: role,
        },
        $push: {
          getQuotationPdfHistory: {
            driveFileId,
            webViewLink,
            uploadedAt: now,
            uploadedBy: username,
            uploadedRole: role,
          },
        },
      },
      { new: true }
    );

    await writeAuditLogSafe({
      req,
      action: "PURCHASE_UPLOAD_GET_QUOTATION_PDF",
      targetModel: "Purchase",
      targetId: updated?._id || rowId,
      uniqueId: updated?.uniqueId || purchase.uniqueId || "",
      changedFields: [
        { field: "getQuotationPdfDriveFileId", before: purchase.getQuotationPdfDriveFileId || "", after: driveFileId },
        { field: "getQuotationPdfWebViewLink", before: purchase.getQuotationPdfWebViewLink || "", after: webViewLink },
      ],
      summary: `Get Quotation PDF uploaded for ${updated?.uniqueId || rowId}`,
      actor: { username, role },
    });

    return res.json({
      success: true,
      driveFileId: updated.getQuotationPdfDriveFileId,
      webViewLink: updated.getQuotationPdfWebViewLink,
      uniqueId: updated.uniqueId || "",
    });
  } catch (error) {
    console.error("❌ Upload Get Quotation PDF Error:", error);
    return res.status(500).json({ success: false, message: "Get Quotation PDF upload failed", error: error.message });
  }
};
