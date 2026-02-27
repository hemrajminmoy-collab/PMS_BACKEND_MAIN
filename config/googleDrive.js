import { google } from "googleapis";
import { Readable } from "stream";
import fs from "fs";
import path from "path";

/* global process */
/* eslint-env node */

// ------------------------------------------------------------------
// Service Account (serverless-friendly)
// Provide credentials via env:
// - GOOGLE_SERVICE_ACCOUNT_JSON (preferred, raw JSON string)
// - or GOOGLE_SERVICE_ACCOUNT_B64 (base64-encoded JSON)
// ------------------------------------------------------------------

const getServiceAccount = () => {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;

  if (!raw && !b64) {
    return null;
  }

  const jsonStr = raw || Buffer.from(b64, "base64").toString("utf8");
  const creds = JSON.parse(jsonStr);

  if (!creds.client_email || !creds.private_key) {
    throw new Error("Invalid service account JSON: client_email/private_key missing");
  }

  return creds;
};

const getOAuthClient = () => {
  const raw = process.env.GOOGLE_OAUTH_CLIENT_JSON;
  const b64 = process.env.GOOGLE_OAUTH_CLIENT_B64;

  if (!raw && !b64) return null;

  const jsonStr = raw || Buffer.from(b64, "base64").toString("utf8");
  const creds = JSON.parse(jsonStr);
  return creds;
};

const getOAuthToken = () => {
  const raw = process.env.GOOGLE_OAUTH_TOKEN_JSON;
  const b64 = process.env.GOOGLE_OAUTH_TOKEN_B64;

  if (!raw && !b64) return null;

  const jsonStr = raw || Buffer.from(b64, "base64").toString("utf8");
  const token = JSON.parse(jsonStr);
  return token;
};

let auth = null;
let drive = null;

const ensureDrive = () => {
  if (drive) return drive;
  const serviceAccount = getServiceAccount();

  if (serviceAccount) {
    auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
    drive = google.drive({ version: "v3", auth });
    return drive;
  }

  // OAuth credentials/token via env (preferred for deploys)
  let credentials = getOAuthClient();
  let token = getOAuthToken();

  // Fallback: OAuth files on disk (local dev)
  const credentialsPath = path.join(process.cwd(), "config/googleDrive.oauth.json");
  const tokenPath = path.join(process.cwd(), "config/token.json");

  if (!credentials || !token) {
    if (fs.existsSync(credentialsPath)) {
      credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
    }
    if (fs.existsSync(tokenPath)) {
      token = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
    }
  }

  if (!credentials || !token) {
    throw new Error(
      "Missing Google Drive credentials. Set GOOGLE_SERVICE_ACCOUNT_JSON/B64 or GOOGLE_OAUTH_CLIENT_JSON/B64 + GOOGLE_OAUTH_TOKEN_JSON/B64, or provide config/googleDrive.oauth.json + config/token.json."
    );
  }

  const { client_secret, client_id, redirect_uris } = credentials.installed || {};
  if (!client_id || !client_secret || !redirect_uris?.[0]) {
    throw new Error("Invalid OAuth client JSON in config/googleDrive.oauth.json");
  }

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );
  oAuth2Client.setCredentials(token);
  auth = oAuth2Client;
  drive = google.drive({ version: "v3", auth });
  return drive;
};

/**
 * Generic Google Drive uploader
 * @param {Object} file - multer file
 * @param {String} fileNamePrefix - unique name or identifier
 * @returns { driveFileId, webViewLink }
 */
export const uploadToGoogleDrive = async (file, fileNamePrefix) => {
  try {
    if (!file) throw new Error("file is required");
    const driveClient = ensureDrive();

    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    const response = await driveClient.files.create({
      requestBody: {
        name: `${fileNamePrefix}.pdf`,
        parents: folderId ? [folderId] : undefined,
      },
      media: {
        mimeType: file.mimetype || "application/pdf",
        body: Readable.from(file.buffer),
      },
      fields: "id, webViewLink",
    });

    const fileId = response.data.id;
    if (!fileId) {
      throw new Error("Google Drive did not return a file ID");
    }

    // Make file publicly readable (best-effort)
    try {
      await driveClient.permissions.create({
        fileId,
        requestBody: { role: "reader", type: "anyone" },
      });
    } catch (permError) {
      console.warn("Could not set public permissions:", permError.message);
    }

    return {
      driveFileId: fileId,
      webViewLink: response.data.webViewLink,
    };
  } catch (error) {
    console.error("Google Drive Upload Error:", error.message);
    throw error;
  }
};

export const testDriveConnection = async () => {
  const driveClient = ensureDrive();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (folderId) {
    const res = await driveClient.files.get({
      fileId: folderId,
      fields: "id,name",
    });
    return { ok: true, folderId: res.data?.id || folderId, folderName: res.data?.name || "" };
  }

  const res = await driveClient.files.list({
    pageSize: 1,
    fields: "files(id,name)",
  });
  const first = res.data?.files?.[0];
  return { ok: true, folderId: "", folderName: "", sampleFile: first || null };
};
