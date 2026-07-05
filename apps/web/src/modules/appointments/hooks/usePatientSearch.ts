import React from "react";
import { useTranslation } from "react-i18next";
import type { Patient } from "../api/appointmentsFlowApi";
import { appointmentsFlowApi } from "../api/appointmentsFlowApi";
import { useDebounce } from "./useDebounce";

type Result = {
  suggestions: Patient[];
  loading: boolean;
  error: string | null;
  refreshNow: (query: string) => Promise<void>;
};

export function usePatientSearch(token: string | null, query: string): Result {
  const { t } = useTranslation();
  const debouncedQuery = useDebounce(query.trim(), 300);
  const [suggestions, setSuggestions] = React.useState<Patient[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const runSearch = React.useCallback(
    async (raw: string) => {
      const q = raw.trim();
      if (!q || !token) {
        setSuggestions([]);
        setLoading(false);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const rows = await appointmentsFlowApi.listPatients(token, { search: q });
        setSuggestions(rows);
      } catch (e) {
        setSuggestions([]);
        setError(e instanceof Error ? e.message : t("patients.loadError"));
      } finally {
        setLoading(false);
      }
    },
    [token, t]
  );

  React.useEffect(() => {
    void runSearch(debouncedQuery);
  }, [debouncedQuery, runSearch]);

  return {
    suggestions,
    loading,
    error,
    refreshNow: runSearch,
  };
}

