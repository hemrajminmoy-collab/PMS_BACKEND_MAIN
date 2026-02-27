import { verifyAuthTokenValue } from "../config/jwt.js";

const normalize = (value) => String(value || "").trim().toLowerCase();
const ENV = globalThis?.process?.env || {};
const parseAllowedSet = (rawValue, fallback = []) =>
  new Set(
    String(rawValue || "")
      .split(",")
      .map((item) => normalize(item))
      .filter(Boolean)
      .concat(fallback.map((item) => normalize(item)))
      .filter(Boolean)
  );

const AUDIT_ALLOWED_USERS = parseAllowedSet(ENV.AUDIT_ALLOWED_USERS, [
  "minmoy",
  "mrinmoy",
]);
const AUDIT_ALLOWED_ROLES = parseAllowedSet(ENV.AUDIT_ALLOWED_ROLES, [
  "admin",
]);

export const requireAuthToken = (req, res, next) => {
  try {
    const authHeader = req.headers?.authorization || "";
    const [scheme, token] = authHeader.split(" ");

    if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
      return res.status(401).json({ success: false, message: "Missing auth token" });
    }

    const decoded = verifyAuthTokenValue(token);
    req.authUser = decoded || {};
    return next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};

export const requireAuditLogAccess = (req, res, next) => {
  const username = normalize(req.authUser?.username);
  const role = normalize(req.authUser?.role);
  const isAllowedUser = AUDIT_ALLOWED_USERS.has(username);
  const isAllowedRole = AUDIT_ALLOWED_ROLES.has(role);

  if (!isAllowedUser && !isAllowedRole) {
    return res.status(403).json({ success: false, message: "Not authorized" });
  }
  return next();
};
