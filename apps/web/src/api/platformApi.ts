import { requestJson } from "./http";

export type PlatformClinic = {
  id: number;
  name: string;
  slug: string | null;
  plan: string;
  status: string;
  endsAt: string | null;
  createdAt: string | null;
  userCount: number;
};

export type SubscriptionAction =
  | { action: "extend"; months: number }
  | { action: "suspend" }
  | { action: "activate" }
  | { action: "unlimited" };

export const fetchPlatformAccess = () =>
  requestJson<{ isPlatformAdmin: boolean }>("/api/platform/access");

export const fetchPlatformClinics = () =>
  requestJson<PlatformClinic[]>("/api/platform/clinics");

export const updateClinicSubscription = (
  clinicId: number,
  body: SubscriptionAction
) =>
  requestJson<PlatformClinic>(`/api/platform/clinics/${clinicId}/subscription`, {
    method: "POST",
    body,
  });

export type CreateClinicInput = {
  clinicName: string;
  clinicSlug: string;
  username: string;
  password: string;
  fullName: string;
  /** data-URL картинки (png/jpeg/webp), опционально. */
  logoUrl?: string;
};

/** Создаёт клинику + её админский аккаунт (trial 14 дней). Возвращаемый token игнорируем. */
export const createClinicWithAdmin = (body: CreateClinicInput) =>
  requestJson<{ clinic: { id: number; name: string }; user: { username: string } }>(
    "/api/onboarding",
    { method: "POST", body }
  );

/** Смена логотипа/названия клиники (лого попадает в шапку интерфейса и на чеки). */
export const updateClinicBranding = (clinicId: number, body: { logoUrl?: string; name?: string }) =>
  requestJson<{ ok: boolean; id: number }>(`/api/platform/clinics/${clinicId}/branding`, {
    method: "POST",
    body,
  });
