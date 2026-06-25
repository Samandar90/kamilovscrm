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
