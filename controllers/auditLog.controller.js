import AuditLog from "../models/auditLog.model.js";
import { writeAuditLogSafe } from "../utils/auditLog.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const getRecentAuditLogs = async (req, res) => {
  try {
    const since = new Date(Date.now() - SEVEN_DAYS_MS);
    await AuditLog.deleteMany({ createdAt: { $lt: since } });

    const logs = await AuditLog.find({ createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(1000)
      .lean();

    return res.json({
      success: true,
      data: logs,
      retentionDays: 7,
      since: since.toISOString(),
    });
  } catch (error) {
    console.error("❌ Failed to fetch audit logs:", error);
    return res.status(500).json({ success: false, message: error.message || "Server error" });
  }
};

export const createInputAuditLog = async (req, res) => {
  try {
    const payload = req.body || {};
    const targetModel = String(payload.targetModel || "").trim();
    const targetId = String(payload.targetId || "").trim();
    const uniqueId = String(payload.uniqueId || "").trim();
    const field = String(payload.field || "").trim();
    const section = String(payload.section || "").trim();
    const action = String(payload.action || "USER_INPUT_CHANGE").trim() || "USER_INPUT_CHANGE";
    const summary =
      String(payload.summary || "").trim() ||
      `Input changed${field ? `: ${field}` : ""}${uniqueId ? ` (${uniqueId})` : ""}`;

    if (!field) {
      return res.status(400).json({ success: false, message: "field is required" });
    }

    await writeAuditLogSafe({
      req,
      action,
      targetModel,
      targetId,
      uniqueId,
      changedFields: [
        {
          field,
          before: Object.prototype.hasOwnProperty.call(payload, "before")
            ? payload.before
            : null,
          after: Object.prototype.hasOwnProperty.call(payload, "after")
            ? payload.after
            : null,
        },
      ],
      metadata: {
        source: "ui-input",
        section,
      },
      summary,
    });

    return res.json({ success: true });
  } catch (error) {
    console.error("Failed to write input audit log:", error);
    return res.status(500).json({ success: false, message: error.message || "Server error" });
  }
};
