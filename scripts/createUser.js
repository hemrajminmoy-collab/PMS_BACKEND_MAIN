/* eslint-env node */
/* global process */
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import readline from "readline";
import User from "../models/user.model.js"; // adjust the path if needed
//node scripts/createUser.js

// ✅ MongoDB connection
const mongoURI = "mongodb+srv://digitx2025_db_user:hPC8eTwQxhl1Z8rg@purchase-data-entry.r1sqjoo.mongodb.net/?appName=Purchase-Data-Entry";
mongoose.connect(mongoURI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// ✅ Read command line inputs
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

const createUser = async () => {
  try {
    const username = await question("Enter username: ");
    const password = await question("Enter password: ");
    const role = await question("Enter role: ");

    // hash the password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // create new user
    const newUser = new User({
      username,
      password: hashedPassword,
      role
    });

    await newUser.save();
    console.log(`✅ User '${username}' created successfully!`);
  } catch (error) {
    console.error("❌ Error creating user:", error);
  } finally {
    rl.close();
    mongoose.connection.close();
  }
};

createUser();