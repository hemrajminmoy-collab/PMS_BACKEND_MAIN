import mongoose from "mongoose";

const FIELD_CHANGE_MAX_LENGTH = 500;

const fieldChangeSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const AuditLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    targetModel: { type: String, default: "" },
    targetId: { type: String, default: "" },
    uniqueId: { type: String, default: "" },
    actorUsername: { type: String, default: "Unknown" },
    actorRole: { type: String, default: "" },
    ipAddress: { type: String, default: "" },
    systemName: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    changedFields: { type: [fieldChangeSchema], default: [] },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    summary: { type: String, default: "" },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

AuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });
AuditLogSchema.index({ actorUsername: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });

AuditLogSchema.pre("save", function truncateSummary() {
  if (typeof this.summary === "string" && this.summary.length > FIELD_CHANGE_MAX_LENGTH) {
    this.summary = `${this.summary.slice(0, FIELD_CHANGE_MAX_LENGTH)}...`;
  }
});

export default mongoose.model("AuditLog", AuditLogSchema);
