import React from "react";
import type { Appointment, InvoiceSummary, Service } from "../api/appointmentsFlowApi";
import { coercePriceToNumber } from "../../../shared/lib/money";
import { getAllServices } from "../../../shared/lib/appointments/getAllServices";
import { formatSum } from "../../../utils/formatMoney";
import { ActionButtons, SectionCard, StatusBadge } from "../../../shared/ui";
import { buildUnifiedAppointmentActions } from "./appointmentActions";

type WorkflowStage =
  | "scheduled"
  | "arrived"
  | "in_consultation"
  | "completed"
  | "invoiced"
  | "paid";

const workflowLabelMap: Record<WorkflowStage, string> = {
  scheduled: "Запланирован",
  arrived: "Пришел",
  in_consultation: "На приеме",
  completed: "Завершен прием",
  invoiced: "Счет создан",
  paid: "Оплачено",
};

function getWorkflowStage(appointment: Appointment, invoice: InvoiceSummary | null): WorkflowStage {
  if (appointment.status === "scheduled" || appointment.status === "confirmed") return "scheduled";
  if (appointment.status === "arrived") return "arrived";
  if (appointment.status === "in_consultation") return "in_consultation";
  if (appointment.status === "completed" && !invoice) return "completed";
  if (invoice && invoice.paidAmount >= invoice.total) return "paid";
  if (invoice) return "invoiced";
  return "completed";
}

type Props = {
  appointment: Appointment;
  invoice: InvoiceSummary | null;
  patientName: string;
  doctorName: string;
  service: Service | undefined;
  timeLabel: string;
  glassPanelClass: string;
  isSubmitting: boolean;
  canManageAppointmentFlow: boolean;
  /** Счета, цены услуг и строки оплаты — только для ролей с биллингом. */
  showFinancialDetails: boolean;
  canCreateInvoice: boolean;
  onMarkArrived: () => void;
  onCompleteConsultation: () => void;
  onCreateInvoice: () => void;
  onCancelAppointment: () => void;
  onEditPrice: () => void;
  canHardDeleteAppointment: boolean;
  onDeleteAppointment: () => void;
  /** Коммерческая цена: регистратура / менеджмент (согласовано с PATCH /appointments/:id/price). */
  canEditAppointmentPrice: boolean;
  onOpenDoctorWorkspace: () => void;
  onCardClick: () => void;
};

export const AppointmentCard: React.FC<Props> = ({
  appointment,
  invoice,
  patientName,
  doctorName,
  service,
  timeLabel,
  glassPanelClass,
  isSubmitting,
  canManageAppointmentFlow,
  showFinancialDetails,
  canCreateInvoice,
  onMarkArrived,
  onCompleteConsultation,
  onCreateInvoice,
  onCancelAppointment,
  onEditPrice,
  canHardDeleteAppointment,
  onDeleteAppointment,
  canEditAppointmentPrice,
  onOpenDoctorWorkspace,
  onCardClick,
}) => {
  const statusTone =
    appointment.status === "completed"
      ? "success"
      : appointment.status === "cancelled"
        ? "danger"
        : appointment.status === "arrived"
          ? "info"
          : appointment.status === "in_consultation"
            ? "warning"
            : "neutral";
  const statusLabel =
    appointment.status === "in_consultation"
      ? "На приёме"
      : appointment.status === "completed"
        ? "Завершено"
        : appointment.status === "cancelled"
          ? "Отменено"
          : "Ожидание";
  const isCancelled = appointment.status === "cancelled";
  const isCompleted = appointment.status === "completed";
  const actionsDisabled = isSubmitting || isCancelled;
  const serviceBasePrice = service?.price ?? null;
  const appointmentPrice = appointment.price;
  const isPriceManuallyChanged =
    appointmentPrice !== null &&
    serviceBasePrice !== null &&
    Math.round(appointmentPrice) !== Math.round(coercePriceToNumber(serviceBasePrice));
  const allServices = getAllServices(appointment, {
    fallbackBase: service
      ? {
          id: service.id,
          name: service.name,
          price: appointment.price ?? service.price,
        }
      : undefined,
  });
  const unifiedActions = buildUnifiedAppointmentActions({
    appointment,
    canCreateInvoice,
    hasInvoice: Boolean(invoice),
  });
  const onUnifiedAction = (key: string) => {
    if (key === "start") {
      onMarkArrived();
      return;
    }
    if (key === "complete") {
      onCompleteConsultation();
      return;
    }
    if (key === "workspace") {
      onOpenDoctorWorkspace();
      return;
    }
    if (key === "invoice") {
      onCreateInvoice();
      return;
    }
    onCardClick();
  };

  return (
    <li className="list-none">
      <SectionCard
        role="button"
        tabIndex={0}
        onClick={onCardClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onCardClick();
          }
        }}
        className={`group ${glassPanelClass} cursor-pointer rounded-[14px] p-[14px] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_30px_-20px_rgba(15,23,42,0.28)] ${
          isCancelled ? "opacity-80 grayscale-[0.2]" : ""
        }`}
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="rounded-lg border border-[#e5e7eb] bg-[#f9fafb] px-2.5 py-1.5 text-sm font-semibold tabular-nums text-[#111827]">
              {timeLabel}
            </div>
            <StatusBadge
              tone={statusTone}
            >
              {statusLabel}
            </StatusBadge>
          </div>
          <div className="space-y-1.5 text-sm">
            <p className="truncate text-base font-semibold text-[#111827]">{patientName}</p>
            <p className="text-[#334155]">
              <span className="text-[#64748b]">Врач:</span> {doctorName}
            </p>
            <div className="text-[#334155]">
              <span className="text-[#64748b]">Услуги:</span>
              {allServices.length > 0 ? (
                <div className="mt-1 space-y-0.5">
                  {allServices.map((item) => (
                    <div key={`${item.serviceId}-${item.isBase ? "b" : "a"}`}>
                      {item.name}
                      {showFinancialDetails ? ` — ${formatSum(item.price)}` : ""}
                    </div>
                  ))}
                </div>
              ) : (
                <span> #{appointment.serviceId}</span>
              )}
            </div>
            {isPriceManuallyChanged ? (
              <p className="text-xs text-amber-700">
                <span className="rounded-md bg-amber-100 px-1.5 py-0.5">изменено вручную</span>
              </p>
            ) : null}
            {showFinancialDetails ? (
              invoice ? (
                <p className="text-xs text-[#64748b]">
                  Счёт создан{invoice.number ? ` · ${invoice.number}` : ""}
                </p>
              ) : (
                <p className="text-xs text-[#94a3b8]">Счёт ещё не выставлен</p>
              )
            ) : null}
            {isCancelled && appointment.cancelReason ? (
              <p className="text-xs text-rose-600">
                <span className="font-medium">Причина отмены:</span> {appointment.cancelReason}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-[#eef2f7] pt-3" onClick={(e) => e.stopPropagation()}>
            <span className="rounded-md border border-[#e5e7eb] bg-[#f9fafb] px-2 py-0.5 text-[11px] text-[#6b7280]">
              {workflowLabelMap[getWorkflowStage(appointment, invoice)]}
            </span>
            <ActionButtons className="ml-auto items-center">
              {unifiedActions.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  className={
                    action.tone === "primary"
                      ? "rounded-xl bg-[#22c55e] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition duration-150 ease-out hover:bg-[#16a34a] disabled:opacity-50"
                      : "rounded-xl border border-[#e5e7eb] bg-white px-4 py-2.5 text-sm font-semibold text-[#111827] shadow-sm transition duration-150 ease-out hover:bg-[#f3f4f6] disabled:opacity-50"
                  }
                  disabled={actionsDisabled || (!canManageAppointmentFlow && action.key !== "open")}
                  onClick={() => onUnifiedAction(action.key)}
                >
                  {action.label}
                </button>
              ))}
              {canManageAppointmentFlow && !isCompleted && !isCancelled ? (
                <button
                  type="button"
                  className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 shadow-sm transition hover:bg-rose-100"
                  disabled={isSubmitting}
                  onClick={onCancelAppointment}
                >
                  Отменить запись
                </button>
              ) : null}
              {canManageAppointmentFlow && canEditAppointmentPrice && !isCompleted && !isCancelled ? (
                <button
                  type="button"
                  className="rounded-lg border border-[#e5e7eb] bg-white px-3 py-1.5 text-xs font-medium text-[#111827] shadow-sm transition hover:bg-[#f3f4f6]"
                  disabled={isSubmitting}
                  onClick={onEditPrice}
                >
                  Изменить цену
                </button>
              ) : null}
              {canHardDeleteAppointment ? (
                <button
                  type="button"
                  className="rounded-lg border border-rose-300 bg-rose-100 px-3 py-1.5 text-xs font-medium text-rose-800 shadow-sm transition hover:bg-rose-200"
                  disabled={isSubmitting}
                  onClick={onDeleteAppointment}
                >
                  Удалить
                </button>
              ) : null}
            </ActionButtons>
          </div>
        </div>
      </SectionCard>
    </li>
  );
};
