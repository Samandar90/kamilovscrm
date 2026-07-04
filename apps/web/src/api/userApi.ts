import { requestJson } from "./http";

export const changePassword = (currentPassword: string, newPassword: string) =>
  requestJson<{ ok: boolean; message: string }>("/api/auth/change-password", {
    method: "POST",
    body: { currentPassword, newPassword },
  });
