import React from "react";
import { requestJson } from "../api/http";
import { BRANDING } from "../shared/config/branding";

const TOKEN_KEY = "crm_access_token";

type ClinicApiResponse = {
  id: number;
  name: string;
  slug?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  subscriptionStatus?: string | null;
  subscriptionEndsAt?: string | null;
  subscriptionDaysLeft?: number | null;
};

export type ClinicBranding = {
  name: string;
  logoUrl: string;
  primaryColor: string;
  /** trialing | active | expired | suspended (по умолчанию active — баннеры не показываем). */
  subscriptionStatus: string;
  subscriptionDaysLeft: number | null;
};

const DEFAULT_CLINIC: ClinicBranding = {
  name: BRANDING.productName,
  logoUrl: "/logo.png",
  primaryColor: "#6D28D9",
  subscriptionStatus: "active",
  subscriptionDaysLeft: null,
};

const getStoredToken = (): string | null => {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY) ?? window.sessionStorage.getItem(TOKEN_KEY);
};

export const useClinic = (): {
  clinic: ClinicBranding;
  isLoading: boolean;
  error: string | null;
} => {
  const [clinic, setClinic] = React.useState<ClinicBranding>(DEFAULT_CLINIC);
  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setClinic(DEFAULT_CLINIC);
      setIsLoading(false);
      return;
    }

    let mounted = true;
    const controller = new AbortController();

    const loadClinic = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await requestJson<ClinicApiResponse>("/api/clinic/me", {
          signal: controller.signal,
        });
        if (!mounted) return;
        setClinic({
          name: response.name?.trim() || DEFAULT_CLINIC.name,
          logoUrl: response.logoUrl?.trim() || DEFAULT_CLINIC.logoUrl,
          primaryColor: response.primaryColor?.trim() || DEFAULT_CLINIC.primaryColor,
          subscriptionStatus: response.subscriptionStatus?.trim() || "active",
          subscriptionDaysLeft:
            typeof response.subscriptionDaysLeft === "number" ? response.subscriptionDaysLeft : null,
        });
      } catch (e) {
        if (!mounted) return;
        setClinic(DEFAULT_CLINIC);
        setError(e instanceof Error ? e.message : "Не удалось загрузить клинику");
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    void loadClinic();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, []);

  return { clinic, isLoading, error };
};
