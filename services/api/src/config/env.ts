import dotenv from "dotenv";

// Ensure local .env values override existing environment variables.
import path from "path";

// Load .env from process cwd (services/api when using `npm run dev` / `npm start`)
// so PORT and DATABASE_URL always apply; __dirname can point at ts-node temp dirs.
const dotenvPath = path.resolve(process.cwd(), ".env");
dotenv.config({ override: true, path: dotenvPath });

const jwtSecretRaw = process.env.JWT_SECRET;
if (!jwtSecretRaw || jwtSecretRaw.trim() === "") {
  throw new Error("JWT_SECRET environment variable is required");
}
const jwtSecret = jwtSecretRaw.trim();

const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";

const defaultCorsOrigins = "http://localhost:5173";
const corsOriginsEnv = process.env.CORS_ORIGINS?.trim();
if (isProduction && !corsOriginsEnv) {
  throw new Error(
    "CORS_ORIGINS is required when NODE_ENV=production (comma-separated allowed browser origins, e.g. https://app.example.com)"
  );
}
const corsOrigins = (isProduction ? corsOriginsEnv! : corsOriginsEnv || defaultCorsOrigins)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

if (isProduction && corsOrigins.length === 0) {
  throw new Error("CORS_ORIGINS must include at least one non-empty origin");
}

if (isProduction && jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters when NODE_ENV=production");
}

/**
 * Opt-in only (and never when NODE_ENV=production): PaymentsService may auto-open a zero-balance shift.
 * Set CASH_REGISTER_AUTO_OPEN_DEV=true for local PostgreSQL smoke tests.
 */
const cashRegisterAutoOpenDev =
  process.env.NODE_ENV !== "production" &&
  process.env.CASH_REGISTER_AUTO_OPEN_DEV === "true";

/**
 * IANA timezone for report date boundaries and date_trunc buckets (payments, appointments).
 * Default Asia/Tashkent matches typical UZS clinic operations (UTC+5, no DST).
 */
const reportsTimezone =
  (process.env.REPORTS_TIMEZONE || "Asia/Tashkent").trim() || "Asia/Tashkent";

/**
 * In-memory mock repositories: opt-in only via DATA_PROVIDER=mock (never default in production).
 * Default is PostgreSQL for production-like runs.
 */
const dataProvider: "postgres" | "mock" =
  process.env.DATA_PROVIDER === "mock" ? "mock" : "postgres";

if (isProduction && dataProvider === "mock") {
  throw new Error("DATA_PROVIDER=mock is not allowed when NODE_ENV=production");
}

if (isProduction && (!process.env.DATABASE_URL || !process.env.DATABASE_URL.trim())) {
  throw new Error("DATABASE_URL is required when NODE_ENV=production");
}

/** Display name on internal receipts and optional API responses (not fiscal). */
const clinicDisplayName = (process.env.CLINIC_NAME || "Клиника").trim() || "Клиника";

const clinicReceiptFooter =
  (process.env.CLINIC_RECEIPT_FOOTER || "Внутренний документ · не является фискальным чеком").trim() ||
  "Внутренний документ · не является фискальным чеком";

/**
 * SMS-напоминания пациентам через Eskiz.uz. Включаются только когда заданы
 * SMS_ENABLED=true и учётные данные Eskiz (ESKIZ_EMAIL / ESKIZ_PASSWORD).
 * Плюс per-clinic флаг clinics.sms_enabled (управляется платформенным админом).
 */
const eskizEmail = process.env.ESKIZ_EMAIL?.trim() || "";
const eskizPassword = process.env.ESKIZ_PASSWORD?.trim() || "";
const smsEnabled =
  process.env.SMS_ENABLED?.trim() === "true" && Boolean(eskizEmail && eskizPassword);
/** Имя отправителя, согласованное в Eskiz (4546 — общий шлюз по умолчанию). */
const smsFrom = process.env.SMS_FROM?.trim() || "4546";
const smsReminderTemplate =
  process.env.SMS_REMINDER_TEMPLATE?.trim() ||
  "Здравствуйте, {patient}! Напоминаем: вы записаны в {clinic} {date} в {time}. Ждём вас!";

/** Dev-only маршруты (например POST /api/dev/create-admin) — никогда в production. */
const allowDevBootstrap = !isProduction;

/** Логировать `values` у `dbPool.query` (найти 22P02 и т.п.). Только локально: DEBUG_SQL_PARAMS=1, не production. */
const debugSqlParams =
  !isProduction && process.env.DEBUG_SQL_PARAMS?.trim() === "1";

/** POST /api/invoices: req.body, payload, INSERT values — только DEBUG_INVOICE_CREATE=1, не production. */
const debugInvoiceCreate =
  !isProduction && process.env.DEBUG_INVOICE_CREATE?.trim() === "1";

export const env = {
  nodeEnv,
  isProduction,
  allowDevBootstrap,
  port: Number(process.env.PORT) || 4000,
  dataProvider,
  jwtSecret,
  corsOrigins,
  databaseUrl:
    process.env.DATABASE_URL?.trim() ||
    "postgresql://postgres:postgres@localhost:5432/clinic_crm",
  /** See CASH_REGISTER_AUTO_OPEN_DEV — never enable in production. */
  cashRegisterAutoOpenDev,
  reportsTimezone,
  clinicDisplayName,
  clinicReceiptFooter,
  debugSqlParams,
  debugInvoiceCreate,
  smsEnabled,
  eskizEmail,
  eskizPassword,
  smsFrom,
  smsReminderTemplate,
};

