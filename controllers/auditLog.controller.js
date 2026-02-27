import AuditLog from "../models/auditLog.model.js";

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
