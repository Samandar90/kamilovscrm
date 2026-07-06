import React from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownAZ, ArrowUpZA } from "lucide-react";
import { motion } from "framer-motion";
import { formatDateTimeRu } from "../../../utils/formatDateTime";
import { formatSum } from "../../../utils/formatMoney";
import type { InvoiceRow, PaymentRow } from "../api/reportsApi";

type Row = {
  id: string;
  type: "payment" | "invoice";
  ref: string;
  amount: number;
  status: string;
  method: string;
  createdAt: string;
};

type Props = {
  payments: PaymentRow[];
  invoices: InvoiceRow[];
  loading: boolean;
};

type SortKey = "createdAt" | "amount";

export const ReportsTable: React.FC<Props> = ({ payments, invoices, loading }) => {
  const { t } = useTranslation();
  const [sortKey, setSortKey] = React.useState<SortKey>("createdAt");
  const [sortAsc, setSortAsc] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<"all" | "payment" | "invoice">("all");

  const rows = React.useMemo<Row[]>(() => {
    const paymentRows: Row[] = payments.map((payment) => ({
      id: `p-${payment.id}`,
      type: "payment",
      ref: `${t("reports.paymentPrefix")}${payment.id}`,
      amount: payment.amount,
      status: payment.deletedAt ? t("reports.paymentStatusCancelled") : t("reports.paymentStatusExecuted"),
      method: payment.method === "cash" ? t("reports.paymentMethodCash") : t("reports.paymentMethodCard"),
      createdAt: payment.createdAt,
    }));
    const invoiceRows: Row[] = invoices.map((invoice) => ({
      id: `i-${invoice.id}`,
      type: "invoice",
      ref: invoice.number,
      amount: invoice.total,
      status: invoice.status,
      method: "—",
      createdAt: invoice.createdAt,
    }));
    return [...paymentRows, ...invoiceRows];
  }, [payments, invoices]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (typeFilter !== "all" && row.type !== typeFilter) return false;
      if (!q) return true;
      return row.ref.toLowerCase().includes(q) || row.status.toLowerCase().includes(q);
    });
  }, [rows, query, typeFilter]);

  const sorted = React.useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const dir = sortAsc ? 1 : -1;
      if (sortKey === "amount") return (a.amount - b.amount) * dir;
      return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
    });
    return copy;
  }, [filtered, sortAsc, sortKey]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc((prev) => !prev);
      return;
    }
    setSortKey(key);
    setSortAsc(false);
  };

  return (
    <motion.section
      className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_10px_30px_-18px_rgba(15,23,42,0.18)] transition hover:shadow-[0_16px_36px_-20px_rgba(15,23,42,0.2)]"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut", delay: 0.08 }}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h3 className="text-base font-semibold text-slate-950">{t("reports.operationsTitle")}</h3>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("reports.operationsSearchPlaceholder")}
            className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white"
          />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as "all" | "payment" | "invoice")}
            className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white"
          >
            <option value="all">{t("reports.typeFilterAll")}</option>
            <option value="payment">{t("reports.typeFilterPayment")}</option>
            <option value="invoice">{t("reports.typeFilterInvoice")}</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 h-64 animate-pulse rounded-xl bg-slate-100" />
      ) : sorted.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          {t("reports.noFilteredOperations")}
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">{t("reports.typeColumn")}</th>
                <th className="px-3 py-2">Ref</th>
                <th className="px-3 py-2">{t("reports.statusColumn")}</th>
                <th className="px-3 py-2">{t("reports.methodColumn")}</th>
                <th className="px-3 py-2">
                  <button type="button" onClick={() => toggleSort("amount")} className="inline-flex items-center gap-1">
                    {t("reports.amountColumn")} {sortKey === "amount" ? (sortAsc ? <ArrowDownAZ className="h-3.5 w-3.5" /> : <ArrowUpZA className="h-3.5 w-3.5" />) : null}
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button type="button" onClick={() => toggleSort("createdAt")} className="inline-flex items-center gap-1">
                    {t("reports.dateColumn")} {sortKey === "createdAt" ? (sortAsc ? <ArrowDownAZ className="h-3.5 w-3.5" /> : <ArrowUpZA className="h-3.5 w-3.5" />) : null}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 text-sm text-slate-700">
                  <td className="px-3 py-2">{row.type === "payment" ? t("reports.paymentType") : t("reports.invoiceType")}</td>
                  <td className="px-3 py-2 font-medium text-slate-900">{row.ref}</td>
                  <td className="px-3 py-2">{row.status}</td>
                  <td className="px-3 py-2">{row.method}</td>
                  <td className="px-3 py-2 font-semibold text-slate-900">{formatSum(row.amount)}</td>
                  <td className="px-3 py-2">{formatDateTimeRu(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.section>
  );
};

