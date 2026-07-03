import "./loadEnv";
import http from "http";
import { createApp } from "./app";
import { config } from "./config";
import { env } from "./config/env";
import { dbPool } from "./config/database";
import { ensureMockSeedData } from "./repositories/mockDatabase";
import { startSmsReminderScheduler } from "./services/sms/smsReminderService";

const app = createApp();
const server = http.createServer(app);

const port = config.port;
if (env.dataProvider === "mock") {
  ensureMockSeedData();
}

const start = async (): Promise<void> => {
  if (env.dataProvider === "postgres") {
    const dbUrl = process.env.DATABASE_URL;
    if (env.isProduction) {
      const redacted = dbUrl ? `${dbUrl.slice(0, 10)}...${dbUrl.slice(-10)}` : "undefined";
      // eslint-disable-next-line no-console
      console.log("DB URL:", redacted);
    } else {
      // eslint-disable-next-line no-console
      console.log("DB URL:", dbUrl);
    }

    dbPool
      .query("SELECT 1 AS ok")
      .then(() => {
        // eslint-disable-next-line no-console
        console.log("[DB] SELECT 1 OK");
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        const payload = err instanceof Error
          ? { name: err.name, message: err.message, code: (err as any).code }
          : { message: String(err) };
        console.warn("[DB] SELECT 1 FAILED:", JSON.stringify(payload));
      });
  }

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log("Server running on port", port);
    startSmsReminderScheduler();
  });
};

void start();

