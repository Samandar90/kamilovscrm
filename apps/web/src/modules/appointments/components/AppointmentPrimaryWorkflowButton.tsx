import React from "react";
import { useTranslation } from "react-i18next";
import type { Appointment } from "../api/appointmentsFlowApi";

type Props = {
  appointment: Appointment;
  disabled?: boolean;
  canUpdateAppointment: boolean;
  canOpenDoctorWorkspace: boolean;
  onMarkArrived: () => void;
  onStartConsultation: () => void;
  onCompleteConsultation: () => void;
  onOpenDoctorWorkspace: () => void;
};

const btnPrimary =
  "min-w-[140px] rounded-xl bg-[#22c55e] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:scale-[1.03] hover:bg-[#16a34a] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100";

const btnNeutral =
  "min-w-[140px] rounded-xl border border-[#e5e7eb] bg-white px-4 py-2.5 text-sm font-semibold text-[#111827] shadow-sm transition hover:scale-[1.03] hover:bg-[#f3f4f6] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100";

/**
 * Single primary workflow action per card (reception / operator / doctor).
 */
export const AppointmentPrimaryWorkflowButton: React.FC<Props> = ({
  appointment,
  disabled = false,
  canUpdateAppointment,
  canOpenDoctorWorkspace,
  onMarkArrived,
  onStartConsultation,
  onCompleteConsultation,
  onOpenDoctorWorkspace,
}) => {
  const { t } = useTranslation();
  const status =
    (appointment.status as string) === "in_progress" ? "in_consultation" : appointment.status;

  if (canOpenDoctorWorkspace && (status === "completed" || status === "in_consultation")) {
    return (
      <button type="button" className={btnNeutral} disabled={disabled} onClick={onOpenDoctorWorkspace}>
        {t("appointments.doctorWorkspace")}
      </button>
    );
  }

  if (canUpdateAppointment && (status === "scheduled" || status === "confirmed")) {
    return (
      <button type="button" className={btnPrimary} disabled={disabled} onClick={onMarkArrived}>
        {t("appointments.accept")}
      </button>
    );
  }

  if (canUpdateAppointment && status === "arrived") {
    return (
      <button type="button" className={btnPrimary} disabled={disabled} onClick={onStartConsultation}>
        {t("appointments.startConsultation")}
      </button>
    );
  }

  if (status === "in_consultation" && canUpdateAppointment && !canOpenDoctorWorkspace) {
    return (
      <button type="button" className={btnPrimary} disabled={disabled} onClick={onCompleteConsultation}>
        {t("appointments.completeConsultation")}
      </button>
    );
  }

  return null;
};
