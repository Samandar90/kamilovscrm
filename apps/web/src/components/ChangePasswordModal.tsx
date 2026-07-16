import React from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { changePassword } from "../api/userApi";

type ChangePasswordModalProps = {
  open: boolean;
  onClose: () => void;
};

export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!currentPassword || !newPassword) {
      setError(t("forms.required"));
      return;
    }

    if (newPassword.length < 6) {
      setError(t("forms.passwordTooShort"));
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t("forms.passwordMismatch"));
      return;
    }

    setLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => {
        onClose();
        setSuccess(false);
      }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("errors.serverError"));
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-900">{t("auth.changePassword")}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 hover:bg-slate-100"
          >
            <X size={20} className="text-slate-500" />
          </button>
        </div>

        {success ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            ✓ {t("auth.passwordChanged")}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                {t("auth.currentPassword")}
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                placeholder="••••••"
                disabled={loading}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                {t("auth.newPassword")}
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                placeholder="••••••"
                disabled={loading}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                {t("forms.confirmPasswordLabel")}
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                placeholder="••••••"
                disabled={loading}
              />
            </div>

            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-primary-700 disabled:opacity-50"
              >
                {loading ? `${t("common.save")}…` : t("common.save")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
