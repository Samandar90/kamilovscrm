import React, { useEffect, useState } from "react";
import { Modal } from "../../../components/ui/Modal";
import {
  cashDeskApi,
  type InvoiceStatus,
  type Payment,
  type PaymentMethod,
} from "../api/cashDeskApi";
import { formatSum } from "../../../utils/formatMoney";
import { MoneyInput } from "../../../shared/ui/MoneyInput";

const METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Наличные" },
  { value: "card", label: "Терминал" },
];

type Props = {
  open: boolean;
  onClose: () => void;
  token: string | null;
  invoiceId: number;
  /** Максимум к оплате (остаток по счёту) */
  maxAmount: number;
  invoiceStatus: InvoiceStatus;
  initialMethod?: PaymentMethod;
  onPaid: (payment: Payment) => void | Promise<void>;
};

const inputClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500";

export const PaymentModal: React.FC<Props> = ({
  open,
  onClose,
  token,
  invoiceId,
  maxAmount,
  invoiceStatus,
  initialMethod = "cash",
  onPaid,
}) => {
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [checkingShift, setCheckingShift] = useState(false);

  useEffect(() => {
    if (!open || !token) return;
    setError(null);
    setSubmitting(false);
    setMethod(initialMethod);
    setAmount(maxAmount > 0 ? Math.round(maxAmount * 100) / 100 : 0);
    setCheckingShift(true);
    void cashDeskApi
      .getCurrentShift(token)
      .then((shift) => {
        setShiftOpen(shift != null && shift.closedAt == null);
      })
      .catch(() => setShiftOpen(false))
      .finally(() => setCheckingShift(false));
  }, [open, maxAmount, token, initialMethod]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError("Нет авторизации");
      return;
    }
    const value = Math.round(amount * 100) / 100;
    if (!Number.isFinite(value) || value <= 0) {
      setError("Введите сумму больше 0");
      return;
    }
    if (!shiftOpen) {
      setError("Сначала откройте кассовую смену");
      return;
    }
    if (value > maxAmount + 0.0001) {
      setError(`Сумма не может превышать остаток (${formatSum(maxAmount)})`);
      return;
    }

    setSubmitting(true);
    try {
      const createdPayment = await cashDeskApi.createPayment(token, {
        invoiceId,
        amount: value,
        method,
      });
      await onPaid(createdPayment);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось провести оплату");
    } finally {
      setSubmitting(false);
    }
  };

  const draftBlocked = invoiceStatus === "draft";
  const noShiftBlocked = !checkingShift && !shiftOpen;
  const canSubmit =
    !draftBlocked && !noShiftBlocked && maxAmount > 0 && !submitting && !checkingShift;

  return (
    <Modal
      isOpen={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-xl"
    >
      <h2 className="text-lg font-semibold text-slate-50">Оплата счёта</h2>
      <p className="mt-1 text-sm text-slate-400">
        Доступно к оплате: <span className="font-medium text-amber-200">{formatSum(maxAmount)}</span>
      </p>

      {checkingShift ? (
        <p className="mt-4 text-sm text-slate-400">Проверка кассовой смены…</p>
      ) : null}

      {draftBlocked ? (
        <p className="mt-4 rounded-md border border-amber-800 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
          Черновик нельзя оплатить — сначала выставьте счёт (статус «Выставлен»).
        </p>
      ) : null}

      {!draftBlocked && !checkingShift && noShiftBlocked ? (
        <p className="mt-4 rounded-md border border-rose-900 bg-rose-950/50 px-3 py-2 text-sm text-rose-200">
          Сначала откройте кассовую смену на странице «Касса».
        </p>
      ) : null}

      <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-4">
        <div>
          <label htmlFor="payment-amount" className="text-sm font-medium text-slate-300">
            Сумма
          </label>
          <MoneyInput
            id="payment-amount"
            mode="decimal"
            min={0}
            max={maxAmount > 0 ? maxAmount : undefined}
            className={inputClass}
            value={amount}
            onChange={setAmount}
            disabled={submitting || draftBlocked || noShiftBlocked || checkingShift}
          />
          {maxAmount > 0 && !draftBlocked ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-md border border-slate-600 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-sky-600/60 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={submitting || noShiftBlocked || checkingShift}
                onClick={() => {
                  setError(null);
                  setAmount(Math.round(maxAmount * 100) / 100);
                }}
              >
                Оплатить полностью
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-600 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-sky-600/60 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={submitting || noShiftBlocked || checkingShift}
                onClick={() => {
                  setError(null);
                  const half = Math.round((maxAmount / 2) * 100) / 100;
                  setAmount(half);
                }}
              >
                50%
              </button>
            </div>
          ) : null}
        </div>
        <div>
          <label htmlFor="payment-method" className="text-sm font-medium text-slate-300">
            Метод оплаты
          </label>
          <select
            id="payment-method"
            className={inputClass}
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            disabled={submitting || draftBlocked || noShiftBlocked || checkingShift}
          >
            {METHOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {error ? (
          <div className="rounded-md border border-rose-900 bg-rose-950/50 px-3 py-2 text-sm text-rose-200" role="alert">
            {error}
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            onClick={onClose}
            disabled={submitting}
          >
            Отмена
          </button>
          <button
            type="submit"
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canSubmit}
          >
            {submitting ? "Проводим…" : "Оплатить"}
          </button>
        </div>
      </form>
    </Modal>
  );
};
