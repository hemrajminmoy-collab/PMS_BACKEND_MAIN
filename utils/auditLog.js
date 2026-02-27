import AuditLog from "../models/auditLog.model.js";

const MAX_VALUE_LENGTH = 500;

const normalizeLongString = (value) => {
  if (typeof value !== "string") return value;
  if (value.length <= MAX_VALUE_LENGTH) return value;
  return `${value.slice(0, MAX_VALUE_LENGTH)}...`;
};

const normalizeValue = (value) => {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }

  if (typeof value === "object") {
    try {
      const serialized = JSON.stringify(value);
      if (serialized.length > MAX_VALUE_LENGTH) {
        return `${serialized.slice(0, MAX_VALUE_LENGTH)}...`;
      }
      return value;
    } catch {
      return String(value);
    }
  }

  return normalizeLongString(value);
};

export const toPlainObject = (doc) => {
  if (!doc) return {};
  if (typeof doc.toObject === "function") {
    return doc.toObject({ getters: false, virtuals: false, minimize: false });
  }
  return { ...doc };
};

export const extractActorFromRequest = (req = {}, fallback = {}) => {
  const body = req.body || {};
  const query = req.query || {};
  const headers = req.headers || {};

  const username =
    body.username ||
    body.closedBy ||
    body.submittedBy ||
    query.username ||
    headers["x-username"] ||
    fallback.username ||
    "";

  const role =
    body.role ||
    query.role ||
    headers["x-user-role"] ||
    fallback.role ||
    "";

  return {
    username: String(username || "").trim() || "Unknown",
    role: String(role || "").trim(),
  };
};

export const extractClientMetaFromRequest = (req = {}, fallback = {}) => {
  const headers = req.headers || {};
  const forwarded = headers["x-forwarded-for"];
  const remoteIp = req.ip || req.socket?.remoteAddress || "";

  const ipAddress = String(Array.isArray(forwarded) ? forwarded[0] : forwarded || remoteIp || "")
    .split(",")[0]
    .trim()
    .replace(/^::ffff:/, "");

  const userAgent = String(headers["user-agent"] || "").trim();
  const systemFromBody = String(req.body?.systemName || "").trim();
  const systemFromHeader = String(headers["x-system-name"] || "").trim();
  const systemFromPlatform = String(headers["sec-ch-ua-platform"] || "").replace(/"/g, "").trim();

  const systemName =
    systemFromBody ||
    systemFromHeader ||
    (systemFromPlatform ? `Platform: ${systemFromPlatform}` : "") ||
    fallback.systemName ||
    "";

  return {
    ipAddress,
    systemName: normalizeLongString(systemName),
    userAgent: normalizeLongString(userAgent),
  };
};

export const buildFieldChanges = (beforeDoc = {}, afterDoc = {}, fields = []) => {
  const before = toPlainObject(beforeDoc);
  const after = toPlainObject(afterDoc);
  const keys = fields.length > 0 ? fields : Object.keys(after);

  const changes = [];

  for (const key of keys) {
    if (["username", "role", "systemName"].includes(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(after, key)) continue;

    const beforeValue = before[key];
    const afterValue = after[key];

    const beforeSerialized = JSON.stringify(normalizeValue(beforeValue));
    const afterSerialized = JSON.stringify(normalizeValue(afterValue));
    if (beforeSerialized === afterSerialized) continue;

    changes.push({
      field: key,
      before: normalizeValue(beforeValue),
      after: normalizeValue(afterValue),
    });
  }

  return changes;
};

export const writeAuditLog = async ({
  req,
  action,
  targetModel = "",
  targetId = "",
  uniqueId = "",
  changedFields = [],
  metadata = {},
  summary = "",
  actor = {},
}) => {
  if (!action) return;

  const { username, role } = extractActorFromRequest(req, actor);
  const clientMeta = extractClientMetaFromRequest(req);

  await AuditLog.create({
    action,
    targetModel,
    targetId: String(targetId || ""),
    uniqueId: String(uniqueId || ""),
    actorUsername: username,
    actorRole: role,
    ipAddress: clientMeta.ipAddress,
    systemName: clientMeta.systemName,
    userAgent: clientMeta.userAgent,
    changedFields: Array.isArray(changedFields) ? changedFields : [],
    metadata: metadata || {},
    summary: normalizeLongString(String(summary || "")),
  });
};

export const writeAuditLogSafe = async (payload) => {
  try {
    await writeAuditLog(payload);
  } catch (error) {
    console.error("❌ Audit log write failed:", error.message);
  }
};
