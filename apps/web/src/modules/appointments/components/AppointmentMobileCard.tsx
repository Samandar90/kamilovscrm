import React from "react";
import type { Appointment, AppointmentStatus, Service } from "../api/appointmentsFlowApi";

const statusLabel: Record<AppointmentStatus, string> = {
  scheduled: "Запланировано",
  confirmed: "Подтверждено",
  arrived: "Пришёл",
  in_consultation: "На приёме",
  completed: "Завершено",
  cancelled: "Отменено",
  no_show: "Неявка",
};

const statusTone: Record<AppointmentStatus, string> = {
  scheduled: "border-slate-200 bg-slate-100 text-slate-700",
  confirmed: "border-slate-200 bg-slate-100 text-slate-700",
  arrived: "border-blue-200 bg-blue-50 text-blue-700",
  in_consultation: "border-amber-200 bg-amber-50 text-amber-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-rose-200 bg-rose-50 text-rose-700",
  no_show: "border-slate-200 bg-slate-100 text-slate-500",
};

type Props = {
  appointment: Appointment;
  patientName: string;
  patientPhone?: string | null;
  service: Service | undefined;
  timeLabel: string;
  isSubmitting: boolean;
  canManageAppointmentFlow: boolean;
  onAdvanceStatus: () => void;
  onOpenDetails: () => void;
};

export const AppointmentMobileCard: React.FC<Props> = ({
  appointment,
  patientName,
  patientPhone,
  service,
  timeLabel,
  isSubmitting,
  canManageAppointmentFlow,
  onAdvanceStatus,
  onOpenDetails,
}) => {
  const actionLabel =
    appointment.status === "in_consultation"
      ? "Завершить"
      : appointment.status === "scheduled" || appointment.status === "confirmed" || appointment.status === "arrived"
      ? "Начать приём"
      : "Открыть";
  const actionPrimary = actionLabel !== "Открыть";
  const canAdvance = actionPrimary && canManageAppointmentFlow && !isSubmitting;

  return (
    <li className="list-none">
      <article
        role="button"
        tabIndex={0}
        onClick={onOpenDetails}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpenDetails();
          }
        }}
        className="rounded-xl border border-slate-100 bg-white p-3.5 shadow-sm transition-transform duration-150 ease-out active:scale-[0.97]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[17px] font-semibold leading-none tabular-nums text-slate-900">{timeLabel}</p>
            <p className="mt-1 truncate text-sm font-medium text-slate-800">{patientName}</p>
          </div>
          <span
            className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusTone[appointment.status]}`}
          >
            {statusLabel[appointment.status]}
          </span>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          <p className="truncate">{service?.name ?? `Услуга #${appointment.serviceId}`}</p>
          <p className="mt-0.5 truncate text-slate-400">{patientPhone?.trim() || "Телефон не указан"}</p>
        </div>
        <div className="mt-3 flex gap-2 border-t border-slate-100 pt-2.5" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={canAdvance ? onAdvanceStatus : onOpenDetails}
            className={
              actionPrimary
                ? "inline-flex min-h-[38px] flex-1 items-center justify-center rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                : "inline-flex min-h-[38px] flex-1 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            }
            disabled={isSubmitting}
          >
            {actionLabel}
          </button>
          <button
            type="button"
            onClick={onOpenDetails}
            className="inline-flex min-h-[38px] items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Открыть
          </button>
        </div>
      </article>
    </li>
  );
};
