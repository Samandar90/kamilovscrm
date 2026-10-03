import type { CorsOptions } from "cors";

/**
 * How long a browser may reuse a preflight answer. Browsers cap it themselves (Chrome at 2 hours, Firefox at 24).
 * Without it Chrome repeats the preflight every 5 seconds per URL: the web calls the API from another origin with an
 * Authorization header, so almost every API call cost two round trips.
 */
export const CORS_PREFLIGHT_MAX_AGE_SECONDS = 86_400;

export const buildCorsOptions = (allowedOrigins: readonly string[]): CorsOptions => ({
  origin: (origin, callback) => {
    // Allow non-browser clients (no Origin) and configured web origins.
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  maxAge: CORS_PREFLIGHT_MAX_AGE_SECONDS,
});
