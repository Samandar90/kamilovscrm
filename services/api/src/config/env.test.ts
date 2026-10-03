import { afterEach, describe, expect, it, vi } from "vitest";

// env.ts reads .env from the working directory with override: a developer's file must not decide this test.
vi.mock("dotenv", () => ({ default: { config: () => ({}) } }));

const loadEnv = async (vars: Record<string, string>) => {
  vi.resetModules();
  vi.stubEnv("JWT_SECRET", "test-secret-of-at-least-32-characters");
  vi.stubEnv("DATA_PROVIDER", "postgres");
  vi.stubEnv("CORS_ORIGINS", "https://crm.example.com");
  vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/clinic_crm");
  for (const [name, value] of Object.entries(vars)) {
    vi.stubEnv(name, value);
  }
  return (await import("./env")).env;
};

afterEach(() => {
  vi.unstubAllEnvs();
});

// The flags that let user text and database values into the log.
describe.each([
  ["debugAiText", "DEBUG_AI_TEXT"],
  ["debugErrorDetails", "DEBUG_ERROR_DETAILS"],
] as const)("env.%s", (flag, variable) => {
  it(`is off when ${variable} is not set`, async () => {
    const env = await loadEnv({ NODE_ENV: "development", [variable]: "" });
    expect(env[flag]).toBe(false);
  });

  it(`is on with ${variable}=1 outside production`, async () => {
    const env = await loadEnv({ NODE_ENV: "development", [variable]: "1" });
    expect(env[flag]).toBe(true);
  });

  it(`stays off in production even with ${variable}=1`, async () => {
    const env = await loadEnv({ NODE_ENV: "production", [variable]: "1" });
    expect(env.isProduction).toBe(true);
    expect(env[flag]).toBe(false);
  });
});
