import React from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Inbox,
  Loader2,
  PanelRight,
  Printer,
  RefreshCw,
  RotateCcw,
  Wallet,
} from "lucide-react";
import { useAuth } from "../../../auth/AuthContext";
import { formatDateTimeRu } from "../../../utils/formatDateTime";
import { formatSum } from "../../../utils/formatMoney";
import { printReceipt } from "../../../shared/receipt/printReceipt";
import { buildReceiptHTML } from "../../../shared/receipt/receiptTemplate";
import { resolveReceiptClinicName } from "../../../shared/receipt/resolveReceiptClinicName";
import { getAllServices } from "../../../shared/lib/appointments/getAllServices";
import { useClinic } from "../../../hooks/useClinic";
import {
  cashDeskApi,
  type AppointmentReadyForPayment,
  type CashRegisterEntry,
  type CashRegisterShift,
  type CashRegisterShiftSummary,
  type ClinicMeta,
  type InvoiceDetail,
  type InvoiceStatus,
  type InvoiceSummary,
  type PaymentMethod,
} from "../api/cashDeskApi";
import { canRefundPayments, canWriteBilling } from "../../../auth/roleGroups";
import { RefundModal } from "../components/RefundModal";
import {
  formatYmdInTimeZone,
  rangeLast7Days,
  rangeToday,
  rangeYesterday,
} from "../utils/cashDeskDates";
import {
  AppContainer,
  EmptyState,
  FormField,
  ModalShell,
  MoneyInput,
  PageHeader,
  PageLoader,
  SectionCard,
  StatCard,
  StatusBadge,
} from "../../../shared/ui";
import { Button } from "../../../ui/Button";

const PAYABLE_STATUSES = new Set<InvoiceStatus>(["issued", "partially_paid"]);

const ENTRY_TYPE_LABEL: Record<CashRegisterEntry["type"], string> = {
  payment: "billing.payment",
  refund: "billing.refund",
  manual_in: "billing.manualIn",
  manual_out: "billing.manualOut",
};

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "billing.cash",
  card: "billing.terminal",
};

type EntryPreset = "all" | "today" | "yesterday" | "last7" | "custom";

export const CashDeskPage: React.FC = () => {
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const { clinic } = useClinic();
  const { t } = useTranslation();
  const canOperate = canWriteBilling(user?.role);
  const canRefund = canRefundPayments(user?.role);
  const isSuperadmin = user?.role === "superadmin";
  const cashierName = user?.username ?? "—";

  const [invoices, setInvoices] = React.useState<InvoiceSummary[]>([]);
  const [patientsMap, setPatientsMap] = React.useState<Record<number, string>>({});
  const [doctorsMap, setDoctorsMap] = React.useState<Record<number, string>>({});
  const [servicesMap, setServicesMap] = React.useState<Record<number, string>>({});
  const [readyAppointments, setReadyAppointments] = React.useState<AppointmentReadyForPayment[]>([]);
  const [appointmentServicesMap, setAppointmentServicesMap] = React.useState<
    Record<number, number[]>
  >({});
  const [activeShift, setActiveShift] = React.useState<CashRegisterShift | null>(null);
  const [shiftHistory, setShiftHistory] = React.useState<CashRegisterShift[]>([]);
  const [cashEntries, setCashEntries] = React.useState<CashRegisterEntry[]>([]);
  const [cashSummary, setCashSummary] = React.useState<CashRegisterShiftSummary | null>(null);
  const [clinicMeta, setClinicMeta] = React.useState<ClinicMeta | null>(null);

  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [entriesLoading, setEntriesLoading] = React.useState(false);

  const [modalOpenShift, setModalOpenShift] = React.useState(false);
  const [modalCloseShift, setModalCloseShift] = React.useState(false);
  const [payModalInvoice, setPayModalInvoice] = React.useState<InvoiceSummary | null>(null);

  const [refundEntry, setRefundEntry] = React.useState<CashRegisterEntry | null>(null);
  const [refundReason, setRefundReason] = React.useState("");
  const [refundAmountInput, setRefundAmountInput] = React.useState(0);
  const [refundSubmitting, setRefundSubmitting] = React.useState(false);

  const [openingBalanceInput, setOpeningBalanceInput] = React.useState(0);
  const [openShiftSubmitting, setOpenShiftSubmitting] = React.useState(false);
  const [closeShiftSubmitting, setCloseShiftSubmitting] = React.useState(false);

  const [payAmount, setPayAmount] = React.useState(0);
  const [payMethod, setPayMethod] = React.useState<PaymentMethod>("cash");
  const [paySubmitting, setPaySubmitting] = React.useState(false);
  const [payModalError, setPayModalError] = React.useState<string | null>(null);

  const [selectedEntryId, setSelectedEntryId] = React.useState<number | null>(null);
  const [selectedInvoiceDetail, setSelectedInvoiceDetail] = React.useState<InvoiceDetail | null>(null);
  const [selectedInvoiceLoading, setSelectedInvoiceLoading] = React.useState(false);

  const [entryPreset, setEntryPreset] = React.useState<EntryPreset>("all");
  const [customDay, setCustomDay] = React.useState(() =>
    formatYmdInTimeZone(new Date(), "Asia/Tashkent")
  );

  const [error, setError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const tz = clinicMeta?.reportsTimezone ?? "Asia/Tashkent";
  const clinicName =
    clinicMeta?.clinicName ??
    (import.meta.env.VITE_CLINIC_NAME as string | undefined) ??
    "Клиника";
  const receiptFooter =
    clinicMeta?.receiptFooter ??
    "Внутренний документ · не является фискальным чеком";

  const dateRange = React.useMemo(() => {
    if (entryPreset === "all") return { dateFrom: undefined as string | undefined, dateTo: undefined as string | undefined };
    if (entryPreset === "today") return rangeToday(tz);
    if (entryPreset === "yesterday") return rangeYesterday(tz);
    if (entryPreset === "last7") return rangeLast7Days(tz);
    return { dateFrom: customDay, dateTo: customDay };
  }, [entryPreset, customDay, tz]);

  const loadEntries = React.useCallback(async () => {
    if (!token) return;
    const shift = activeShift;
    if (!shift || shift.closedAt) {
      setCashEntries([]);
      return;
    }
    setEntriesLoading(true);
    try {
      const rows = await cashDeskApi.listEntries(token, {
        shiftId: shift.id,
        dateFrom: dateRange.dateFrom,
        dateTo: dateRange.dateTo,
      });
      setCashEntries(rows.slice(0, 300));
    } catch {
      setCashEntries([]);
    } finally {
      setEntriesLoading(false);
    }
  }, [token, activeShift, dateRange.dateFrom, dateRange.dateTo]);

  const loadCore = React.useCallback(
    async (mode: "initial" | "refresh" = "initial", opts?: { showDataRefreshedToast?: boolean }) => {
      if (!token) return;
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const [
          invoiceRows,
          patientRows,
          doctorRows,
          serviceRows,
          readyRows,
          shift,
          history,
          summary,
          meta,
        ] = await Promise.all([
          cashDeskApi.listInvoices(token),
          cashDeskApi.listPatients(token),
          cashDeskApi.listDoctors(token),
          cashDeskApi.listServices(token),
          cashDeskApi.listAppointmentsReadyForPayment(token),
          cashDeskApi.getCurrentShift(token),
          cashDeskApi.shiftHistory(token),
          cashDeskApi.getSummaryCurrent(token),
          cashDeskApi.getClinicMeta(token).catch(() => null),
        ]);
        setInvoices(invoiceRows);
        setPatientsMap(Object.fromEntries(patientRows.map((p) => [p.id, p.fullName])));
        setDoctorsMap(Object.fromEntries(doctorRows.map((d) => [d.id, d.name])));
        setServicesMap(Object.fromEntries(serviceRows.map((s) => [s.id, s.name])));
        setReadyAppointments(readyRows);
        setActiveShift(shift);
        setShiftHistory(history.slice(0, 24));
        setCashSummary(summary);
        if (meta) setClinicMeta(meta);

        if (mode === "refresh" && summary) {
          // eslint-disable-next-line no-console
          console.log("[cash] summary", summary);
        }
        if (mode === "refresh" && opts?.showDataRefreshedToast) setToast(t("billing.dataRefreshed"));
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
    void loadCore("initial");
  }, [loadCore]);

  React.useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  React.useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const payableInvoices = React.useMemo(
    () =>
      invoices.filter(
        (inv) => PAYABLE_STATUSES.has(inv.status) && inv.total > inv.paidAmount + 1e-9
      ),
    [invoices]
  );

  const shiftOpen = activeShift !== null && activeShift.closedAt === null;
  const anyBusy =
    refreshing ||
    openShiftSubmitting ||
    closeShiftSubmitting ||
    paySubmitting ||
    refundSubmitting ||
    entriesLoading;

  const invoiceById = React.useMemo(
    () => Object.fromEntries(invoices.map((i) => [i.id, i])),
    [invoices]
  );

  const selectedEntry = React.useMemo(
    () => (selectedEntryId != null ? cashEntries.find((e) => e.id === selectedEntryId) ?? null : null),
    [cashEntries, selectedEntryId]
  );

  React.useEffect(() => {
    if (selectedEntryId == null) return;
    if (!cashEntries.some((e) => e.id === selectedEntryId)) {
      setSelectedEntryId(null);
    }
  }, [cashEntries, selectedEntryId]);

  React.useEffect(() => {
    if (!token || !selectedEntry?.invoiceId) {
      setSelectedInvoiceDetail(null);
      return;
    }
    let cancelled = false;
    setSelectedInvoiceLoading(true);
    void cashDeskApi
      .getInvoiceById(token, selectedEntry.invoiceId)
      .then((inv) => {
        if (!cancelled) setSelectedInvoiceDetail(inv);
      })
      .catch(() => {
        if (!cancelled) setSelectedInvoiceDetail(null);
      })
      .finally(() => {
        if (!cancelled) setSelectedInvoiceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, selectedEntry?.invoiceId]);

  const patientLabel = (patientId: number | null | undefined): string => {
    if (patientId == null) return "—";
    return patientsMap[patientId] ?? `${t("billing.patient")} #${patientId}`;
  };

  const entryPatientLabel = (e: CashRegisterEntry): string => {
    if (e.patientId != null) return patientLabel(e.patientId);
    if (e.invoiceId != null) {
      const inv = invoiceById[e.invoiceId];
      if (inv) return patientLabel(inv.patientId);
    }
    return "—";
  };

  const entryInvoiceLabel = (e: CashRegisterEntry): string => {
    if (e.invoiceId != null) {
      const inv = invoiceById[e.invoiceId];
      return inv ? inv.number : `#${e.invoiceId}`;
    }
    return "—";
  };

  const signedAmount = (e: CashRegisterEntry): number =>
    e.type === "refund" || e.type === "manual_out" ? -e.amount : e.amount;

  const printFromEntry = async (e: CashRegisterEntry) => {
    if (!e.paymentId || !e.invoiceId) {
      setError(t("billing.insufficientDataPrint"));
      return;
    }
    let detail = invoiceById[e.invoiceId];
    let lines: { description: string; amount: number }[] | undefined;
    if (token) {
      try {
        const inv = await cashDeskApi.getInvoiceById(token, e.invoiceId);
        detail = inv;
        lines = inv.items.map((it) => ({
          description: it.description,
          amount: it.lineTotal,
        }));
      } catch {
        /* use summary only */
      }
    }
    const invNum = detail?.number ?? entryInvoiceLabel(e);
    const html = buildReceiptHTML({
      clinicName: resolveReceiptClinicName(detail, clinicName),
      logoUrl: clinic.logoUrl,
      patient: patientLabel(e.patientId ?? detail?.patientId),
      doctor: null,
      invoiceId: invNum,
      date: formatDateTimeRu(e.createdAt),
      paymentMethod: t(METHOD_LABEL[e.method]),
      total: detail?.total ?? e.amount,
      paid: e.amount,
      items:
        lines?.map((line) => ({
          name: line.description,
          price: line.amount,
        })) ?? [],
    });
    printReceipt(html);
  };

  const openPayModal = (inv: InvoiceSummary) => {
    setError(null);
    setPayModalError(null);
    const rem =
      Math.round((inv.total - inv.paidAmount + Number.EPSILON) * 100) / 100;
    setPayAmount(rem > 0 ? rem : 0);
    setPayMethod("cash");
    setPayModalInvoice(inv);
  };

  const submitPayment = async () => {
    if (!token || !canOperate || !payModalInvoice) return;
    const amountToPay = Math.round(payAmount * 100) / 100;
    const maxPay =
      Math.round(
        (payModalInvoice.total - payModalInvoice.paidAmount + Number.EPSILON) * 100
      ) / 100;
    if (!shiftOpen) {
      setPayModalError(t("billing.openShiftFirst"));
      return;
    }
    if (!Number.isFinite(amountToPay) || amountToPay <= 0) {
      setPayModalError(t("billing.enterPositiveAmount"));
      return;
    }
    if (maxPay > 0 && amountToPay > maxPay + 1e-9) {
      setPayModalError(t("billing.amountExceedsBalance", { balance: formatSum(maxPay) }));
      return;
    }
    setPaySubmitting(true);
    setPayModalError(null);
    try {
      await cashDeskApi.createPayment(token, {
        invoiceId: payModalInvoice.id,
        amount: amountToPay,
        method: payMethod,
      });
      // eslint-disable-next-line no-console
      console.log("[cash] payment ok", {
        invoiceId: payModalInvoice.id,
        amount: amountToPay,
        method: payMethod,
      });
      setPayModalInvoice(null);
      await loadCore("refresh");
      await loadEntries();
      setToast(t("billing.paymentAccepted"));
    } catch (requestError) {
      setPayModalError(
        requestError instanceof Error ? requestError.message : t("billing.paymentFailed")
      );
    } finally {
      setPaySubmitting(false);
    }
  };

  const submitOpenShift = async () => {
    if (!token || !canOperate) return;
    const bal = Math.round(openingBalanceInput * 100) / 100;
    if (!Number.isFinite(bal) || bal < 0) {
      setError(t("billing.enterNonNegativeBalance"));
      return;
    }
    setOpenShiftSubmitting(true);
    setError(null);
    try {
      const opened = await cashDeskApi.openShift(token, { openingBalance: bal, notes: null });
      // eslint-disable-next-line no-console
      console.log("[cash] open shift ok", { shiftId: opened.id, openingBalance: bal });
      setModalOpenShift(false);
      setOpeningBalanceInput(0);
      await loadCore("refresh");
      setToast(t("billing.shiftOpened"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("billing.openShiftFailed"));
    } finally {
      setOpenShiftSubmitting(false);
    }
  };

  const submitCloseShift = async () => {
    if (!token || !canOperate || !activeShift) return;
    setCloseShiftSubmitting(true);
    setError(null);
    try {
      const closed = await cashDeskApi.closeCurrentShift(token, {});
      // eslint-disable-next-line no-console
      console.log("[cash] close shift ok", { shiftId: closed.id });
      setModalCloseShift(false);
      await loadCore("refresh");
      setToast(t("billing.shiftClosed"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("billing.closeShiftFailed"));
    } finally {
      setCloseShiftSubmitting(false);
    }
  };

  const refreshSummaryBeforeClose = async () => {
    if (!token) return;
    try {
      const s = await cashDeskApi.getSummaryCurrent(token);
      setCashSummary(s);
      if (!s) {
        setError(t("billing.cannotGetShiftSummary"));
        return;
      }
      setModalCloseShift(true);
    } catch {
      setError(t("billing.cannotGetShiftSummaryRetry"));
    }
  };

  const maxRefundForEntry = (e: CashRegisterEntry): number => {
    const rem = e.paymentRemainingRefundable;
    if (rem != null && Number.isFinite(rem)) return Math.max(0, rem);
    return e.amount;
  };

  const submitRefund = async () => {
    if (!token || !canOperate || !canRefund || !refundEntry?.paymentId) return;
    const r = refundReason.trim();
    if (r.length < 3) {
      setError(t("billing.specifyRefundReason"));
      return;
    }
    const maxAmt = maxRefundForEntry(refundEntry);
    const parsedAmount = Math.round(refundAmountInput * 100) / 100;
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError(t("billing.invalidRefundAmount"));
      return;
    }
    if (parsedAmount > maxAmt + 1e-9) {
      setError(t("billing.invalidRefundAmount"));
      return;
    }
    setRefundSubmitting(true);
    setError(null);
    try {
      await cashDeskApi.refundPayment(token, refundEntry.paymentId, {
        reason: r,
        amount: parsedAmount,
      });
      setRefundEntry(null);
      setRefundReason("");
      setRefundAmountInput(0);
      await loadCore("refresh");
      await loadEntries();
      setToast(t("billing.refundProcessed"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("billing.refundError"));
    } finally {
      setRefundSubmitting(false);
    }
  };

  const maxPayModal =
    payModalInvoice != null
      ? Math.round(
          (payModalInvoice.total - payModalInvoice.paidAmount + Number.EPSILON) * 100
        ) / 100
      : 0;

  const onRefresh = () => void loadCore("refresh", { showDataRefreshedToast: true });

  React.useEffect(() => {
    if (!token || readyAppointments.length === 0) {
      setAppointmentServicesMap({});
      return;
    }
    const fromAppointments = Object.fromEntries(
      readyAppointments.map((row) => [row.id, getAllServices(row).map((s) => s.serviceId)])
    );
    setAppointmentServicesMap(fromAppointments);
  }, [token, readyAppointments]);

  React.useEffect(() => {
    if (user?.role && user.role !== "superadmin") {
      // temporary debug per request
      // eslint-disable-next-line no-console
      console.log(user.role);
    }
  }, [user?.role]);

  const createInvoiceForAppointment = async (appointmentId: number) => {
    if (!token || !canOperate) return;
    setRefreshing(true);
    setError(null);
    try {
      await cashDeskApi.createInvoiceFromAppointment(token, appointmentId);
      await loadCore("refresh");
      await loadEntries();
      setToast(t("billing.invoiceCreated"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("billing.createInvoiceFailed"));
    } finally {
      setRefreshing(false);
    }
  };

  const clearCashDeskData = async () => {
    if (!token || !isSuperadmin) return;
    const confirmed = window.confirm(t("billing.clearAllFinancialDataConfirm"));
    if (!confirmed) return;
    setRefreshing(true);
    setError(null);
    try {
      await cashDeskApi.clearFinancialData(token);
      await loadCore("refresh");
      await loadEntries();
      setToast(t("billing.cashCleared"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("billing.clearCashFailed"));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="min-h-full overflow-x-hidden bg-[#f6f8fb] pb-[110px] text-[#334155] max-md:[&_button]:min-h-[44px] md:pb-0">
      <AppContainer className="max-w-[1400px] space-y-5">
      {/* Верхняя зона */}
      <PageHeader
        title={t("billing.cashDesk")}
        subtitle={t("billing.shiftAndOperations")}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge tone={shiftOpen ? "success" : "neutral"}>
              {shiftOpen ? t("billing.shiftOpen") : t("billing.shiftClosed")}
            </StatusBadge>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void onRefresh()}
              disabled={loading || refreshing || !token}
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? t("billing.refreshing") : t("billing.refresh")}
            </Button>
            {isSuperadmin ? (
              <Button
                type="button"
                variant="secondary"
                className="border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                onClick={() => void clearCashDeskData()}
                disabled={refreshing || loading}
              >
                {t("billing.clearCash")}
              </Button>
            ) : null}
          </div>
        }
      />

      {error && (
        <SectionCard className="border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">
          {error}
        </SectionCard>
      )}
      {toast && (
        <SectionCard className="border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {toast}
        </SectionCard>
      )}
      {loading ? (
        <PageLoader label={t("billing.loadingCash")} />
      ) : (
        <>
          {/* Статус смены — компактно */}
          <SectionCard className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wide text-[#64748b]">
                  {t("billing.currentShift")}
                </p>
                {shiftOpen && activeShift ? (
                  <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-[#334155]">
                    <span className="font-mono text-xs text-[#64748b]">#{activeShift.id}</span>
                    <span>
                      <span className="text-[#64748b]">{t("billing.opened")}:</span>{" "}
                      {formatDateTimeRu(activeShift.openedAt)}
                    </span>
                    <span>
                      <span className="text-[#64748b]">{t("billing.start")}:</span>{" "}
                      {formatSum(activeShift.openingBalance)}
                    </span>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-[#64748b]">
                    {t("billing.noActiveShift")}
                  </p>
                )}
              </div>
              {canOperate && (
                <div className="flex shrink-0 gap-2">
                  {!shiftOpen ? (
                    <Button
                      type="button"
                      className="rounded-xl bg-[#22c55e] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#16a34a]"
                      onClick={() => {
                        setError(null);
                        setOpeningBalanceInput(0);
                        setModalOpenShift(true);
                      }}
                      disabled={anyBusy}
                    >
                      {t("billing.openShift")}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      className="rounded-xl border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                      onClick={() => void refreshSummaryBeforeClose()}
                      disabled={anyBusy}
                    >
                      {t("billing.closeShift")}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </SectionCard>

          {/* Финансовые карточки */}
          {shiftOpen && cashSummary ? (
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <StatCard label={t("billing.cash")} value={formatSum(cashSummary.totalCash)} tone="success" />
              <StatCard label={t("billing.terminal")} value={formatSum(cashSummary.totalCard)} tone="success" />
              <StatCard label={t("billing.totalForShift")} value={formatSum(cashSummary.totalIncome)} tone="success" trend={t("billing.totalIncome")} />
            </section>
          ) : (
            !shiftOpen && (
              <SectionCard className="border-dashed p-6 text-center">
                <Wallet className="mx-auto h-8 w-8 text-[#94a3b8]" />
                <p className="mt-2 text-sm text-[#64748b]">
                  {t("billing.summaryAfterShiftOpen")}
                </p>
              </SectionCard>
            )
          )}

          <div className="grid gap-5 lg:grid-cols-12 lg:items-start">
            <SectionCard className="p-4 lg:col-span-12">
              <h2 className="text-sm font-semibold text-[#0f172a]">{t("billing.awaitingPayment")}</h2>
              <p className="mt-0.5 text-xs text-[#64748b]">
                {t("billing.appointmentsReadyForInvoice")}
              </p>
              {readyAppointments.length === 0 ? (
                <EmptyState
                  title={t("billing.noAppointmentsAwaitingPayment")}
                  subtitle={t("billing.appointmentsAppearsAfterCompletion")}
                />
              ) : (
                <div className="mt-4 space-y-2.5">
                  {readyAppointments.map((row) => {
                    const fallbackServices = (appointmentServicesMap[row.id] ?? []).map((serviceId) => ({
                      serviceId,
                      name: servicesMap[serviceId] ?? `Услуга #${serviceId}`,
                      price: 0,
                    }));
                    const allServices = getAllServices(row, { fallbackServices });
                    const total = allServices.reduce((sum, service) => sum + service.price, 0);
                    return (
                      <article
                        key={row.id}
                        className="rounded-[14px] border border-[#eef2f7] bg-white px-4 py-3.5"
                      >
                        <p className="font-semibold text-[#0f172a]">
                          {patientsMap[row.patientId] ?? `${t("billing.patient")} #${row.patientId}`}
                        </p>
                        <p className="mt-0.5 text-xs text-[#64748b]">
                          {t("billing.doctor")}: {doctorsMap[row.doctorId] ?? `#${row.doctorId}`}
                        </p>
                        <ul className="mt-2 text-sm text-[#334155]">
                          {allServices.map((service) => (
                            <li key={`${row.id}-${service.serviceId}-${service.isBase ? "b" : "a"}`}>
                              {service.name} — {formatSum(service.price)}
                            </li>
                          ))}
                        </ul>
                        <p className="mt-2 text-sm font-semibold text-[#0f172a]">
                          {t("billing.total")}: {formatSum(total)}
                        </p>
                        <div className="mt-3 flex justify-end">
                          <button
                            type="button"
                            className="rounded-xl bg-[#22c55e] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#16a34a] disabled:opacity-50"
                            onClick={() => void createInvoiceForAppointment(row.id)}
                            disabled={!canOperate || refreshing}
                          >
                            {t("billing.createInvoice")}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </SectionCard>

            {/* Неоплаченные счета */}
            <SectionCard className="p-4 lg:col-span-7">
              <h2 className="text-sm font-semibold text-[#0f172a]">{t("billing.unpaidInvoices")}</h2>
              <p className="mt-0.5 text-xs text-[#64748b]">
                {t("billing.balanceDueOnInvoices")}
              </p>
              {payableInvoices.length === 0 ? (
                <EmptyState
                  title={t("billing.noUnpaidInvoices")}
                  subtitle={t("billing.invoicesAppearAfterIssuing")}
                />
              ) : (
                <div className="mt-4 space-y-2.5">
                  {payableInvoices.map((inv) => {
                    const remainder =
                      Math.round((inv.total - inv.paidAmount + Number.EPSILON) * 100) / 100;
                    const hasDebt = remainder > 1e-9;
                    return (
                      <article
                        key={inv.id}
                        className="flex flex-col gap-3 rounded-[14px] border border-[#eef2f7] bg-white px-4 py-3.5 transition-all duration-200 ease hover:bg-[#f8fafc] sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-[#0f172a]">{inv.number}</p>
                          <p className="mt-0.5 truncate text-xs text-[#64748b]">
                            {t("billing.patient")}: {patientsMap[inv.patientId] ?? `ID ${inv.patientId}`}
                          </p>
                          <dl className="mt-2.5 grid gap-1 text-sm sm:max-w-md">
                            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                              <dt className="text-[#64748b]">{t("billing.totalAmount")}</dt>
                              <dd className="tabular-nums font-medium text-[#334155]">
                                {formatSum(inv.total)}
                              </dd>
                            </div>
                            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                              <dt className="text-[#64748b]">{t("billing.paid")}</dt>
                              <dd className="tabular-nums font-medium text-[#334155]">
                                {formatSum(inv.paidAmount)}
                              </dd>
                            </div>
                            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-t border-[#eef2f7] pt-1.5">
                              <dt className="sr-only">{t("billing.balance")}</dt>
                              <dd
                                className={`w-full text-base font-semibold tabular-nums sm:text-left ${
                                  hasDebt ? "text-rose-600" : "text-emerald-600"
                                }`}
                              >
                                {t("billing.balance")}: {formatSum(remainder)}
                              </dd>
                            </div>
                          </dl>
                        </div>

                        <div className="flex shrink-0 justify-end sm:items-center">
                          <button
                            type="button"
                            className="rounded-xl bg-[#22c55e] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(34,197,94,0.3)] transition hover:scale-[1.02] hover:bg-[#16a34a] active:scale-[0.98] disabled:opacity-50"
                            disabled={!canOperate || anyBusy}
                            onClick={() => openPayModal(inv)}
                          >
                            {t("billing.pay")}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </SectionCard>

            {/* Итог смены */}
            <SectionCard className="p-4 lg:col-span-5">
              <h2 className="text-sm font-semibold text-[#0f172a]">{t("billing.shiftSummary")}</h2>
              <p className="mt-0.5 text-xs text-[#64748b]">
                {t("billing.fullShiftSummary")}
              </p>
              {!shiftOpen || !cashSummary ? (
                <p className="mt-6 text-sm text-[#64748b]">{t("billing.openShiftToSeeSummary")}</p>
              ) : (
                <dl className="mt-4 space-y-3 text-sm">
                  {[
                    [t("billing.startBalance"), formatSum(cashSummary.openingBalance)],
                    [t("billing.shiftIncome"), formatSum(cashSummary.totalIncome)],
                    [t("billing.operations"), String(cashSummary.operationsCount)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 border-b border-slate-800/70 pb-2">
                      <dt className="text-[#64748b]">{k}</dt>
                      <dd className="tabular-nums text-[#334155]">{v}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between gap-4 pt-1">
                    <dt className="font-medium text-[#0f172a]">{t("billing.estimatedBalance")}</dt>
                    <dd className="text-lg font-semibold tabular-nums text-[#16a34a]">
                      {formatSum(cashSummary.closingBalancePreview)}
                    </dd>
                  </div>
                </dl>
              )}
            </SectionCard>
          </div>

          {/* История операций — split view */}
          <SectionCard className="overflow-hidden p-0 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
            <div className="border-b border-[#eef2f7] px-5 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-[15px] font-semibold tracking-tight text-[#0f172a]">{t("billing.operations")}</h2>
                  <p className="mt-0.5 text-xs text-[#64748b]">{t("billing.operationsCurrentShiftSelect")}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(
                    [
                      ["all", t("billing.all")],
                      ["today", t("billing.today")],
                      ["yesterday", t("billing.yesterday")],
                      ["last7", t("billing.last7days")],
                      ["custom", t("billing.date")],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                        entryPreset === id
                          ? "bg-[#0f172a] text-white shadow-sm"
                          : "bg-[#f1f5f9] text-[#64748b] hover:bg-[#e2e8f0] hover:text-[#334155]"
                      }`}
                      onClick={() => setEntryPreset(id)}
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="rounded-xl px-3 py-1.5 text-xs text-[#64748b] transition hover:bg-[#f1f5f9]"
                    onClick={() => setEntryPreset("all")}
                  >
                    {t("billing.reset")}
                  </button>
                </div>
              </div>
              {entryPreset === "custom" && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label className="text-xs text-[#64748b]">
                    {t("billing.day")}
                    <input
                      type="date"
                      className="ml-2 rounded-xl border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-sm text-[#334155] shadow-sm"
                      value={customDay}
                      onChange={(e) => setCustomDay(e.target.value)}
                    />
                  </label>
                </div>
              )}
            </div>

            {entriesLoading ? (
              <div className="p-12">
                <PageLoader label={t("billing.loadingOperations")} />
              </div>
            ) : !shiftOpen || cashEntries.length === 0 ? (
              <div className="p-10">
                <EmptyState
                  title={!shiftOpen ? t("billing.shiftClosed") : t("billing.noOperations")}
                  subtitle={
                    !shiftOpen
                      ? t("billing.openShiftToSeeOperations")
                      : t("billing.noMovementsForPeriod")
                  }
                />
              </div>
            ) : (
              <div className="grid gap-0 lg:grid-cols-12 lg:divide-x lg:divide-[#eef2f7]">
                <div className="max-h-[min(560px,70vh)] overflow-y-auto lg:col-span-7">
                  <ul className="divide-y divide-[#eef2f7]">
                    {cashEntries.map((e) => {
                      const isRefundRow = e.type === "refund" || e.type === "manual_out";
                      const isPayment = e.type === "payment";
                      const refunded = Boolean(isPayment && e.isPaymentRefunded);
                      const selected = selectedEntryId === e.id;
                      return (
                        <li key={e.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedEntryId(e.id)}
                            className={`flex w-full items-start gap-3 px-4 py-3.5 text-left transition ${
                              selected
                                ? "bg-[#ecfdf5] ring-2 ring-inset ring-[#22c55e]/35"
                                : isRefundRow
                                  ? "bg-rose-50/80 hover:bg-rose-50"
                                  : "hover:bg-[#f8fafc]"
                            } active:scale-[0.995]`}
                          >
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[11px] tabular-nums text-[#64748b]">
                                  {formatDateTimeRu(e.createdAt)}
                                </span>
                                <span
                                  className={`inline-flex rounded-lg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                    isRefundRow ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-700"
                                  }`}
                                >
                                  {t(ENTRY_TYPE_LABEL[e.type])}
                                </span>
                                {refunded ? (
                                  <span className="text-[10px] font-medium text-[#64748b]">{t("billing.refundedText")}</span>
                                ) : null}
                              </div>
                              <p className="truncate text-sm font-medium text-[#0f172a]">{entryPatientLabel(e)}</p>
                              <p className="text-xs text-[#64748b]">
                                {entryInvoiceLabel(e)} · {t(METHOD_LABEL[e.method])}
                              </p>
                            </div>
                            <div
                              className={`shrink-0 text-right text-sm font-semibold tabular-nums ${
                                signedAmount(e) < 0 ? "text-rose-700" : "text-emerald-600"
                              }`}
                            >
                              {signedAmount(e) < 0 ? "−" : ""}
                              {formatSum(Math.abs(signedAmount(e)))}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <aside className="flex flex-col bg-[#fafbfc] lg:col-span-5 lg:max-h-[min(560px,70vh)] lg:overflow-y-auto">
                  <div className="sticky top-0 z-10 border-b border-[#eef2f7] bg-[#fafbfc]/95 px-5 py-3 backdrop-blur-sm">
                    <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[#64748b]">
                      <PanelRight className="h-4 w-4" aria-hidden />
                      {t("billing.operationDetails")}
                    </p>
                  </div>

                  <div className="flex flex-1 flex-col p-5">
                    {!selectedEntry ? (
                      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-[0_4px_14px_rgba(15,23,42,0.08)] ring-1 ring-[#e2e8f0]">
                          <Inbox className="h-7 w-7 text-[#94a3b8]" aria-hidden />
                        </div>
                        <p className="text-sm font-medium text-[#334155]">{t("billing.selectOperation")}</p>
                        <p className="max-w-[240px] text-xs leading-relaxed text-[#64748b]">
                          {t("billing.clickRowToSeeDetails")}
                        </p>
                      </div>
                    ) : selectedInvoiceLoading && selectedEntry.invoiceId ? (
                      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20">
                        <Loader2 className="h-8 w-8 animate-spin text-[#22c55e]" aria-hidden />
                        <p className="text-xs text-[#64748b]">{t("billing.loadingInvoice")}</p>
                      </div>
                    ) : (
                      <>
                        <dl className="space-y-3 text-sm">
                          <div className="flex justify-between gap-4">
                            <dt className="text-[#64748b]">{t("billing.patient")}</dt>
                            <dd className="max-w-[60%] text-right font-medium text-[#0f172a]">
                              {entryPatientLabel(selectedEntry)}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-4">
                            <dt className="text-[#64748b]">{t("billing.invoice")}</dt>
                            <dd className="font-mono text-[#0f172a]">{entryInvoiceLabel(selectedEntry)}</dd>
                          </div>
                          <div className="flex justify-between gap-4">
                            <dt className="text-[#64748b]">{t("billing.date")}</dt>
                            <dd className="tabular-nums text-[#334155]">{formatDateTimeRu(selectedEntry.createdAt)}</dd>
                          </div>
                          <div className="flex justify-between gap-4">
                            <dt className="text-[#64748b]">{t("billing.method")}</dt>
                            <dd>
                              <span className="inline-flex rounded-full border border-[#e2e8f0] bg-white px-2.5 py-0.5 text-xs font-medium text-[#334155] shadow-sm">
                                {t(METHOD_LABEL[selectedEntry.method])}
                              </span>
                            </dd>
                          </div>
                          <div className="flex justify-between gap-4">
                            <dt className="text-[#64748b]">{t("billing.type")}</dt>
                            <dd className="font-medium text-[#334155]">{t(ENTRY_TYPE_LABEL[selectedEntry.type])}</dd>
                          </div>
                        </dl>

                        {selectedInvoiceDetail && selectedInvoiceDetail.items.length > 0 ? (
                          <div className="mt-6">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#64748b]">{t("billing.services")}</p>
                            <ul className="mt-2 space-y-2 rounded-xl border border-[#e2e8f0] bg-white p-3 shadow-sm">
                              {selectedInvoiceDetail.items.map((row) => (
                                <li
                                  key={row.id}
                                  className="flex items-start justify-between gap-3 text-sm"
                                >
                                  <span className="leading-snug text-[#334155]">{row.description}</span>
                                  <span className="shrink-0 font-medium tabular-nums text-[#0f172a]">
                                    {formatSum(row.lineTotal)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        <div className="mt-6 rounded-2xl border border-emerald-200/80 bg-gradient-to-b from-emerald-50/90 to-white px-4 py-4 shadow-[0_8px_30px_-12px_rgba(22,163,74,0.35)]">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800/80">
                            {t("billing.operationAmount")}
                          </p>
                          <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-emerald-600">
                            {signedAmount(selectedEntry) < 0 ? "−" : ""}
                            {formatSum(Math.abs(signedAmount(selectedEntry)))}
                          </p>
                          {selectedInvoiceDetail ? (
                            <p className="mt-2 text-xs text-[#64748b]">
                              {t("billing.byInvoice")}: {formatSum(selectedInvoiceDetail.total)} · {t("billing.paid")}{" "}
                              {formatSum(selectedInvoiceDetail.paidAmount)}
                            </p>
                          ) : null}
                        </div>

                        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                          {(() => {
                            const inv =
                              selectedInvoiceDetail ??
                              (selectedEntry.invoiceId != null ? invoiceById[selectedEntry.invoiceId] : undefined);
                            const canPayRemaining =
                              inv &&
                              PAYABLE_STATUSES.has(inv.status) &&
                              inv.total > inv.paidAmount + 1e-9;
                            return canPayRemaining ? (
                              <button
                                type="button"
                                className="inline-flex flex-1 items-center justify-center rounded-xl bg-[#22c55e] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(34,197,94,0.35)] transition hover:scale-[1.02] hover:bg-[#16a34a] active:scale-[0.98] disabled:opacity-50"
                                disabled={!canOperate || anyBusy || !shiftOpen}
                                onClick={() => inv && openPayModal(inv)}
                              >
                                {t("billing.pay")}
                              </button>
                            ) : null;
                          })()}
                          <button
                            type="button"
                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#334155] shadow-sm transition hover:scale-[1.02] hover:bg-[#f8fafc] active:scale-[0.98] disabled:opacity-40"
                            disabled={!selectedEntry.paymentId}
                            onClick={() => void printFromEntry(selectedEntry)}
                          >
                            <Printer className="h-4 w-4" />
                            {t("billing.print")}
                          </button>
                          {canOperate &&
                          canRefund &&
                          selectedEntry.type === "payment" &&
                          selectedEntry.paymentId &&
                          !selectedEntry.isPaymentRefunded &&
                          shiftOpen ? (
                            <button
                              type="button"
                              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-800 shadow-sm transition hover:scale-[1.02] hover:bg-rose-100 active:scale-[0.98]"
                              onClick={() => {
                                setRefundReason("");
                                const max = maxRefundForEntry(selectedEntry);
                                setRefundAmountInput(max > 0 ? max : 0);
                                setRefundEntry(selectedEntry);
                              }}
                            >
                              <RotateCcw className="h-4 w-4" />
                              {t("billing.returnPayment")}
                            </button>
                          ) : null}
                        </div>
                      </>
                    )}
                  </div>
                </aside>
              </div>
            )}
          </SectionCard>

          {/* Недавние смены */}
          <SectionCard className="p-4">
            <h2 className="text-sm font-semibold text-[#0f172a]">{t("billing.recentShifts")}</h2>
            {shiftHistory.length === 0 ? (
              <p className="mt-3 text-sm text-[#64748b]">{t("billing.noPreviousShifts")}</p>
            ) : (
              <div className="mt-3 space-y-2.5">
                {shiftHistory.slice(0, 5).map((s) => (
                  <article
                    key={s.id}
                    className="cursor-pointer rounded-[14px] border border-[#eef2f7] bg-white px-4 py-3.5 transition-all duration-200 ease hover:bg-[#f8fafc]"
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/billing/cash-desk/shifts/${s.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        navigate(`/billing/cash-desk/shifts/${s.id}`);
                      }
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-[170px] flex-1">
                        <p className="font-semibold text-[#0f172a]">{t("billing.shift")} #{s.id}</p>
                        <p className="mt-0.5 text-[13px] text-[#64748b]">
                          {t("billing.opened")}: {formatDateTimeRu(s.openedAt)}
                        </p>
                      </div>

                      <div className="min-w-[170px] flex-1">
                        <p className="text-[13px] text-[#64748b]">
                          {t("billing.closed")}: {s.closedAt ? formatDateTimeRu(s.closedAt) : t("billing.notClosed")}
                        </p>
                      </div>

                      <div className="min-w-[180px] flex-1 text-[13px]">
                        <p className="text-[#64748b]">
                          {t("billing.start")}: <span className="font-medium text-[#334155]">{formatSum(s.openingBalance)}</span>
                        </p>
                        <p className="mt-0.5 text-[#64748b]">
                          {t("billing.total")}:{" "}
                          <span className="font-medium text-[#334155]">
                            {s.closingBalance != null ? formatSum(s.closingBalance) : "—"}
                          </span>
                        </p>
                      </div>

                      <div className="ml-auto">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-[12px] font-medium ${
                            s.closedAt
                              ? "bg-[#f1f5f9] text-[#475569]"
                              : "bg-[#dcfce7] text-[#166534]"
                          }`}
                        >
                          {s.closedAt ? t("billing.shiftClosedStatus") : t("billing.shiftOpenStatus")}
                        </span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </SectionCard>
        </>
      )}

      {/* Модалки (portal → document.body, z-[9999]) */}
      <ModalShell
        isOpen={modalOpenShift}
        onClose={() => {
          if (!openShiftSubmitting) setModalOpenShift(false);
        }}
        title={t("billing.openShift")}
        subtitle={t("billing.specifyOpeningBalance")}
        maxWidthClassName="max-w-md"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpenShift(false)} disabled={openShiftSubmitting}>
              {t("billing.cancel")}
            </Button>
            <Button type="button" onClick={() => void submitOpenShift()} disabled={openShiftSubmitting}>
              {openShiftSubmitting ? t("billing.opening") : t("billing.openShift")}
            </Button>
          </div>
        }
      >
        <FormField label={t("billing.startingBalance")}>
          <MoneyInput
            mode="decimal"
            min={0}
            className="mt-1.5 w-full rounded-xl border border-[#e2e8f0] bg-white px-3 py-2 text-[#334155]"
            value={openingBalanceInput}
            onChange={setOpeningBalanceInput}
            disabled={openShiftSubmitting}
          />
        </FormField>
      </ModalShell>

      <ModalShell
        isOpen={modalCloseShift && Boolean(cashSummary)}
        onClose={() => {
          if (!closeShiftSubmitting) setModalCloseShift(false);
        }}
        title={t("billing.closeShift")}
        subtitle={t("billing.checkTotalsBalanceCalculated")}
        maxWidthClassName="max-w-lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalCloseShift(false)} disabled={closeShiftSubmitting}>
              {t("billing.cancel")}
            </Button>
            <Button type="button" variant="secondary" className="border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100" onClick={() => void submitCloseShift()} disabled={closeShiftSubmitting}>
              {closeShiftSubmitting ? t("billing.closing") : t("billing.closeShift")}
            </Button>
          </div>
        }
      >
        {cashSummary ? (
          <>
            <dl className="space-y-2 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-[#64748b]">{t("billing.start")}</dt>
                <dd>{formatSum(cashSummary.openingBalance)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#64748b]">{t("billing.cash")}</dt>
                <dd>{formatSum(cashSummary.totalCash)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#64748b]">{t("billing.terminal")}</dt>
                <dd>{formatSum(cashSummary.totalCard)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#64748b]">{t("billing.operations")}</dt>
                <dd>{cashSummary.operationsCount}</dd>
              </div>
              <div className="flex justify-between border-t border-[#e2e8f0] pt-2 font-medium">
                <dt className="text-[#0f172a]">{t("billing.estimatedBalance")}</dt>
                <dd className="text-[#16a34a]">{formatSum(cashSummary.closingBalancePreview)}</dd>
              </div>
            </dl>
          </>
        ) : null}
      </ModalShell>

      <ModalShell
        isOpen={payModalInvoice != null}
        onClose={() => {
          if (!paySubmitting) {
            setPayModalInvoice(null);
            setPayModalError(null);
          }
        }}
        title={t("billing.paymentInvoice")}
        subtitle={
          payModalInvoice
            ? `${patientLabel(payModalInvoice.patientId)} · ${payModalInvoice.number}`
            : undefined
        }
        maxWidthClassName="max-w-md"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setPayModalInvoice(null);
                setPayModalError(null);
              }}
              disabled={paySubmitting}
            >
              {t("billing.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void submitPayment()}
              disabled={paySubmitting || !shiftOpen || maxPayModal <= 0}
            >
              {paySubmitting ? t("billing.accepting") : t("billing.acceptPayment")}
            </Button>
          </div>
        }
      >
        {payModalInvoice ? (
          <>
            <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-[#64748b]">{t("billing.amountDue")}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-[#16a34a]">
                {formatSum(maxPayModal)}
              </p>
            </div>

            {!shiftOpen ? (
              <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {t("billing.openShiftToAcceptPayment")}
              </p>
            ) : null}

            <FormField label={t("billing.amount")}>
              <MoneyInput
                mode="decimal"
                min={0}
                max={maxPayModal > 0 ? maxPayModal : undefined}
                className="mt-1.5 w-full rounded-xl border border-[#e2e8f0] bg-white px-3 py-2.5 text-base text-[#111827] placeholder:text-[#94a3b8] focus:border-[#16a34a] focus:outline-none focus:ring-1 focus:ring-[#16a34a]"
                value={payAmount}
                onChange={setPayAmount}
                disabled={paySubmitting}
              />
              {maxPayModal > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-1.5 text-xs font-medium text-[#334155] transition hover:bg-[#f1f5f9] disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={paySubmitting || !shiftOpen}
                    onClick={() => {
                      setPayModalError(null);
                      setPayAmount(maxPayModal);
                    }}
                  >
                    {t("billing.payFully")}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-1.5 text-xs font-medium text-[#334155] transition hover:bg-[#f1f5f9] disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={paySubmitting || !shiftOpen}
                    onClick={() => {
                      setPayModalError(null);
                      const half = Math.round((maxPayModal / 2) * 100) / 100;
                      setPayAmount(half);
                    }}
                  >
                    50%
                  </button>
                </div>
              ) : null}
            </FormField>

            <FormField label={t("billing.paymentMethod")}>
              <select
                className="mt-1.5 w-full rounded-xl border border-[#e2e8f0] bg-white px-3 py-2.5 text-[#111827] focus:border-[#16a34a] focus:outline-none focus:ring-1 focus:ring-[#16a34a]"
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                disabled={paySubmitting}
              >
                <option value="cash">{t(METHOD_LABEL.cash)}</option>
                <option value="card">{t(METHOD_LABEL.card)}</option>
              </select>
            </FormField>

            {payModalError ? (
              <div
                className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
                role="alert"
              >
                {payModalError}
              </div>
            ) : null}
          </>
        ) : null}
      </ModalShell>

      <RefundModal
        open={refundEntry !== null}
        entry={refundEntry}
        invoiceLabel={refundEntry ? entryInvoiceLabel(refundEntry) : "—"}
        maxRefundable={refundEntry ? maxRefundForEntry(refundEntry) : 0}
        amount={refundAmountInput}
        reason={refundReason}
        submitting={refundSubmitting}
        onAmountChange={setRefundAmountInput}
        onReasonChange={setRefundReason}
        onClose={() => {
          setRefundEntry(null);
          setRefundAmountInput(0);
        }}
        onConfirm={() => void submitRefund()}
      />
      </AppContainer>
    </div>
  );
};
