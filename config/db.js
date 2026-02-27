
/* eslint-env node */
/* global process */


import mongoose from "mongoose";
import dotenvFlow from "dotenv-flow";

// Load env files depending on NODE_ENV
dotenvFlow.config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB connected to:", process.env.MONGO_URI);
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error.message);
    process.exit(1);
  }
};

export default connectDB;
