import jwt from "jsonwebtoken";

const DEFAULT_DEV_SECRET = "dev-only-change-this-jwt-secret";

export const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_DEV_SECRET;
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "12h";

export const signAuthToken = (payload) =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

export const verifyAuthTokenValue = (token) => jwt.verify(token, JWT_SECRET);
