import * as React from "react";
import { appointmentsFlowApi } from "../api/appointmentsFlowApi";
import { normalizeDateTimeForApi } from "../utils/appointmentFormUtils";

export type SlotAvailabilityPhase = "idle" | "pending" | "loading" | "free" | "busy" | "error";

const DEBOUNCE_MS = 400;

export type SlotAvailabilityParams = {
  doctorId: string;
  /** Все услуги визита: сервер считает длительность слота по их сумме. */
  serviceIds: number[];
  date: string;
  time: string;
};

/**
 * GET /api/appointments/check-availability с debounce и отменой предыдущего запроса.
 * Нужны врач, услуги, дата и время.
 */
export function useDebouncedAppointmentSlotAvailability(
  token: string | null | undefined,
  params: SlotAvailabilityParams,
  enabled: boolean
): SlotAvailabilityPhase {
  const [phase, setPhase] = React.useState<SlotAvailabilityPhase>("idle");
  const serviceIdsKey = params.serviceIds.join(",");

  React.useEffect(() => {
    if (!enabled || !token) {
      setPhase("idle");
      return;
    }

    const doctorId = Number(params.doctorId);
    const serviceIds = serviceIdsKey ? serviceIdsKey.split(",").map(Number) : [];
    if (!doctorId || serviceIds.length === 0 || !params.date || !params.time) {
      setPhase("idle");
      return;
    }

    const startAt = normalizeDateTimeForApi(params.date, params.time);
    if (!startAt) {
      setPhase("idle");
      return;
    }

    setPhase("pending");
    let cancelled = false;
    const ac = new AbortController();

    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setPhase("loading");
      void appointmentsFlowApi
        .checkAppointmentAvailability(
          token,
          {
            doctorId,
            serviceIds,
            date: params.date,
            time: params.time,
          },
          ac.signal
        )
        .then((res) => {
          if (cancelled) return;
          setPhase(res.available ? "free" : "busy");
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const name = err instanceof Error ? err.name : "";
          if (name === "AbortError") return;
          setPhase("error");
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [
    enabled,
    token,
    params.doctorId,
    serviceIdsKey,
    params.date,
    params.time,
  ]);

  return phase;
}
