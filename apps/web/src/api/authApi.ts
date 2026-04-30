import { requestJson } from "./http";
import type {
  AuthResponse,
  LoginInput,
  OnboardingInput,
  OnboardingResponse,
  PublicUser,
} from "../auth/types";

export const authApi = {
  login: (input: LoginInput) =>
    requestJson<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: input,
    }),

  onboarding: (input: OnboardingInput) =>
    requestJson<OnboardingResponse>("/api/onboarding", {
      method: "POST",
      body: input,
    }),

  logout: (token?: string | null) =>
    requestJson<{ success: boolean; message: string }>("/api/auth/logout", {
      method: "POST",
      token: token ?? null,
    }),

  getMe: (token: string) =>
    requestJson<PublicUser>("/api/auth/me", {
      method: "GET",
      token,
    }),
};
