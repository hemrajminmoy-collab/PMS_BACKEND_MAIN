import bcrypt from "bcrypt";
import User from "../models/user.model.js";
import { writeAuditLogSafe } from "../utils/auditLog.js";
import { signAuthToken } from "../config/jwt.js";

/**
 * Login Controller
 * Expects: { username, password }
 * Returns: { success: role } or { success: "error" }
 */
export const loginUser = async (req, res) => {
  try {
    const { username, password } = req.body;
    const attemptedUsername = String(username || "").trim();

    const user = await User.findOne({ username });
    if (!user) {
      console.log("No user found for username:", username);
      await writeAuditLogSafe({
        req,
        action: "USER_LOGIN_FAILED",
        targetModel: "User",
        uniqueId: attemptedUsername,
        changedFields: [{ field: "authenticated", before: false, after: false }],
        summary: `Login failed (user not found): ${attemptedUsername || "Unknown"}`,
        actor: { username: attemptedUsername },
      });
      return res.json({ success: "error" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      await writeAuditLogSafe({
        req,
        action: "USER_LOGIN_FAILED",
        targetModel: "User",
        targetId: user._id,
        uniqueId: String(user.username || ""),
        changedFields: [{ field: "authenticated", before: false, after: false }],
        summary: `Login failed (invalid password): ${user.username || attemptedUsername || "Unknown"}`,
        actor: { username: user.username || attemptedUsername || "", role: user.role || "" },
      });
      return res.json({ success: "error" });
    }

    await writeAuditLogSafe({
      req,
      action: "USER_LOGIN_SUCCESS",
      targetModel: "User",
      targetId: user._id,
      uniqueId: String(user.username || ""),
      changedFields: [{ field: "authenticated", before: false, after: true }],
      summary: `Login successful: ${user.username || attemptedUsername || "Unknown"}`,
      actor: { username: user.username || attemptedUsername || "", role: user.role || "" },
    });

    const token = signAuthToken({
      userId: String(user._id),
      username: String(user.username || ""),
      role: String(user.role || ""),
    });

    return res.json({
      success: user.role,
      token,
      username: user.username,
      role: user.role,
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ success: "error", message: "Server error" });
  }
};

/**
 * Developer-only password reset
 * Expects: { developerUsername, targetUsername, newPassword }
 */
export const editPassword = async (req, res) => {
  try {
    const { developerUsername, targetUsername, newPassword } = req.body || {};
    const DEV_USERNAME = globalThis?.process?.env?.DEVELOPER_USERNAME || "Minmoy";

    if (!developerUsername || developerUsername !== DEV_USERNAME) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    if (!targetUsername || !newPassword) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    const user = await User.findOne({ username: targetUsername });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    await writeAuditLogSafe({
      req,
      action: "USER_PASSWORD_UPDATE",
      targetModel: "User",
      targetId: user._id,
      changedFields: [{ field: "passwordUpdated", before: false, after: true }],
      summary: `Password updated for ${targetUsername}`,
      actor: { username: developerUsername || "" },
    });

    return res.json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    console.error("Edit password error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
