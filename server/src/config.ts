import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root directory is 2 levels up from server/src: server/src -> server -> root
export const rootDir = path.resolve(__dirname, "../../");
export const rootEnvPath = path.resolve(rootDir, ".env");

// Load ROOT .env with override regardless of working directory
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath, override: true });
} else {
  dotenv.config({ override: true });
}

export function cleanEnvString(val: string | undefined, fallback: string = ""): string {
  if (val === undefined || val === null) return fallback;
  let str = String(val).trim();
  // Strip inline comments if not inside quotes
  const hashIdx = str.indexOf("#");
  if (hashIdx !== -1) {
    const beforeHash = str.substring(0, hashIdx);
    const quoteCount = (beforeHash.match(/["']/g) || []).length;
    if (quoteCount % 2 === 0) {
      str = beforeHash.trim();
    }
  }
  // Strip matching leading/trailing single or double quotes
  if (
    (str.startsWith('"') && str.endsWith('"')) ||
    (str.startsWith("'") && str.endsWith("'"))
  ) {
    str = str.slice(1, -1).trim();
  }
  return str || fallback;
}

const rawPort = cleanEnvString(process.env.PORT, "5000");
const parsedPort = parseInt(rawPort, 10);
const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 5000;

// Validate DATABASE_URL starts with file:
let databaseUrl = cleanEnvString(process.env.DATABASE_URL, "file:../data/medorg.db");
if (!databaseUrl.startsWith("file:")) {
  console.warn(
    `[CONFIG WARNING] Malformed DATABASE_URL: must start with "file:". Defaulting to "file:../data/medorg.db" for SQLite.`
  );
  databaseUrl = "file:../data/medorg.db";
}

// Validate and ensure data directories exist
const rawDataDir = cleanEnvString(process.env.DATA_DIR, "./data");
const dataDir = path.isAbsolute(rawDataDir)
  ? rawDataDir
  : path.resolve(rootDir, rawDataDir.replace(/^\.\//, ""));

for (const subDir of [
  dataDir,
  path.resolve(dataDir, "uploads"),
  path.resolve(dataDir, "uploads", "reports"),
  path.resolve(dataDir, "uploads", "prescriptions"),
  path.resolve(dataDir, "uploads", "temp"),
]) {
  if (!fs.existsSync(subDir)) {
    fs.mkdirSync(subDir, { recursive: true });
  }
}

export const config = {
  rootDir,
  rootEnvPath,
  nodeEnv: cleanEnvString(process.env.NODE_ENV, "development"),
  port,
  clientUrl: cleanEnvString(process.env.CLIENT_URL, "http://localhost:3000"),
  allowedOrigins: cleanEnvString(
    process.env.ALLOWED_ORIGINS,
    "http://localhost:3000,http://127.0.0.1:3000"
  ).split(",").map((s) => s.trim()),
  viteBasePath: cleanEnvString(process.env.VITE_BASE_PATH, "/"),
  dataDir,
  databaseUrl,

  // Email config
  emailTransport: cleanEnvString(process.env.EMAIL_TRANSPORT, "api"),
  brevoApiKey: cleanEnvString(process.env.BREVO_API_KEY, ""),
  brevoFromEmail: cleanEnvString(process.env.BREVO_FROM_EMAIL, "no-reply@medorg.com"),
  brevoFromName: cleanEnvString(process.env.BREVO_FROM_NAME, "MedOrg"),
  brevoSmtpHost: cleanEnvString(process.env.BREVO_SMTP_HOST, "smtp-relay.brevo.com"),
  brevoSmtpPort: parseInt(cleanEnvString(process.env.BREVO_SMTP_PORT, "587"), 10) || 587,
  brevoSmtpUser: cleanEnvString(process.env.BREVO_SMTP_USER, ""),
  brevoSmtpPassword: cleanEnvString(process.env.BREVO_SMTP_PASSWORD, ""),

  // Groq AI config
  groqApiKey: cleanEnvString(process.env.GROQ_API_KEY, ""),
  groqBaseUrl: cleanEnvString(process.env.GROQ_BASE_URL, "https://api.groq.com/openai/v1"),
  groqModel: cleanEnvString(process.env.GROQ_MODEL, "openai/gpt-oss-20b"),

  // File upload config
  maxFileSizeMb: parseInt(cleanEnvString(process.env.MAX_FILE_SIZE_MB, "10"), 10) || 10,

  // Session config
  sessionDays: parseInt(cleanEnvString(process.env.SESSION_DAYS, "7"), 10) || 7,

  // DB viewer config
  enableDbViewer: cleanEnvString(process.env.ENABLE_DB_VIEWER, "true") === "true",
  allowDbReset:
    cleanEnvString(process.env.ALLOW_DB_RESET, "true") === "true" &&
    process.env.NODE_ENV !== "production",

  // OTP Dev test hook
  otpDevLog: process.env.OTP_DEV_LOG === "true",
};