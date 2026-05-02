import { google } from "googleapis";
import fs from "fs";
import path from "path";
import readline from "readline";

const filePath = path.join(process.cwd(), "googleDrive.oauth.json");
const credentials = JSON.parse(fs.readFileSync(filePath));

const { client_secret, client_id, redirect_uris } = credentials.installed;

const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);

// 🔥 Step 1: Generate URL
const authUrl = oAuth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "select_account",
  scope: ["https://www.googleapis.com/auth/drive"],
});

console.log("👉 Open this URL in browser:\n", authUrl);

// 🔥 Step 2: Ask user for code
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("\n👉 Paste the code here: ", async (code) => {
  try {
    // 🔥 Step 3: Exchange code for token
    const { tokens } = await oAuth2Client.getToken(code);

    // 🔥 Step 4: Save token
    const tokenPath = path.join(process.cwd(), "token.json");
    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));

    console.log("\n✅ Token saved successfully!");
    console.log("📂 File saved at:", tokenPath);

    rl.close();
  } catch (err) {
    console.error("❌ Error getting token:", err.message);
    rl.close();
  }
});