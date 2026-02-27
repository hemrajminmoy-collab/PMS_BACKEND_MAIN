import express from "express";
import dotenvFlow from "dotenv-flow";
import cors from "cors";
import mongoose from "mongoose";   // ✅ ADD THIS
import connectDB from "./config/db.js";

import loginRoutes from "./routes/login.routes.js";
import adduserRoutes from "./routes/adduser.routes.js";
import transportRoutes from "./routes/transport.routes.js";
import purchaseRoutes from "./routes/purchase.routes.js";
import { testDriveConnection } from "./config/googleDrive.js";

dotenvFlow.config();
console.log("NODE_ENV =", process.env.NODE_ENV);
console.log("GOOGLE_DRIVE_FOLDER_ID =", process.env.GOOGLE_DRIVE_FOLDER_ID);

const app = express();

// CORS: allow all origins (including Vercel previews) and handle preflight early
const corsOptions = {
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-System-Name",
    "X-Username",
    "X-User-Role",
  ],
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

// Middleware
app.use(express.json({ limit: "20mb" }));

// ------------------ MongoDB connection (serverless safe) ------------------
let isConnected = false;

const ensureDBConnection = async () => {
  if (isConnected) return;
  if (mongoose.connection.readyState === 1) {
    isConnected = true;
    return;
  }

  await connectDB();
  isConnected = true;
};

// In serverless/production, connect on demand for each request
if (process.env.NODE_ENV !== "development") {
  app.use(async (req, res, next) => {
    try {
      await ensureDBConnection();
      next();
    } catch (err) {
      console.error("❌ MongoDB connection failed:", err.message);
      res.status(500).json({ success: false, message: "Database connection failed" });
    }
  });
}

// Routes
app.use("/indent", purchaseRoutes);
app.use("/auth", loginRoutes);
app.use("/adduser", adduserRoutes);
app.use("/transport", transportRoutes);

// Root
app.get("/", (req, res) => {
  res.send("⚡ Purchase Management API is running...");
});

// Health check: Google Drive auth + folder access
app.get("/health/drive", async (req, res) => {
  try {
    const info = await testDriveConnection();
    res.status(200).json({ success: true, ...info });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message || "Drive connection failed",
    });
  }
});

// Dev server
if (process.env.NODE_ENV === "development") {
  const PORT = process.env.PORT || 5000;

  connectDB()
    .then(() => {
      console.log("✅ MongoDB connected successfully");

      // ✅ ADD THESE LOGS (shows EXACT DB Compass must open)
      console.log("✅ Connected to:", mongoose.connection.host);
      console.log("✅ DB name:", mongoose.connection.name);

      app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
      });
    })
    .catch((err) => {
      console.error("❌ MongoDB connection failed:", err.message);
    });
} else {
  console.log("🌐 Running in serverless (production) mode — no app.listen()");
}

export default app;
