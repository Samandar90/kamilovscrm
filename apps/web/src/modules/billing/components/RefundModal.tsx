import React from "react";
import { useTranslation } from "react-i18next";
import type { CashRegisterEntry } from "../api/cashDeskApi";
import { formatSum } from "../../../utils/formatMoney";
import { Modal } from "../../../components/ui/Modal";
import { MoneyInput } from "../../../shared/ui/MoneyInput";

type Props = {
  open: boolean;
  entry: CashRegisterEntry | null;
  invoiceLabel: string;
  /** Максимум к возврату по этой операции */
  maxRefundable: number;
  amount: number;
  reason: string;
  submitting: boolean;
  onAmountChange: (value: number) => void;
  onReasonChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
};

export const RefundModal: React.FC<Props> = ({
  open,
  entry,
  invoiceLabel,
  maxRefundable,
  amount,
  reason,
  submitting,
  onAmountChange,
  onReasonChange,
  onClose,
  onConfirm,
}) => {
  const { t } = useTranslation();
  return (
    <Modal
      isOpen={open && Boolean(entry)}
      onClose={onClose}
      className="w-full max-w-md rounded-2xl border border-[#eef2f7] bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.04)]"
    >
      {entry ? (
        <>
          <h3 id="refund-modal-title" className="text-lg font-semibold text-[#0f172a]">
            {t("billing.refundTitle")}
          </h3>
          <p className="mt-1 text-sm text-[#64748b]">
            {t("billing.refundDescription")}
          </p>
          <p className="mt-3 text-sm text-[#334155]">
            {t("billing.invoiceLabel")} <span className="font-mono">{invoiceLabel}</span>
            {entry.paymentId != null ? (
              <>
                {" "}
                · {t("billing.paymentPrefix")} #{entry.paymentId} · {t("billing.max")} {formatSum(maxRefundable)}
              </>
            ) : null}
          </p>
          <label className="mt-4 block text-sm text-[#334155]">
            {t("billing.refundAmountLabel")}
            <MoneyInput
              mode="decimal"
              max={maxRefundable}
              min={0}
              className="mt-1.5 w-full rounded-xl border border-[#e2e8f0] bg-white px-3 py-2 text-[#334155]"
              value={amount}
              onChange={onAmountChange}
              disabled={submitting}
            />
          </label>
          <label className="mt-3 block text-sm text-[#334155]">
            {t("billing.refundReasonLabel")}
            <textarea
              className="mt-1.5 w-full rounded-xl border border-[#e2e8f0] bg-white px-3 py-2 text-sm text-[#334155]"
              rows={3}
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              disabled={submitting}
              placeholder={t("billing.refundReasonPlaceholder")}
            />
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-xl px-4 py-2 text-sm text-[#64748b] hover:bg-[#f1f5f9]"
              onClick={onClose}
              disabled={submitting}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
              onClick={onConfirm}
              disabled={submitting}
            >
              {submitting ? t("billing.refundProcessing") : t("billing.confirmRefund")}
            </button>
          </div>
        </>
      ) : null}
    </Modal>
  );
};
