import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Calendar, Printer, Stethoscope, User } from "lucide-react";
import { useAuth } from "../../../auth/AuthContext";
import { hasPermission } from "../../../auth/permissions";
import { canWriteBilling } from "../../../auth/roleGroups";
import { formatDateTimeRu } from "../../../utils/formatDateTime";
import { formatSum } from "../../../utils/formatMoney";
import {
  cashDeskApi,
  type InvoiceDetail,
  type InvoiceStatus,
  type Payment,
  type PaymentMethod,
} from "../api/cashDeskApi";
import { requestJson } from "../../../api/http";
import { PaymentModal } from "../components/PaymentModal";
import { InvoiceStatusBadge } from "../components/invoice/InvoiceStatusBadge";
import { lineItemDisplayLabel } from "../components/invoice/lineItemLabel";
import { buildReceiptHTML } from "../../../shared/receipt/receiptTemplate";
import { printReceipt as browserPrintReceipt } from "../../../shared/receipt/printReceipt";
import kamilovsClinicLogo from "../../../assets/kamilovs-clinic-logo.png";

type PatientRow = { id: number; fullName: string; phone?: string | null };
type AppointmentRow = {
  id: number;
  doctorId: number;
  startAt: string;
};
type DoctorRow = { id: number; name: string };

const cardClass =
  "invoice-card rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.04)]";

const btnGhost =
  "inline-flex h-10 items-center gap-2 rounded-2xl border border-[#e2e8f0] bg-white px-4 text-sm font-medium text-[#334155] shadow-sm " +
  "transition-all duration-150 ease-out hover:border-[#cbd5e1] hover:bg-[#f8fafc] hover:opacity-95 active:scale-[0.97] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22c55e]/25 disabled:pointer-events-none disabled:opacity-45";

const btnPrimary =
  "inline-flex h-10 items-center justify-center rounded-2xl bg-[#16a34a] px-5 text-sm font-medium text-white shadow-sm " +
  "transition-all duration-150 ease-out hover:bg-[#15803d] hover:opacity-95 active:scale-[0.97] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22c55e]/35 disabled:pointer-events-none disabled:opacity-45";

const moneyGreen = "font-semibold tabular-nums text-[#16a34a]";

const DetailSkeleton: React.FC = () => (
  <div className="space-y-6 animate-pulse">
    <div className="h-8 w-48 rounded-lg bg-slate-200" />
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-24 rounded-2xl border border-[#e5e7eb] bg-white" />
      ))}
    </div>
    <div className="h-48 rounded-2xl border border-[#e5e7eb] bg-white" />
    <div className="h-56 rounded-2xl border border-[#e5e7eb] bg-white" />
  </div>
);

export const InvoiceDetailsPage: React.FC = () => {
  const { id: idParam } = useParams();
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const canPay = canWriteBilling(user?.role);
  const canLoadDoctorProfile = !!user?.role && hasPermission(user.role, "doctors", "read");

  const invoiceId = idParam ? Number(idParam) : NaN;

  const [invoice, setInvoice] = React.useState<InvoiceDetail | null>(null);
  const [patientName, setPatientName] = React.useState<string>("");
  const [patientPhone, setPatientPhone] = React.useState<string>("");
  const [doctorName, setDoctorName] = React.useState<string>("");
  const [appointmentStartLabel, setAppointmentStartLabel] = React.useState<string>("");

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = React.useState(false);
  const [paymentMethodPreset, setPaymentMethodPreset] = React.useState<PaymentMethod>("cash");
  const [paymentSuccess, setPaymentSuccess] = React.useState<string | null>(null);

  const reloadInvoiceOnly = React.useCallback(async (): Promise<InvoiceDetail | null> => {
    if (!token || !Number.isFinite(invoiceId) || invoiceId <= 0) return null;
    const inv = await cashDeskApi.getInvoiceById(token, invoiceId);
    setInvoice(inv);
    return inv;
  }, [token, invoiceId]);

  React.useEffect(() => {
    if (!token || !Number.isFinite(invoiceId) || invoiceId <= 0) {
      setLoading(false);
      setError("Некорректный номер счёта");
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      setPatientName("");
      setPatientPhone("");
      setDoctorName("");
      setAppointmentStartLabel("");
      try {
        const inv = await cashDeskApi.getInvoiceById(token, invoiceId);
        if (cancelled) return;
        setInvoice(inv);

        const patientP = requestJson<PatientRow>(`/api/patients/${inv.patientId}`, { token })
          .then((p) => {
            if (!cancelled) {
              setPatientName(p.fullName);
              setPatientPhone(p.phone?.trim() ?? "");
            }
          })
          .catch(() => {
            if (!cancelled) {
              setPatientName(`#${inv.patientId}`);
              setPatientPhone("");
            }
          });

        let apptP: Promise<void> = Promise.resolve();
        if (inv.appointmentId != null) {
          apptP = requestJson<AppointmentRow>(`/api/appointments/${inv.appointmentId}`, { token })
            .then(async (appt) => {
              if (cancelled) return;
              setAppointmentStartLabel(formatDateTimeRu(appt.startAt));
              if (canLoadDoctorProfile) {
                try {
                  const doc = await requestJson<DoctorRow>(`/api/doctors/${appt.doctorId}`, { token });
                  if (!cancelled) setDoctorName(doc.name);
                } catch {
                  if (!cancelled) setDoctorName(`Врач #${appt.doctorId}`);
                }
              } else if (!cancelled) {
                setDoctorName(`Врач #${appt.doctorId}`);
              }
            })
            .catch(() => {
              if (!cancelled) {
                setAppointmentStartLabel("—");
                setDoctorName("—");
              }
            });
        } else {
          setAppointmentStartLabel("—");
          setDoctorName("—");
        }

        await Promise.all([patientP, apptP]);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Не удалось загрузить счёт");
          setInvoice(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [token, invoiceId, canLoadDoctorProfile]);

  const remaining =
    invoice != null ? Math.max(0, Math.round((invoice.total - invoice.paidAmount) * 100) / 100) : 0;
  const effectiveStatus: InvoiceStatus | null =
    invoice == null
      ? null
      : remaining <= 1e-6 && invoice.status !== "cancelled" && invoice.status !== "refunded"
        ? "paid"
        : invoice.status;

  const showPayButton =
    canPay && invoice != null && remaining > 0 && effectiveStatus !== "cancelled" && effectiveStatus !== "refunded";

  const isFullyPaid = invoice != null && remaining <= 1e-6 && invoice.status === "paid";

  const paymentMethodLabel = (method: "cash" | "card"): string => (method === "cash" ? "Наличные" : "Терминал");

  const printReceipt = React.useCallback(
    (targetInvoice: InvoiceDetail, payment: Payment) => {
      const html = buildReceiptHTML({
        clinicName: "KAMILOVS CLINIC",
        logoUrl: kamilovsClinicLogo,
        patient: patientName || `Пациент #${targetInvoice.patientId}`,
        doctor: doctorName || null,
        invoiceId: targetInvoice.number,
        date: formatDateTimeRu(payment.createdAt),
        paymentMethod: paymentMethodLabel(payment.method),
        total: targetInvoice.total,
        paid: payment.amount,
        items: targetInvoice.items.map((item) => ({
          name: lineItemDisplayLabel(item.description),
          price: item.lineTotal,
        })),
      });
      browserPrintReceipt(html);
    },
    [doctorName, patientName]
  );

  const printInvoiceReceipt = async () => {
    if (!invoice || !token) return;
    let latestPayment: Payment | null = null;
    try {
      const payments = await requestJson<Payment[]>(
        `/api/payments?invoiceId=${encodeURIComponent(String(invoice.id))}`,
        { token }
      );
      latestPayment = payments
        .filter((payment) => !payment.deletedAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    } catch {
      latestPayment = null;
    }

    if (!latestPayment) {
      setError("Не найден платеж для печати квитанции.");
      return;
    }

    printReceipt(invoice, latestPayment);
  };

  const openPaymentModalWithMethod = (method: PaymentMethod) => {
    setPaymentMethodPreset(method);
    setPaymentSuccess(null);
    setPaymentModalOpen(true);
  };

  React.useEffect(() => {
    if (!paymentSuccess) return;
    const timer = window.setTimeout(() => setPaymentSuccess(null), 2200);
    return () => window.clearTimeout(timer);
  }, [paymentSuccess]);

  return (
    <div className="min-h-full overflow-x-hidden bg-[#f8fafc] pb-[110px] text-[#334155] max-md:[&_button]:min-h-[44px] md:pb-0">
      <div className="mx-auto max-w-5xl space-y-8 px-5 py-8 md:px-8">
        <button type="button" onClick={() => navigate("/billing/invoices")} className={`${btnGhost} invoice-enter`}>
          <ArrowLeft className="h-4 w-4 text-[#64748b]" strokeWidth={1.75} />
          Назад к счетам
        </button>

        {loading ? (
          <DetailSkeleton />
        ) : error ? (
          <div
            className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
            role="alert"
          >
            {error}
          </div>
        ) : !invoice ? (
          <p className="text-sm text-[#64748b]">Счёт не найден.</p>
        ) : (
          <>
            <section className="space-y-4 md:hidden">
              <div className={`${cardClass} p-4`}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Пациент</p>
                <p className="mt-1 text-base font-semibold text-slate-900">
                  {patientName || `Пациент #${invoice.patientId}`}
                </p>
                {patientPhone ? <p className="mt-1 text-sm text-slate-500">{patientPhone}</p> : null}
              </div>

              <div className={`${cardClass} p-4`}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Услуги</p>
                <ul className="mt-2 space-y-2">
                  {invoice.items.map((row) => (
                    <li key={row.id} className="flex items-start justify-between gap-3 text-sm">
                      <span className="text-slate-700">{lineItemDisplayLabel(row.description)}</span>
                      <span className="shrink-0 font-medium tabular-nums text-slate-900">
                        {formatSum(row.lineTotal)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className={`${cardClass} p-4`}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Итого</p>
                <p className="mt-1 text-3xl font-bold tabular-nums text-emerald-600">{formatSum(remaining)}</p>
                <p className="mt-1 text-xs text-slate-500">Остаток к оплате</p>
              </div>

              {showPayButton ? (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => openPaymentModalWithMethod("cash")}
                    className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm"
                  >
                    Наличные
                  </button>
                  <button
                    type="button"
                    onClick={() => openPaymentModalWithMethod("card")}
                    className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm"
                  >
                    Терминал
                  </button>
                </div>
              ) : null}
            </section>

            <header className="invoice-enter invoice-enter-delay-1 hidden space-y-6 border-b border-[#e5e7eb] pb-8 md:block">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0 space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-2xl font-semibold tracking-tight text-[#0f172a] md:text-3xl">
                      Счёт {invoice.number}
                    </h1>
                  <InvoiceStatusBadge status={effectiveStatus ?? invoice.status} />
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-[#64748b]">
                    <span>
                      Создан{" "}
                      <span className="text-[#334155]">{formatDateTimeRu(invoice.createdAt)}</span>
                    </span>
                    <span className="text-[#cbd5e1]">·</span>
                    <span className="text-[#334155]">
                      {patientName || `Пациент #${invoice.patientId}`}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {showPayButton ? (
                    <button
                      type="button"
                      onClick={() => openPaymentModalWithMethod("cash")}
                      className={btnPrimary}
                    >
                      Принять оплату
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={btnGhost}
                    onClick={() => void printInvoiceReceipt()}
                  >
                    <Printer className="h-4 w-4" strokeWidth={1.75} />
                    Печать
                  </button>
                  <button type="button" onClick={() => navigate("/billing/invoices")} className={btnGhost}>
                    К списку
                  </button>
                </div>
              </div>

              {isFullyPaid && (
                <p className="text-xs text-[#64748b]">
                  Счёт полностью оплачен. При необходимости используйте кассу для возвратов по операциям.
                </p>
              )}
              {paymentSuccess ? (
                <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 transition-opacity duration-300">
                  {paymentSuccess}
                </p>
              ) : null}
            </header>

            {invoice && token ? (
              <PaymentModal
                open={paymentModalOpen}
                onClose={() => setPaymentModalOpen(false)}
                token={token}
                invoiceId={invoice.id}
                maxAmount={remaining}
                invoiceStatus={effectiveStatus ?? invoice.status}
                initialMethod={paymentMethodPreset}
                onPaid={async (payment) => {
                  const refreshedInvoice = await reloadInvoiceOnly();
                  if (!refreshedInvoice) return;
                  setPaymentSuccess("Оплата успешно проведена");
                  printReceipt(refreshedInvoice, payment);
                }}
              />
            ) : null}

            <section className="invoice-enter invoice-enter-delay-2 hidden gap-3 sm:grid-cols-2 lg:grid-cols-4 md:grid">
              {[
                {
                  label: "Пациент",
                  value: patientName || `Пациент #${invoice.patientId}`,
                  icon: User,
                },
                {
                  label: "Врач",
                  value: doctorName || "—",
                  icon: Stethoscope,
                },
                {
                  label: "Дата записи",
                  value: appointmentStartLabel,
                  icon: Calendar,
                },
                {
                  label: "Статус",
                  value: null,
                  icon: null,
                  badge: invoice.status,
                },
              ].map((cell, idx) => (
                <div key={idx} className={`${cardClass} p-4`}>
                  <div className="flex items-start gap-3">
                    {cell.icon ? (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#e5e7eb] bg-[#f8fafc]">
                        <cell.icon className="h-4 w-4 text-[#64748b]" strokeWidth={1.5} />
                      </div>
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-[#64748b]">
                        {cell.label}
                      </p>
                      {cell.badge != null ? (
                        <div className="mt-2">
                          <InvoiceStatusBadge
                            status={(effectiveStatus ?? (cell.badge as InvoiceStatus)) as InvoiceStatus}
                          />
                        </div>
                      ) : (
                        <p className="mt-1.5 text-sm font-medium leading-snug text-[#0f172a]">{cell.value}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </section>

            <section className={`${cardClass} invoice-enter invoice-enter-delay-2 hidden md:block`}>
              <div className="border-b border-[#e5e7eb] px-5 py-4">
                <h2 className="text-sm font-semibold tracking-tight text-[#0f172a]">Позиции</h2>
                <p className="mt-0.5 text-xs text-[#64748b]">Услуги и суммы по строкам счёта</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] bg-white text-sm">
                  <thead>
                    <tr className="border-b border-[#e5e7eb] bg-[#f8fafc]">
                      <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[#64748b]">
                        Услуга
                      </th>
                      <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[#64748b]">
                        Кол-во
                      </th>
                      <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[#64748b]">
                        Цена
                      </th>
                      <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[#0f172a]">
                        Сумма
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e5e7eb]">
                    {invoice.items.map((row) => (
                      <tr
                        key={row.id}
                        className="bg-white transition-[background-color] duration-150 ease-out hover:bg-[#f1f5f9]"
                      >
                        <td className="max-w-md px-5 py-3.5 font-medium leading-snug text-[#0f172a]">
                          {lineItemDisplayLabel(row.description)}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 text-right tabular-nums text-[#64748b]">
                          {row.quantity}
                        </td>
                        <td className={`whitespace-nowrap px-5 py-3.5 text-right tabular-nums ${moneyGreen}`}>
                          {formatSum(row.unitPrice)}
                        </td>
                        <td className={`whitespace-nowrap px-5 py-3.5 text-right text-base ${moneyGreen}`}>
                          {formatSum(row.lineTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className={`${cardClass} invoice-totals-fade invoice-enter-delay-3 hidden overflow-hidden md:block`}>
              <div className="border-b border-[#e5e7eb] px-5 py-4">
                <h2 className="text-sm font-semibold tracking-tight text-[#0f172a]">Итоги</h2>
                <p className="mt-0.5 text-xs text-[#64748b]">Сводка по счёту</p>
              </div>
              <div className="p-5 md:p-6">
                <div className="ml-auto max-w-md space-y-0">
                  {(
                    [
                      ["Сумма", formatSum(invoice.subtotal), false],
                      ["Скидка", formatSum(invoice.discount), false],
                      ["К оплате", formatSum(invoice.total), true],
                      ["Оплачено", formatSum(invoice.paidAmount), true],
                    ] as const
                  ).map(([label, value, emphasize]) => (
                    <div
                      key={label}
                      className={`flex justify-between gap-6 border-b border-[#e5e7eb] py-3 text-sm last:border-0 ${
                        emphasize ? "pb-4 pt-1" : ""
                      }`}
                    >
                      <dt className={emphasize ? "font-medium text-[#0f172a]" : "text-[#64748b]"}>{label}</dt>
                      <dd
                        className={`tabular-nums ${
                          emphasize ? `text-lg font-semibold ${moneyGreen}` : "text-[#334155]"
                        }`}
                      >
                        {value}
                      </dd>
                    </div>
                  ))}
                  <div
                    className={`mt-2 flex justify-between gap-6 rounded-2xl border px-4 py-3 ${
                      remaining <= 1e-6
                        ? "border-emerald-200 bg-[#dcfce7]/50"
                        : "border-amber-200 bg-[#fef9c3]/40"
                    }`}
                  >
                    <dt className="text-sm font-medium text-[#334155]">Остаток</dt>
                    <dd className={`text-lg ${moneyGreen}`}>{formatSum(remaining)}</dd>
                  </div>
                </div>
              </div>
            </section>

            <div className="invoice-enter invoice-enter-delay-3 hidden flex-wrap items-center justify-between gap-3 border-t border-[#e5e7eb] pt-6 md:flex">
              <p className="text-xs text-[#94a3b8]">
                Внутренний документ · не является фискальным чеком
              </p>
              <div className="flex flex-wrap gap-2">
                {showPayButton ? (
                  <button
                    type="button"
                    onClick={() => openPaymentModalWithMethod("cash")}
                    className={btnPrimary}
                  >
                    Принять оплату
                  </button>
                ) : null}
                <button type="button" onClick={() => navigate("/billing/invoices")} className={btnGhost}>
                  Назад к списку
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
