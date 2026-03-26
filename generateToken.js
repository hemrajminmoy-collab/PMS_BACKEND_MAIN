import fs from "fs";
import path from "path";
import { google } from "googleapis";
/* global process */
/**
 * IMPORTANT:
 * Run this file FROM BackEnd folder:
 *   cd BackEnd
 *   node generateToken.js
 *   node generateToken.js "PASTE_CODE_HERE"
 */

const CREDENTIALS_PATH = path.join(
  process.cwd(),
  "config/googleDrive.oauth.json"
);

const TOKEN_PATH = path.join(
  process.cwd(),
  "config/token.json"
);

const SCOPES = ["https://www.googleapis.com/auth/drive"];



async function generateToken() {

  const raw = process.env.GOOGLE_OAUTH_CLIENT_JSON;

  const b64 = process.env.GOOGLE_OAUTH_CLIENT_B64;



  let credentials = null;



  if (raw || b64) {

    const jsonStr = raw || Buffer.from(b64, "base64").toString("utf8");

    credentials = JSON.parse(jsonStr);

  } else {

    if (!fs.existsSync(CREDENTIALS_PATH)) {

      throw new Error("??? googleDrive.oauth.json not found");

    }

    credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));

  }


  const { client_secret, client_id, redirect_uris } =
    credentials.installed;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  const code = process.argv[2];

  // STEP 1: Show auth URL
  if (!code) {
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "consent",
    });

    console.log("\n🔗 OPEN THIS URL IN BROWSER:\n");
    console.log(authUrl);
    console.log(
      "\nAfter approval, run:\nnode generateToken.js \"PASTE_CODE_HERE\"\n"
    );
    return;
  }

  // STEP 2: Exchange code for token
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);

  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));

  console.log("\n✅ token.json created successfully");
  console.log("📁 Location:", TOKEN_PATH);
}

generateToken().catch((err) => {
  console.error("❌ Token generation failed:", err.message);
});


