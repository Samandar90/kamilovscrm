import type { ThreadMessage } from "../types";

export type AiRuleAction = {
  id: string;
  label: string;
  tooltip: string;
  path: string;
};

function messageText(m: Pick<ThreadMessage, "text" | "streamText">): string {
  return (m.streamText ?? m.text ?? "").trim();
}

/**
 * Rule-based действия CRM под ответом AI (только навигация, без мутаций).
 */
export function getActionsForMessage(
  message: Pick<ThreadMessage, "text" | "streamText">,
  t?: (key: string) => string
): AiRuleAction[] {
  const raw = messageText(message).toLowerCase();
  if (!raw) return [];

  const seen = new Set<string>();
  const out: AiRuleAction[] = [];

  const push = (a: AiRuleAction) => {
    if (seen.has(a.id)) return;
    seen.add(a.id);
    out.push(a);
  };

  const tr = (key: string, fallback: string) => t?.(key) ?? fallback;

  if (/выручк|доход|revenue|оборот|аналитик|отчёт|отчет/i.test(raw)) {
    push({
      id: "open-reports",
      label: tr("aiActions.openReports", "Открыть отчёты"),
      tooltip: tr("aiActions.openReportsTooltip", "Перейти в раздел отчётов"),
      path: "/reports",
    });
    push({
      id: "by-doctors",
      label: tr("aiActions.showDoctors", "Показать врачей"),
      tooltip: tr("aiActions.showDoctorsTooltip", "Список врачей и показатели"),
      path: "/doctors",
    });
  }

  if (/неоплачен|не\s+оплачен|задолжен|дебитор|просрочен.*сч|счет.*неоплачен|счета.*неоплачен|долг/i.test(raw)) {
    push({
      id: "open-invoices",
      label: tr("aiActions.openInvoices", "Открыть счета"),
      tooltip: tr("aiActions.openInvoicesTooltip", "Счета и статусы оплат"),
      path: "/billing/invoices",
    });
    push({
      id: "take-payment",
      label: tr("aiActions.takePayment", "Принять оплату"),
      tooltip: tr("aiActions.takePaymentTooltip", "Касса — приём платежей"),
      path: "/billing/cash-desk",
    });
    push({
      id: "patients-debt",
      label: tr("aiActions.patientsDebt", "Пациенты с долгами"),
      tooltip: tr("aiActions.patientsDebtTooltip", "Список пациентов"),
      path: "/patients",
    });
  }

  if (/загрузк|низк|слот|окн|расписан|запис(и|ей|ь)|приём|прием/i.test(raw)) {
    push({
      id: "open-appointments",
      label: tr("aiActions.openAppointments", "Открыть записи"),
      tooltip: tr("aiActions.openAppointmentsTooltip", "Календарь записей"),
      path: "/appointments",
    });
    push({
      id: "open-doctors-load",
      label: tr("aiActions.showDoctorsLoad", "Показать врачей"),
      tooltip: tr("aiActions.showDoctorsLoadTooltip", "Нагрузка и справочник"),
      path: "/doctors",
    });
  }

  if (/\bврач(и|а|ей|ом|ам)?\b|доктор|специалист|перегруж|нагрузк/i.test(raw)) {
    push({
      id: "open-doctors",
      label: tr("aiActions.openDoctors", "Открыть врачей"),
      tooltip: tr("aiActions.openDoctorsTooltip", "Справочник врачей"),
      path: "/doctors",
    });
    push({
      id: "doctor-appointments",
      label: tr("aiActions.doctorAppointments", "Записи по врачам"),
      tooltip: tr("aiActions.doctorAppointmentsTooltip", "Календарь"),
      path: "/appointments",
    });
  }

  if (/пациент|клиент.*клиник|запись\s+на\s+при/i.test(raw)) {
    push({
      id: "add-patient",
      label: tr("aiActions.addPatient", "Добавить пациента"),
      tooltip: tr("aiActions.addPatientTooltip", "Раздел пациентов — создайте карточку"),
      path: "/patients",
    });
    push({
      id: "open-patients",
      label: tr("aiActions.openPatients", "Открыть пациентов"),
      tooltip: tr("aiActions.openPatientsTooltip", "Список пациентов"),
      path: "/patients",
    });
  }

  return out.slice(0, 5);
}
