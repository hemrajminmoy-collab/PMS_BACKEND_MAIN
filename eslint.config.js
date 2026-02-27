import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  // Ignore build output
  globalIgnores(["dist"]),

  // 🟢 Backend (Node.js) — MUST COME FIRST
  {
    files: ["**/BackEnd/**/*.js", "**/backend/**/*.js", "server.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node, // ✅ Buffer, process, __dirname
    },
  },

  // 🌐 Frontend (React / Browser)
  {
    files: ["**/*.{js,jsx}"],
    ignores: ["**/BackEnd/**", "**/backend/**"], // 🚫 exclude backend
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      "no-unused-vars": ["error", { varsIgnorePattern: "^[A-Z_]" }],
    },
  },
]);
