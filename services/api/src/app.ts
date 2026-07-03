import express from "express";
import cors from "cors";
import { rootRouter } from "./routes";
import { config } from "./config";
import { asyncHandler } from "./middleware/asyncHandler";
import { livenessCheck, readinessCheck } from "./controllers/healthController";
import { requestLogger, requestId } from "./middleware/requestLogger";
import { errorHandler } from "./middleware/errorHandler";
import { notFoundHandler } from "./middleware/notFoundHandler";

export const createApp = () => {
  const app = express();

  /** Корневые пути для health check без префикса /api (Render, Docker, ALB). */
  app.get("/health", livenessCheck);
  app.get("/health/ready", asyncHandler(readinessCheck));

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow non-browser clients (no Origin) and configured web origins.
        if (!origin || config.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
    })
  );
  // 600kb: логотипы клиник приходят data-URL-ом (~300KB) в /onboarding и /platform/clinics/:id/branding.
  app.use(express.json({ limit: "600kb" }));
  app.use(requestId);
  app.use(requestLogger);

  app.use("/api", rootRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

