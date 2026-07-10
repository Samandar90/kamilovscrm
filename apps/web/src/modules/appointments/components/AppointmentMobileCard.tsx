import React from "react";
import { useTranslation } from "react-i18next";
import { Phone } from "lucide-react";
import type { Appointment, AppointmentStatus, Service } from "../api/appointmentsFlowApi";
import { buildUnifiedAppointmentActions } from "./appointmentActions";

const getStatusLabel = (status: AppointmentStatus, t: any): string => {
  const labels: Record<AppointmentStatus, string> = {
    scheduled: t("appointments.statusScheduled"),
    confirmed: t("appointments.statusConfirmed"),
    arrived: t("appointments.statusArrived"),
    in_consultation: t("appointments.statusInConsultation"),
    completed: t("appointments.statusCompleted"),
    cancelled: t("appointments.statusCancelled"),
    no_show: t("appointments.statusNoShow"),
  };
  return labels[status];
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
  canCreateInvoice: boolean;
  hasInvoice: boolean;
  onStart: () => void;
  onComplete: () => void;
  onOpenWorkspace: () => void;
  onCreateInvoice: () => void;
  onOpenDetails: () => void;
  showCancelButton?: boolean;
  onCancelAppointment?: () => void;
  onCopyPatientPhone?: (phone: string) => void;
};

export const AppointmentMobileCard: React.FC<Props> = ({
  appointment,
  patientName,
  patientPhone,
  service,
  timeLabel,
  isSubmitting,
  canManageAppointmentFlow,
  canCreateInvoice,
  hasInvoice,
  onStart,
  onComplete,
  onOpenWorkspace,
  onCreateInvoice,
  onOpenDetails,
  showCancelButton = false,
  onCancelAppointment,
  onCopyPatientPhone,
}) => {
  const { t } = useTranslation();
  const actions = buildUnifiedAppointmentActions({
    appointment,
    canCreateInvoice,
    hasInvoice,
    t,
  });
  const mapActionClick = (key: string) => {
    if (key === "start") return onStart;
    if (key === "complete") return onComplete;
    if (key === "workspace") return onOpenWorkspace;
    if (key === "invoice") return onCreateInvoice;
    return onOpenDetails;
  };

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
            <div className="mt-1 flex min-w-0 items-center gap-1">
              <p className="min-w-0 truncate text-sm font-medium text-slate-800">{patientName}</p>
              {patientPhone?.trim() && onCopyPatientPhone ? (
                <button
                  type="button"
                  title={t("appointments.copyPhone")}
                  aria-label={t("appointments.copyPhone")}
                  disabled={isSubmitting}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopyPatientPhone(patientPhone.trim());
                  }}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 active:scale-95"
                >
                  <Phone className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              ) : null}
            </div>
          </div>
          <span
            className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusTone[appointment.status]}`}
          >
            {getStatusLabel(appointment.status, t)}
          </span>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          <p className="truncate">{service?.name ?? `${t("appointments.service")} #${appointment.serviceId}`}</p>
          <p className="mt-0.5 truncate text-slate-400">{patientPhone?.trim() || t("appointments.phoneNotProvided")}</p>
        </div>
        <div className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-2.5" onClick={(e) => e.stopPropagation()}>
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              onClick={mapActionClick(action.key)}
              className={
                action.tone === "primary"
                  ? "inline-flex min-h-[40px] w-full items-center justify-center rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                  : "inline-flex min-h-[40px] w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              }
              disabled={isSubmitting || (!canManageAppointmentFlow && action.key !== "open")}
            >
              {action.label}
            </button>
          ))}
          {showCancelButton && onCancelAppointment ? (
            <button
              type="button"
              onClick={onCancelAppointment}
              disabled={isSubmitting}
              className="inline-flex min-h-[40px] w-full items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-3 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-50"
            >
              {t("appointments.cancelAppointment")}
            </button>
          ) : null}
        </div>
      </article>
    </li>
  );
};
