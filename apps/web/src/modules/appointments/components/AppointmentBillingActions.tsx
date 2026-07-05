import React from "react";
import { useTranslation } from "react-i18next";
import type { Appointment } from "../api/appointmentsFlowApi";

type Props = {
  appointment: Appointment;
  /** Есть ли счёт по этой записи — кнопка «Счёт» только если ещё нет. */
  hasInvoice: boolean;
  disabled?: boolean;
  canCreateInvoice: boolean;
  onCreateInvoice: () => void;
};

const linkBtn =
  "rounded-lg border border-[#e5e7eb] bg-white px-3 py-1.5 text-xs font-medium text-[#111827] shadow-sm transition hover:bg-[#f3f4f6] hover:scale-[1.03] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50";

export const AppointmentBillingActions: React.FC<Props> = ({
  appointment,
  hasInvoice,
  disabled = false,
  canCreateInvoice,
  onCreateInvoice,
}) => {
  const { t } = useTranslation("billing");
  if (!canCreateInvoice) return null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {canCreateInvoice && appointment.status === "completed" && !hasInvoice && (
        <button type="button" className={linkBtn} disabled={disabled} onClick={onCreateInvoice}>
          {t("invoice")}
        </button>
      )}
    </div>
  );
};
