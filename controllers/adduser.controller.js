import bcrypt from "bcrypt";
import User from "../models/user.model.js";
import { writeAuditLogSafe } from "../utils/auditLog.js";

export const addUser = async (req, res) => {
  try {
    const { username, password, role } = req.body;

    // Validate input
    if (!username || !password || !role) {
      return res.json({
        success: false,
        message: "All fields are required",
      });
    }

    // Check if user exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.json({
        success: false,
        message: "Username already exists",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const newUser = new User({
      username,
      password: hashedPassword,
      role,
    });

    await newUser.save();

    await writeAuditLogSafe({
      req,
      action: "USER_CREATE",
      targetModel: "User",
      targetId: newUser._id,
      changedFields: [
        { field: "username", before: null, after: username },
        { field: "role", before: null, after: role },
      ],
      summary: `User created: ${username}`,
    });

    res.json({
      success: true,
      message: "User added successfully",
    });
  } catch (error) {
    console.error("❌ [Backend] Add User Error:", error);
    res.json({
      success: false,
      message: "Server error",
    });
  }
};
