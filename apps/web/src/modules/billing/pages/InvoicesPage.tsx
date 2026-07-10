import React from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { RefreshCw, Search } from "lucide-react";
import { requestJson } from "../../../api/http";
import { useAuth } from "../../../auth/AuthContext";
import { formatSum } from "../../../utils/formatMoney";
import type { InvoiceStatus } from "../api/cashDeskApi";
import {
  ActionButtons,
  AppContainer,
  DataTable,
  FiltersBar,
  PageHeader,
  SectionCard,
  StatCard,
  StatusBadge,
} from "../../../shared/ui";
import { Button } from "../../../ui/Button";

type InvoiceSummary = {
  id: number;
  number: string;
  patientId: number;
  appointmentId: number | null;
  status: InvoiceStatus;
  subtotal: number;
  discount: number;
  total: number;
  paidAmount: number;
  createdAt: string;
  updatedAt: string;
};

type Patient = { id: number; fullName: string };

const controlClass =
  "h-10 rounded-2xl border border-[#e2e8f0] bg-white px-3 text-sm text-[#334155] shadow-sm outline-none " +
  "transition-[border-color,box-shadow] duration-150 ease-out " +
  "placeholder:text-[#94a3b8] hover:border-[#cbd5e1] " +
  "focus:border-[#22c55e] focus:shadow-[0_0_0_3px_rgba(34,197,94,0.15)] focus:ring-0 disabled:opacity-50";

const moneyClass = "font-medium tabular-nums text-[#16a34a]";

const statusToneMap: Record<InvoiceStatus, "neutral" | "warning" | "success" | "danger" | "info"> = {
  draft: "neutral",
  issued: "warning",
  partially_paid: "info",
  paid: "success",
  cancelled: "danger",
  refunded: "danger",
};

const statusLabelMap: Record<InvoiceStatus, string> = {
  draft: "billing.status.draft",
  issued: "billing.status.issued",
  partially_paid: "billing.status.partial",
  paid: "billing.status.paid",
  cancelled: "billing.status.cancelled",
  refunded: "billing.status.refunded",
};

export const InvoicesPage: React.FC = () => {
  const navigate = useNavigate();
  const { token } = useAuth();
  const { t } = useTranslation();
  const [invoices, setInvoices] = React.useState<InvoiceSummary[]>([]);
  const [patientsMap, setPatientsMap] = React.useState<Record<number, string>>({});
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<string>("");
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const load = React.useCallback(
    async (options?: { showToast?: boolean; isManualRefresh?: boolean }) => {
      if (!token) return;
      const showToast = options?.showToast === true;
      const manual = options?.isManualRefresh === true;
      if (manual) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const [invoiceRows, patientRows] = await Promise.all([
          requestJson<InvoiceSummary[]>("/api/invoices", { token }),
          requestJson<Patient[]>("/api/patients", { token }),
        ]);
        setInvoices(invoiceRows);
        setPatientsMap(Object.fromEntries(patientRows.map((p) => [p.id, p.fullName])));
        if (showToast) {
          setToast(t("billing.listRefreshed"));
        }
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : t("billing.errorLoading"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token]
  );

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const filtered = invoices.filter((invoice) => {
    if (status && invoice.status !== status) return false;
    const text = `${invoice.number} ${patientsMap[invoice.patientId] ?? ""} ${invoice.appointmentId ?? ""}`.toLowerCase();
    return text.includes(search.trim().toLowerCase());
  });

  const stats = React.useMemo(() => {
    const total = invoices.length;
    const paidFull = invoices.filter((i) => i.status === "paid").length;
    const awaiting = invoices.filter((i) => {
      const rem = i.total - i.paidAmount;
      return rem > 1e-6 && i.status !== "cancelled" && i.status !== "refunded";
    }).length;
    return { total, paidFull, awaiting };
  }, [invoices]);

  const hasAnyInvoices = invoices.length > 0;
  const emptyFiltered = hasAnyInvoices && filtered.length === 0;

  return (
    <div className="min-h-full overflow-x-hidden bg-[#f8fafc] pb-[110px] text-[#334155] max-md:[&_button]:min-h-[44px] md:pb-0">
      <AppContainer className="max-w-[1440px] space-y-6">
        <PageHeader
          title={t("billing.invoices")}
          subtitle={t("billing.invoicesSubtitle")}
          actions={
            <Button
              type="button"
              variant="secondary"
              onClick={() => void load({ showToast: true, isManualRefresh: true })}
              disabled={loading || refreshing || !token}
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? t("billing.refreshing") : t("billing.refresh")}
            </Button>
          }
        />

        {!loading && hasAnyInvoices && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label={t("billing.totalInvoices")} value={String(stats.total)} trend={t("billing.inDatabase")} />
            <StatCard label={t("billing.paid")} value={String(stats.paidFull)} tone="success" trend={t("billing.fully")} />
            <StatCard label={t("billing.toPay")} value={String(stats.awaiting)} tone="warning" trend={t("billing.hasBalance")} />
          </div>
        )}

        <FiltersBar className="invoice-enter invoice-enter-delay-1 md:grid-cols-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />
            <input
              className={`${controlClass} w-full pl-10`}
              placeholder={t("billing.searchPlaceholder")}
              aria-label={t("billing.searchInvoices")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              disabled={loading}
            />
          </div>
          <div>
            <select
              className={`${controlClass} w-full`}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              disabled={loading}
            >
              <option value="">{t("billing.allStatuses")}</option>
              <option value="draft">{t("billing.status.draft")}</option>
              <option value="issued">{t("billing.status.issued")}</option>
              <option value="partially_paid">{t("billing.status.partial")}</option>
              <option value="paid">{t("billing.status.paid")}</option>
              <option value="cancelled">{t("billing.status.cancelled")}</option>
              <option value="refunded">{t("billing.status.refunded")}</option>
            </select>
          </div>
          <div className="flex items-center justify-end">
            {(search || status) && (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch("");
                  setStatus("");
                }}
              >
                {t("billing.clearFilters")}
              </Button>
            )}
          </div>
        </FiltersBar>

        {error && (
          <SectionCard
            className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
            role="alert"
          >
            {error}
          </SectionCard>
        )}
        {toast && (
          <SectionCard className="border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            {toast}
          </SectionCard>
        )}

        <DataTable
          title={t("billing.invoicesList")}
          subtitle={t("billing.invoicesListSubtitle")}
          loading={loading}
          empty={!loading && (!hasAnyInvoices || emptyFiltered)}
          emptyTitle={hasAnyInvoices ? t("billing.noInvoicesFiltered") : t("billing.noInvoices")}
          emptySubtitle={
            hasAnyInvoices
              ? t("billing.changeFilters")
              : t("billing.invoiceCreatedAfterVisit")
          }
        >
          {!loading && !(!hasAnyInvoices || emptyFiltered) ? (
            <>
              <div className="space-y-2.5 md:hidden">
                {filtered.map((invoice) => {
                  const remainder = Math.max(0, invoice.total - invoice.paidAmount);
                  return (
                    <article key={invoice.id} className="rounded-2xl border border-[#e5e7eb] bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-[#0f172a]">{invoice.number}</p>
                          <p className="mt-0.5 text-xs text-[#64748b]">
                            {patientsMap[invoice.patientId] ?? `#${invoice.patientId}`}
                          </p>
                        </div>
                        <StatusBadge tone={statusToneMap[invoice.status]}>{t(statusLabelMap[invoice.status])}</StatusBadge>
                      </div>
                      <div className="mt-3 space-y-1.5 text-sm">
                        <p className="flex items-center justify-between text-[#64748b]">
                          <span>{t("billing.toPay")}</span>
                          <span className="font-semibold tabular-nums text-[#16a34a]">{formatSum(invoice.total)}</span>
                        </p>
                        <p className="flex items-center justify-between text-[#64748b]">
                          <span>{t("billing.paid")}</span>
                          <span className="font-medium tabular-nums text-[#334155]">{formatSum(invoice.paidAmount)}</span>
                        </p>
                        <p className="flex items-center justify-between text-[#64748b]">
                          <span>{t("billing.balance")}</span>
                          <span className="font-semibold tabular-nums text-rose-600">{formatSum(remainder)}</span>
                        </p>
                      </div>
                      <div className="mt-3 flex justify-end">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => navigate(`/billing/invoices/${invoice.id}`)}
                        >
                          {t("billing.open")}
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1100px] border-collapse bg-white text-left text-sm">
                <thead>
                  <tr className="border-b border-[#e5e7eb] bg-[#f8fafc]">
                    <th className="whitespace-nowrap px-5 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-[#64748b]">
                      {t("billing.number")}
                    </th>
                    <th className="min-w-[160px] px-5 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-[#64748b]">
                      {t("billing.patient")}
                    </th>
                    <th className="whitespace-nowrap px-5 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-[#64748b]">
                      {t("billing.appointment")}
                    </th>
                    <th className="whitespace-nowrap px-5 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider text-[#64748b]">
                      {t("billing.amount")}
                    </th>
                    <th className="whitespace-nowrap px-5 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider text-[#64748b]">
                      {t("billing.discount")}
                    </th>
                    <th className="whitespace-nowrap px-5 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider text-[#0f172a]">
                      {t("billing.toPay")}
                    </th>
                    <th className="whitespace-nowrap px-5 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider text-[#64748b]">
                      {t("billing.paid")}
                    </th>
                    <th className="whitespace-nowrap px-5 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-[#64748b]">
                      {t("billing.statusLabel")}
                    </th>
                    <th className="whitespace-nowrap px-5 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider text-[#64748b]">
                      {t("billing.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e5e7eb]">
                  {filtered.map((invoice) => {
                    return (
                      <tr key={invoice.id} className="bg-white transition-[background-color] duration-150 ease-out hover:bg-[#f8fafc]">
                        <td className="whitespace-nowrap px-5 py-3.5 font-semibold tabular-nums text-[#0f172a]">
                          {invoice.number}
                        </td>
                        <td
                          className="max-w-[220px] truncate px-5 py-3.5 text-[#334155]"
                          title={patientsMap[invoice.patientId] ?? ""}
                        >
                          {patientsMap[invoice.patientId] ?? `#${invoice.patientId}`}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 tabular-nums text-[#64748b]">
                          {invoice.appointmentId != null ? `#${invoice.appointmentId}` : "—"}
                        </td>
                        <td className={`whitespace-nowrap px-5 py-3.5 text-right tabular-nums text-[#334155]`}>
                          {formatSum(invoice.subtotal)}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 text-right tabular-nums text-[#64748b]">
                          {formatSum(invoice.discount)}
                        </td>
                        <td className={`whitespace-nowrap px-5 py-3.5 text-right text-base ${moneyClass}`}>
                          {formatSum(invoice.total)}
                        </td>
                        <td className={`whitespace-nowrap px-5 py-3.5 text-right ${moneyClass}`}>
                          {formatSum(invoice.paidAmount)}
                        </td>
                        <td className="px-5 py-3.5">
                          <StatusBadge tone={statusToneMap[invoice.status]}>{t(statusLabelMap[invoice.status])}</StatusBadge>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <ActionButtons>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => navigate(`/billing/invoices/${invoice.id}`)}
                            >
                              {t("billing.open")}
                            </Button>
                          </ActionButtons>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </>
          ) : null}
        </DataTable>
      </AppContainer>
    </div>
  );
};
