import React from "react";
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
  if (canUpdateAppointment && (appointment.status === "scheduled" || appointment.status === "confirmed")) {
    return (
      <button type="button" className={btnPrimary} disabled={disabled} onClick={onMarkArrived}>
        Принять
      </button>
    );
  }

  if (canUpdateAppointment && appointment.status === "arrived") {
    return (
      <button type="button" className={btnPrimary} disabled={disabled} onClick={onStartConsultation}>
        Начать приём
      </button>
    );
  }

  if (appointment.status === "in_consultation" && (canOpenDoctorWorkspace || canUpdateAppointment)) {
    return (
      <button type="button" className={btnPrimary} disabled={disabled} onClick={onCompleteConsultation}>
        Завершить приём
      </button>
    );
  }

  return null;
};
