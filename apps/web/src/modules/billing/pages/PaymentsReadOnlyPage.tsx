import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, Search } from "lucide-react";
import { useAuth } from "../../../auth/AuthContext";
import { formatDateTimeRu } from "../../../utils/formatDateTime";
import { formatSum } from "../../../utils/formatMoney";
import { cashDeskApi, type InvoiceSummary, type Payment, type PaymentMethod } from "../api/cashDeskApi";
import { AppContainer, DataTable, FiltersBar, PageHeader, SectionCard, StatusBadge } from "../../../shared/ui";
import { Button } from "../../../ui/Button";

const METHOD_RU: Record<PaymentMethod, string> = {
  cash: "Наличные",
  card: "Терминал",
};

export const PaymentsReadOnlyPage: React.FC = () => {
  const { token } = useAuth();
  const [rows, setRows] = React.useState<Payment[]>([]);
  const [invoicesMap, setInvoicesMap] = React.useState<Record<number, InvoiceSummary>>({});
  const [patientsMap, setPatientsMap] = React.useState<Record<number, string>>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [methodFilter, setMethodFilter] = React.useState<"" | PaymentMethod>(""); 

  const load = React.useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [list, invoices, patients] = await Promise.all([
        cashDeskApi.listPayments(token),
        cashDeskApi.listInvoices(token),
        cashDeskApi.listPatients(token),
      ]);
      setRows(list);
      setInvoicesMap(Object.fromEntries(invoices.map((inv) => [inv.id, inv])));
      setPatientsMap(Object.fromEntries(patients.map((p) => [p.id, p.fullName])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (methodFilter && row.method !== methodFilter) return false;
      const invoice = invoicesMap[row.invoiceId];
      const patientName = invoice ? (patientsMap[invoice.patientId] ?? "") : "";
      const haystack = `${patientName} ${invoice?.number ?? ""} ${row.invoiceId}`.toLowerCase();
      return !q || haystack.includes(q);
    });
  }, [rows, methodFilter, search, invoicesMap, patientsMap]);

  return (
    <div className="min-h-full overflow-x-hidden bg-[#f8fafc] pb-[110px] text-[#334155] max-md:[&_button]:min-h-[44px] md:pb-0">
      <AppContainer className="max-w-6xl space-y-6">
        <PageHeader
          title="Платежи"
          subtitle="Журнал оплат (только просмотр). Изменения — через кассу."
          actions={
            <Button variant="secondary" onClick={() => void load()} disabled={loading || !token}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Обновить
            </Button>
          }
        />

        <Link
          to="/billing/invoices"
          className="inline-flex items-center gap-2 text-sm font-medium text-[#64748b] hover:text-[#0f172a]"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          К счетам
        </Link>

        {error ? (
          <SectionCard className="border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</SectionCard>
        ) : null}

        <FiltersBar className="md:grid-cols-3">
          <div className="relative md:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по пациенту, номеру счёта…"
              className="h-10 w-full rounded-xl border border-[#e2e8f0] bg-white py-2 pl-10 pr-3 text-sm outline-none focus:border-[#16a34a]"
            />
          </div>
          <select
            className="h-10 rounded-xl border border-[#e2e8f0] bg-white px-3 text-sm outline-none focus:border-[#16a34a]"
            value={methodFilter}
            onChange={(event) => setMethodFilter(event.target.value as "" | PaymentMethod)}
          >
            <option value="">Все методы</option>
            <option value="cash">Наличные</option>
            <option value="card">Терминал</option>
          </select>
        </FiltersBar>

        <DataTable
          title="История оплат"
          subtitle="Сначала последние · без аннулированных"
          loading={loading}
          empty={!loading && filteredRows.length === 0}
          emptyTitle={rows.length === 0 ? "Платежей пока нет" : "Нет оплат по выбранным фильтрам"}
          emptySubtitle={
            rows.length === 0 ? "Платежи появятся после операций в кассе" : "Измените фильтры или строку поиска"
          }
        >
          <div className="space-y-2.5 md:hidden">
            {filteredRows.map((p) => {
              const invoice = invoicesMap[p.invoiceId];
              const patientName = invoice ? patientsMap[invoice.patientId] ?? `Пациент #${invoice.patientId}` : "—";
              return (
                <article key={p.id} className="rounded-2xl border border-[#e5e7eb] bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[#0f172a]">{patientName}</p>
                      <p className="mt-0.5 text-xs text-[#64748b]">{invoice?.number ?? `#${p.invoiceId}`}</p>
                    </div>
                    <StatusBadge tone={p.method === "cash" ? "neutral" : "info"}>{METHOD_RU[p.method]}</StatusBadge>
                  </div>
                  <p className="mt-2 text-xs tabular-nums text-[#64748b]">{formatDateTimeRu(p.createdAt)}</p>
                  <p className="mt-2 text-lg font-semibold tabular-nums text-[#16a34a]">{formatSum(p.amount)}</p>
                  <div className="mt-3">
                    <Link to={`/billing/invoices/${p.invoiceId}`} className="text-xs font-medium text-[#16a34a] hover:underline">
                      Открыть счёт
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-[#f8fafc]">
                <tr className="border-b border-[#e5e7eb]">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#64748b]">Дата</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#64748b]">Пациент</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#64748b]">Счёт</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#64748b]">Метод</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#64748b]">Сумма</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#64748b]">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f1f5f9]">
                {filteredRows.map((p) => {
                  const invoice = invoicesMap[p.invoiceId];
                  const patientName = invoice ? patientsMap[invoice.patientId] ?? `Пациент #${invoice.patientId}` : "—";
                  return (
                    <tr key={p.id} className="hover:bg-[#f8fafc]">
                      <td className="px-4 py-3 text-xs tabular-nums text-[#64748b]">{formatDateTimeRu(p.createdAt)}</td>
                      <td className="px-4 py-3 text-sm font-medium text-[#0f172a]">{patientName}</td>
                      <td className="px-4 py-3 text-sm text-[#334155]">{invoice?.number ?? `#${p.invoiceId}`}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <StatusBadge tone={p.method === "cash" ? "neutral" : "info"}>{METHOD_RU[p.method]}</StatusBadge>
                          {(p.refundedAmount ?? 0) > 0 ? <StatusBadge tone="warning">Возврат</StatusBadge> : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-[#16a34a]">
                        {formatSum(p.amount)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link to={`/billing/invoices/${p.invoiceId}`} className="text-xs font-medium text-[#16a34a] hover:underline">
                          Открыть счёт
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </DataTable>
      </AppContainer>
    </div>
  );
};
