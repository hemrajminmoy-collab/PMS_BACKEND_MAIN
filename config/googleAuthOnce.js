/* global process */
/* eslint-env node */

import fs from "fs";
import path from "path";
import readline from "readline";
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const CREDENTIALS_PATH = path.join(
  process.cwd(),
  "config/googleDrive.oauth.json"
);
const TOKEN_PATH = path.join(
  process.cwd(),
  "config/token.json"
);

const getOAuthClient = () => {
  const raw = process.env.GOOGLE_OAUTH_CLIENT_JSON;
  const b64 = process.env.GOOGLE_OAUTH_CLIENT_B64;

  if (!raw && !b64) return null;

  const jsonStr = raw || Buffer.from(b64, "base64").toString("utf8");
  return JSON.parse(jsonStr);
};

let credentials = getOAuthClient();
if (!credentials) {
  credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
}
const { client_secret, client_id, redirect_uris } =
  credentials.installed;

const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",   // 👈 FORCE refresh_token
  scope: ["https://www.googleapis.com/auth/drive"],
});


console.log("🔑 Authorize this app by visiting this URL:\n", authUrl);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("\nPaste the code here: ", async (code) => {
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
  console.log("✅ token.json stored successfully!");
  rl.close();
});
