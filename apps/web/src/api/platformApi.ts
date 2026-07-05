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
  smsEnabled: boolean;
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
  /** data-URL image (png/jpeg/webp), optional. */
  logoUrl?: string;
};

/** Creates clinic + its admin account (14-day trial). Returned token is ignored. */
export const createClinicWithAdmin = (body: CreateClinicInput) =>
  requestJson<{ clinic: { id: number; name: string }; user: { username: string } }>(
    "/api/onboarding",
    { method: "POST", body }
  );

/** Enable/disable SMS reminders for patients. */
export const updateClinicSms = (clinicId: number, enabled: boolean) =>
  requestJson<PlatformClinic>(`/api/platform/clinics/${clinicId}/sms`, {
    method: "POST",
    body: { enabled },
  });

/** Change clinic logo/name (logo appears in interface header and receipts). */
export const updateClinicBranding = (clinicId: number, body: { logoUrl?: string; name?: string }) =>
  requestJson<{ ok: boolean; id: number }>(`/api/platform/clinics/${clinicId}/branding`, {
    method: "POST",
    body,
  });
