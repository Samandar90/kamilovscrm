import React from "react";
import { ArrowLeft, Printer } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../../auth/AuthContext";
import { formatDateTimeRu } from "../../../utils/formatDateTime";
import { formatSum } from "../../../utils/formatMoney";
import { buildReceiptHTML } from "../../../shared/receipt/receiptTemplate";
import { resolveReceiptClinicName } from "../../../shared/receipt/resolveReceiptClinicName";
import { printReceipt } from "../../../shared/receipt/printReceipt";
import {
  cashDeskApi,
  type CashRegisterEntry,
  type CashRegisterShift,
  type InvoiceSummary,
  type PaymentMethod,
} from "../api/cashDeskApi";
import { useClinic } from "../../../hooks/useClinic";

const cardBase =
  "rounded-2xl border border-[#eef2f7] bg-white shadow-[0_6px_24px_rgba(15,23,42,0.04)]";

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Наличные",
  card: "Терминал",
};

const ENTRY_TYPE_LABEL: Record<CashRegisterEntry["type"], string> = {
  payment: "Оплата",
  refund: "Возврат",
  manual_in: "Внесение",
  manual_out: "Изъятие",
};

const signedAmount = (e: CashRegisterEntry): number =>
  e.type === "refund" || e.type === "manual_out" ? -e.amount : e.amount;

export const CashShiftPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { token } = useAuth();
  const { clinic } = useClinic();

  const [shift, setShift] = React.useState<CashRegisterShift | null>(null);
  const [entries, setEntries] = React.useState<CashRegisterEntry[]>([]);
  const [invoices, setInvoices] = React.useState<Record<number, InvoiceSummary>>({});
  const [patientsMap, setPatientsMap] = React.useState<Record<number, string>>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [clinicMetaName, setClinicMetaName] = React.useState<string | null>(null);

  React.useEffect(() => {
    const shiftId = Number(id);
    if (!token || !Number.isInteger(shiftId) || shiftId <= 0) {
      setError("Некорректный номер смены");
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [shiftRow, entriesRows, invoiceRows, patientRows, meta] = await Promise.all([
          cashDeskApi.getShiftById(token, shiftId),
          cashDeskApi.listEntries(token, { shiftId }),
          cashDeskApi.listInvoices(token),
          cashDeskApi.listPatients(token),
          cashDeskApi.getClinicMeta(token).catch(() => null),
        ]);
        setClinicMetaName(meta?.clinicName?.trim() || null);
        setShift(shiftRow);
        setEntries(entriesRows);
        setInvoices(Object.fromEntries(invoiceRows.map((inv) => [inv.id, inv])));
        setPatientsMap(Object.fromEntries(patientRows.map((p) => [p.id, p.fullName])));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить смену");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [id, token]);

  const totals = React.useMemo(() => {
    let cash = 0;
    let card = 0;
    let inflow = 0;
    let outflow = 0;
    for (const e of entries) {
      if (e.type === "payment" || e.type === "manual_in") {
        inflow += e.amount;
        if (e.method === "cash") cash += e.amount;
        else card += e.amount;
      } else {
        outflow += e.amount;
      }
    }
    const total = inflow - outflow;
    const opening = shift?.openingBalance ?? 0;
    return { cash, card, inflow, outflow, total, closing: opening + total };
  }, [entries, shift?.openingBalance]);

  const patientLabel = (e: CashRegisterEntry): string => {
    if (e.patientId != null) return patientsMap[e.patientId] ?? `Пациент #${e.patientId}`;
    if (e.invoiceId != null) {
      const inv = invoices[e.invoiceId];
      if (inv) return patientsMap[inv.patientId] ?? `Пациент #${inv.patientId}`;
    }
    return "—";
  };

  const printShift = () => {
    if (!shift) return;
    const html = buildReceiptHTML({
      clinicName: resolveReceiptClinicName(undefined, clinicMetaName),
      logoUrl: clinic.logoUrl,
      patient: "Смена кассы",
      doctor: null,
      invoiceId: `SHIFT-${shift.id}`,
      date: formatDateTimeRu(shift.closedAt ?? shift.openedAt),
      paymentMethod: "Сводный отчёт",
      total: totals.closing,
      paid: totals.inflow,
      items: entries.map((entry) => ({
        name: `${ENTRY_TYPE_LABEL[entry.type]} · ${patientLabel(entry)}`,
        price: Math.abs(signedAmount(entry)),
      })),
    });
    printReceipt(html);
  };

  return (
    <div className="mx-auto min-h-full max-w-[1400px] space-y-5 bg-[#f6f8fb] p-5 text-[#334155] md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate("/billing/cash-desk")}
          className="inline-flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-[#f1f5f9] px-4 py-2 text-sm font-medium text-[#334155] hover:bg-[#e2e8f0]"
        >
          <ArrowLeft className="h-4 w-4" />
          Назад
        </button>
        <button
          type="button"
          onClick={printShift}
          className="inline-flex items-center gap-2 rounded-xl bg-[#22c55e] px-4 py-2 text-sm font-medium text-white hover:bg-[#16a34a]"
        >
          <Printer className="h-4 w-4" />
          Печать смены
        </button>
      </div>

      {loading ? (
        <div className={`${cardBase} p-6 text-sm text-[#64748b]`}>Загрузка...</div>
      ) : error || !shift ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error ?? "Смена не найдена"}
        </div>
      ) : (
        <>
          <section className={`${cardBase} p-5`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold text-[#0f172a]">Смена #{shift.id}</h1>
                <p className="mt-1 text-sm text-[#64748b]">
                  Открыта: {formatDateTimeRu(shift.openedAt)}
                </p>
                <p className="mt-0.5 text-sm text-[#64748b]">
                  Закрыта: {shift.closedAt ? formatDateTimeRu(shift.closedAt) : "Не закрыта"}
                </p>
              </div>
              <span
                className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
                  shift.closedAt ? "bg-[#f1f5f9] text-[#475569]" : "bg-[#dcfce7] text-[#166534]"
                }`}
              >
                {shift.closedAt ? "Закрыта" : "Открыта"}
              </span>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[
              { label: "Наличные", value: totals.cash },
              { label: "Терминал", value: totals.card },
              { label: "Всего", value: totals.total },
            ].map((item) => (
              <div key={item.label} className={`${cardBase} p-4`}>
                <p className="text-[11px] font-medium uppercase tracking-wide text-[#64748b]">{item.label}</p>
                <p className="mt-1 text-xl font-semibold text-[#16a34a]">{formatSum(item.value)}</p>
              </div>
            ))}
          </section>

          <section className={`${cardBase} p-4`}>
            <h2 className="text-sm font-semibold text-[#0f172a]">Итоги</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between border-b border-[#eef2f7] pb-2">
                <dt className="text-[#64748b]">Старт</dt>
                <dd className="text-[#334155]">{formatSum(shift.openingBalance)}</dd>
              </div>
              <div className="flex justify-between border-b border-[#eef2f7] pb-2">
                <dt className="text-[#64748b]">Приход</dt>
                <dd className="text-[#16a34a]">{formatSum(totals.inflow)}</dd>
              </div>
              <div className="flex justify-between border-b border-[#eef2f7] pb-2">
                <dt className="text-[#64748b]">Возвраты</dt>
                <dd className="text-rose-700">{formatSum(totals.outflow)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="font-medium text-[#0f172a]">Итог</dt>
                <dd className="text-lg font-semibold text-[#16a34a]">{formatSum(totals.closing)}</dd>
              </div>
            </dl>
          </section>

          <section className={`${cardBase} overflow-hidden`}>
            <div className="border-b border-[#eef2f7] p-4">
              <h2 className="text-sm font-semibold text-[#0f172a]">Операции смены</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[#eef2f7] bg-[#f8fafc] text-[11px] uppercase tracking-wide text-[#64748b]">
                    <th className="px-3 py-2">Время</th>
                    <th className="px-3 py-2">Пациент</th>
                    <th className="px-3 py-2">Счёт</th>
                    <th className="px-3 py-2">Тип</th>
                    <th className="px-3 py-2">Метод</th>
                    <th className="px-3 py-2 text-right">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className="border-t border-[#eef2f7] hover:bg-[#f8fafc]">
                      <td className="px-3 py-2 text-xs text-[#64748b]">{formatDateTimeRu(e.createdAt)}</td>
                      <td className="px-3 py-2 text-[#334155]">{patientLabel(e)}</td>
                      <td className="px-3 py-2 font-mono text-xs text-[#64748b]">
                        {e.invoiceId != null ? invoices[e.invoiceId]?.number ?? `#${e.invoiceId}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-[#334155]">{ENTRY_TYPE_LABEL[e.type]}</td>
                      <td className="px-3 py-2 text-[#334155]">{METHOD_LABEL[e.method]}</td>
                      <td
                        className={`px-3 py-2 text-right font-medium ${
                          signedAmount(e) < 0 ? "text-rose-700" : "text-[#16a34a]"
                        }`}
                      >
                        {signedAmount(e) < 0 ? "−" : ""}
                        {formatSum(Math.abs(signedAmount(e)))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
};

