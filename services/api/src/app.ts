import express from "express";
import cors from "cors";
import { rootRouter } from "./routes";
import { config } from "./config";
import { asyncHandler } from "./middleware/asyncHandler";
import { buildCorsOptions } from "./middleware/corsOptions";
import { livenessCheck, readinessCheck } from "./controllers/healthController";
import { requestLogger, requestId } from "./middleware/requestLogger";
import { errorHandler } from "./middleware/errorHandler";
import { notFoundHandler } from "./middleware/notFoundHandler";

export const createApp = () => {
  const app = express();

  /** Корневые пути для health check без префикса /api (Render, Docker, ALB). */
  app.get("/health", livenessCheck);
  app.get("/health/ready", asyncHandler(readinessCheck));

  app.use(cors(buildCorsOptions(config.corsOrigins)));
  // 600kb: логотипы клиник приходят data-URL-ом (~300KB) в /onboarding и /platform/clinics/:id/branding.
  app.use(express.json({ limit: "600kb" }));
  app.use(requestId);
  app.use(requestLogger);

  app.use("/api", rootRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

