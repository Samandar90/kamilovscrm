import React from "react";
import { useTranslation } from "react-i18next";
import { aiAssistantService } from "../modules/ai-assistant/services/aiAssistantService";

export type MorningBriefingState =
  | { status: "loading" }
  | { status: "success"; briefing: string }
  | { status: "error"; message: string };

export function useMorningBriefing(token: string): {
  state: MorningBriefingState;
  refresh: () => void;
} {
  const { t } = useTranslation();
  const [state, setState] = React.useState<MorningBriefingState>({ status: "loading" });

  const fetchBriefing = React.useCallback(async () => {
    setState({ status: "loading" });
    try {
      const data = await aiAssistantService.morningBriefing(token);
      const briefing = typeof data.briefing === "string" ? data.briefing : "";
      setState({ status: "success", briefing: briefing.trim() || t("briefing.empty") });
    } catch (e) {
      const message = e instanceof Error ? e.message : t("briefing.loadError");
      setState({ status: "error", message });
    }
  }, [token, t]);

  React.useEffect(() => {
    void fetchBriefing();
  }, [fetchBriefing]);

  return { state, refresh: fetchBriefing };
}
