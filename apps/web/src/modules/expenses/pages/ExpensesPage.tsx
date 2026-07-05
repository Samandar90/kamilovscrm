import React from "react";
import { useTranslation } from "react-i18next";
import { Plus, RefreshCw, Trash2, Pencil } from "lucide-react";
import { formatDateTimeRu } from "../../../utils/formatDateTime";
import { formatSum } from "../../../utils/formatMoney";
import { MoneyInput } from "../../../shared/ui/MoneyInput";
import { expensesApi, type Expense } from "../api/expensesApi";
import {
  ActionButtons,
  AppContainer,
  DataTable,
  DeleteActionButton,
  EditActionButton,
  FiltersBar,
  FormField,
  ModalShell,
  PageHeader,
  SectionCard,
  StatCard,
  StatusBadge,
} from "../../../shared/ui";
import { Button } from "../../../ui/Button";

const EXPENSE_CATEGORIES = [
  "expenses.categories.rent",
  "expenses.categories.salary",
  "expenses.categories.marketing",
  "expenses.categories.supplies",
  "expenses.categories.utilities",
  "expenses.categories.other"
] as const;

type ExpenseFormState = {
  amount: number;
  category: string;
  description: string;
  paidAt: string;
};

const toDatetimeLocal = (iso: string): string => {
  const date = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
};

const makeDefaultForm = (): ExpenseFormState => ({
  amount: 0,
  category: EXPENSE_CATEGORIES[0],
  description: "",
  paidAt: toDatetimeLocal(new Date().toISOString()),
});

const isBetween = (date: Date, from: Date, to: Date): boolean => date >= from && date < to;

export const ExpensesPage: React.FC = () => {
  const { t } = useTranslation();
  const [rows, setRows] = React.useState<Expense[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Expense | null>(null);
  const [form, setForm] = React.useState<ExpenseFormState>(makeDefaultForm);

  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [categoryFilter, setCategoryFilter] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await expensesApi.list({
        dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : undefined,
        dateTo: dateTo ? new Date(`${dateTo}T23:59:59`).toISOString() : undefined,
        category: categoryFilter || undefined,
      });
      setRows(list);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("expenses.errors.loadError"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, dateFrom, dateTo]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const totalAmount = React.useMemo(() => rows.reduce((acc, row) => acc + row.amount, 0), [rows]);
  const analytics = React.useMemo(() => {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const daysInCurrentMonthSoFar = Math.max(1, now.getDate());

    let todayTotal = 0;
    let monthTotal = 0;
    let prevMonthTotal = 0;
    const categoryTotals = new Map<string, number>();
    const currentMonthCategory = new Map<string, number>();
    const prevMonthCategory = new Map<string, number>();

    for (const row of rows) {
      const paidAt = new Date(row.paidAt);
      if (isBetween(paidAt, startToday, startTomorrow)) {
        todayTotal += row.amount;
      }
      if (isBetween(paidAt, monthStart, nextMonthStart)) {
        monthTotal += row.amount;
        currentMonthCategory.set(row.category, (currentMonthCategory.get(row.category) ?? 0) + row.amount);
      }
      if (isBetween(paidAt, prevMonthStart, monthStart)) {
        prevMonthTotal += row.amount;
        prevMonthCategory.set(row.category, (prevMonthCategory.get(row.category) ?? 0) + row.amount);
      }
      categoryTotals.set(row.category, (categoryTotals.get(row.category) ?? 0) + row.amount);
    }

    const growthPct =
      prevMonthTotal <= 0 ? (monthTotal > 0 ? 100 : 0) : ((monthTotal - prevMonthTotal) / prevMonthTotal) * 100;
    const avgPerDay = monthTotal / daysInCurrentMonthSoFar;

    const categoryStats = Array.from(categoryTotals.entries())
      .map(([category, amount]) => ({
        category,
        amount,
        pct: totalAmount > 0 ? (amount / totalAmount) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    const topExpenses = [...rows].sort((a, b) => b.amount - a.amount).slice(0, 5);

    const growthByCategory = Array.from(
      new Set([...currentMonthCategory.keys(), ...prevMonthCategory.keys()])
    ).map((category) => ({
      category,
      delta: (currentMonthCategory.get(category) ?? 0) - (prevMonthCategory.get(category) ?? 0),
    }));
    growthByCategory.sort((a, b) => b.delta - a.delta);
    const topGrowthCategory = growthByCategory[0];

    const growth = Math.abs(growthPct).toFixed(1);
    const category = topGrowthCategory?.category ?? "—";
    const insight =
      growthPct > 0
        ? t("expenses.insights.increased", { percent: growth, category })
        : growthPct < 0
          ? t("expenses.insights.decreased", { percent: growth })
          : t("expenses.insights.stable");

    return {
      todayTotal,
      monthTotal,
      growthPct,
      avgPerDay,
      categoryStats,
      topExpenses,
      insight,
    };
  }, [rows, totalAmount]);

  const openCreateModal = () => {
    setEditing(null);
    setForm(makeDefaultForm());
    setIsModalOpen(true);
  };

  const openEditModal = (row: Expense) => {
    setEditing(row);
    setForm({
      amount: Math.round(row.amount),
      category: row.category,
      description: row.description ?? "",
      paidAt: toDatetimeLocal(row.paidAt),
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setIsModalOpen(false);
  };

  const submitExpense = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const amountNum = Math.round(form.amount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        setError(t("expenses.errors.invalidAmount"));
        return;
      }
      const payload = {
        amount: amountNum,
        category: form.category,
        description: form.description.trim() || null,
        paidAt: new Date(form.paidAt).toISOString(),
      };

      if (editing) {
        await expensesApi.update(editing.id, payload);
      } else {
        await expensesApi.create(payload);
      }
      setIsModalOpen(false);
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("expenses.errors.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const removeExpense = async (id: number) => {
    const confirmed = window.confirm(t("expenses.confirmDelete"));
    if (!confirmed) return;
    setError(null);
    try {
      await expensesApi.remove(id);
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("expenses.errors.deleteFailed"));
    }
  };

  return (
    <div className="min-h-full bg-[#f8fafc] text-[#334155]">
      <AppContainer className="space-y-6">
        <PageHeader
          title={t("expenses.title")}
          subtitle={t("expenses.subtitle")}
          actions={
            <>
              <Button variant="secondary" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                {t("common.actions.refresh")}
              </Button>
              <Button onClick={openCreateModal}>
                <Plus className="h-4 w-4" />
                {t("expenses.addExpense")}
              </Button>
            </>
          }
        />

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label={t("expenses.stats.today")} value={formatSum(analytics.todayTotal)} />
          <StatCard label={t("expenses.stats.month")} value={formatSum(analytics.monthTotal)} />
          <StatCard
            label={t("expenses.stats.change")}
            value={`${analytics.growthPct > 0 ? "+" : ""}${analytics.growthPct.toFixed(1)}%`}
            tone={analytics.growthPct > 0 ? "danger" : analytics.growthPct < 0 ? "success" : "neutral"}
          />
          <StatCard label={t("expenses.stats.avgPerDay")} value={formatSum(analytics.avgPerDay)} />
        </section>

        <SectionCard className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">{t("expenses.summary.title")}</p>
            <p className="mt-1 text-sm text-[#475569]">{t("expenses.summary.totalOperations", { count: rows.length })}</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-[#64748b]">{t("expenses.summary.totalAmount")}</p>
            <p className="text-xl font-semibold tabular-nums text-[#0f172a]">{formatSum(totalAmount)}</p>
          </div>
        </SectionCard>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <SectionCard className="xl:col-span-2">
            <h2 className="text-base font-semibold text-[#0f172a]">{t("expenses.analytics.byCategory.title")}</h2>
            <p className="mt-1 text-xs text-[#64748b]">{t("expenses.analytics.byCategory.description")}</p>
            <div className="mt-4 space-y-3">
              {analytics.categoryStats.length === 0 ? (
                <p className="text-sm text-[#64748b]">{t("expenses.analytics.noData")}</p>
              ) : (
                analytics.categoryStats.map((category) => (
                  <div key={category.category}>
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-[#0f172a]">{t(category.category)}</span>
                      <span className="text-sm font-semibold text-[#334155]">
                        {formatSum(category.amount)} · {category.pct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-[#f1f5f9]">
                      <div
                        className="h-2 rounded-full bg-[#16a34a]"
                        style={{ width: `${Math.min(100, category.pct)}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </SectionCard>

          <SectionCard>
            <h2 className="text-base font-semibold text-[#0f172a]">{t("expenses.analytics.topExpenses.title")}</h2>
            <p className="mt-1 text-xs text-[#64748b]">{t("expenses.analytics.topExpenses.description")}</p>
            <div className="mt-4 space-y-2">
              {analytics.topExpenses.length === 0 ? (
                <p className="text-sm text-[#64748b]">{t("expenses.analytics.noExpenses")}</p>
              ) : (
                analytics.topExpenses.map((expense) => (
                  <div
                    key={expense.id}
                    className="flex items-center justify-between rounded-xl border border-[#eef2f7] bg-[#fcfdff] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[#0f172a]">{expense.description || expense.category}</p>
                      <div className="mt-1">
                        <StatusBadge tone="neutral">{expense.category}</StatusBadge>
                      </div>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-[#0f172a]">
                      {formatSum(expense.amount)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </SectionCard>
        </section>

        <SectionCard>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">🧠 {t("expenses.insights.title")}</p>
          <p className="mt-2 text-sm leading-relaxed text-[#334155]">{analytics.insight}</p>
        </SectionCard>

        <FiltersBar className="p-5">
          <div className="md:col-span-1">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#64748b]">{t("expenses.filters.dateFrom")}</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="h-10 w-full rounded-xl border border-[#e2e8f0] px-3 text-sm outline-none focus:border-[#16a34a]"
            />
          </div>
          <div className="md:col-span-1">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#64748b]">{t("expenses.filters.dateTo")}</label>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="h-10 w-full rounded-xl border border-[#e2e8f0] px-3 text-sm outline-none focus:border-[#16a34a]"
            />
          </div>
          <div className="md:col-span-1">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#64748b]">{t("expenses.filters.category")}</label>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="h-10 w-full rounded-xl border border-[#e2e8f0] px-3 text-sm outline-none focus:border-[#16a34a]"
            >
              <option value="">{t("expenses.filters.allCategories")}</option>
              {EXPENSE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {t(category)}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-1">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#64748b]">{t("expenses.filters.amountByFilter")}</p>
            <div className="flex h-10 items-center rounded-xl bg-[#f8fafc] px-3 text-sm font-semibold text-[#0f172a]">
              {formatSum(totalAmount)}
            </div>
          </div>
        </FiltersBar>

        {error ? (
          <SectionCard className="border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</SectionCard>
        ) : null}

        <DataTable
          title={t("expenses.table.title")}
          subtitle={t("expenses.table.subtitle")}
          loading={loading}
          empty={!loading && rows.length === 0}
          emptyTitle={t("expenses.table.emptyTitle")}
          emptySubtitle={t("expenses.table.emptySubtitle")}
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[#e5e7eb]">
              <thead className="bg-[#f8fafc]">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#64748b]">{t("common.table.date")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#64748b]">{t("expenses.table.category")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#64748b]">{t("common.table.description")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#64748b]">{t("common.table.amount")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#64748b]">{t("common.table.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f1f5f9]">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-[#f8fafc]">
                    <td className="px-4 py-3 text-sm text-[#334155]">{formatDateTimeRu(row.paidAt)}</td>
                    <td className="px-4 py-3 text-sm font-medium text-[#0f172a]">{t(row.category)}</td>
                    <td className="px-4 py-3 text-sm text-[#475569]">{row.description || "—"}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-[#0f172a]">
                      {formatSum(row.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <ActionButtons>
                        <EditActionButton onClick={() => openEditModal(row)} aria-label={t("common.edit")}>
                          <Pencil className="h-4 w-4" />
                        </EditActionButton>
                        <DeleteActionButton onClick={() => void removeExpense(row.id)} aria-label={t("common.delete")}>
                          <Trash2 className="h-4 w-4" />
                        </DeleteActionButton>
                      </ActionButtons>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataTable>
      </AppContainer>

      <ModalShell
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editing ? t("expenses.modal.editTitle") : t("expenses.modal.createTitle")}
        subtitle={t("expenses.modal.subtitle")}
        footer={
          <ActionButtons>
            <Button variant="secondary" type="button" onClick={closeModal}>
              {t("common.actions.cancel")}
            </Button>
            <Button type="submit" form="expense-form" disabled={saving}>
              {saving ? t("common.actions.saving") : t("common.actions.save")}
            </Button>
          </ActionButtons>
        }
      >
        <form id="expense-form" className="space-y-4" onSubmit={(event) => void submitExpense(event)}>
          <FormField label={t("expenses.form.amount")}>
            <MoneyInput
              mode="integer"
              min={0}
              value={form.amount}
              onChange={(next) => setForm((prev) => ({ ...prev, amount: next }))}
              className="h-10 w-full rounded-xl border border-[#e2e8f0] px-3 text-sm outline-none focus:border-[#16a34a]"
            />
          </FormField>
          <FormField label={t("expenses.form.category")}>
            <select
              required
              value={form.category}
              onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
              className="h-10 w-full rounded-xl border border-[#e2e8f0] px-3 text-sm outline-none focus:border-[#16a34a]"
            >
              {EXPENSE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {t(category)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={t("expenses.form.description")}>
            <textarea
              rows={3}
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              className="w-full rounded-xl border border-[#e2e8f0] px-3 py-2 text-sm outline-none focus:border-[#16a34a]"
            />
          </FormField>
          <FormField label={t("expenses.form.date")}>
            <input
              type="datetime-local"
              required
              value={form.paidAt}
              onChange={(event) => setForm((prev) => ({ ...prev, paidAt: event.target.value }))}
              className="h-10 w-full rounded-xl border border-[#e2e8f0] px-3 text-sm outline-none focus:border-[#16a34a]"
            />
          </FormField>
        </form>
      </ModalShell>
    </div>
  );
};

