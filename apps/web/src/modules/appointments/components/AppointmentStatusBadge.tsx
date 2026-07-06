import React from "react";
import { useTranslation } from "react-i18next";
import type { AppointmentStatus } from "../api/appointmentsFlowApi";

const variantClass: Record<AppointmentStatus, string> = {
  scheduled: "border-[#e5e7eb] bg-[#f9fafb] text-[#111827]",
  confirmed: "border-[#e5e7eb] bg-[#f9fafb] text-[#111827]",
  arrived: "border-[#e5e7eb] bg-[#f9fafb] text-[#111827]",
  in_consultation: "border-[#e5e7eb] bg-[#f9fafb] text-[#111827]",
  completed: "border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]",
  cancelled: "border-[#fecaca] bg-[#fef2f2] text-[#991b1b]",
  no_show: "border-[#e5e7eb] bg-[#f3f4f6] text-[#6b7280]",
};

type AppointmentStatusBadgeProps = {
  status: AppointmentStatus;
};

export const AppointmentStatusBadge: React.FC<AppointmentStatusBadgeProps> = ({
  status,
}) => {
  const { t } = useTranslation();

  const labelRu: Record<AppointmentStatus, string> = {
    scheduled: t("appointments.statusLabels.scheduled"),
    confirmed: t("appointments.statusLabels.confirmed"),
    arrived: t("appointments.statusLabels.arrived"),
    in_consultation: t("appointments.statusLabels.in_consultation"),
    completed: t("appointments.statusLabels.completed"),
    cancelled: t("appointments.statusLabels.cancelled"),
    no_show: t("appointments.statusLabels.no_show"),
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium shadow-sm transition-transform duration-200 ${variantClass[status]}`}
    >
      {labelRu[status]}
    </span>
  );
};
