import React from "react";
import { Link, Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Building2, Eye, EyeOff, Lock, User } from "lucide-react";
import { authApi } from "../../../api/authApi";
import { useAuth } from "../../../auth/AuthContext";
import { Logo } from "../../../shared/ui/Logo";
import { BRANDING } from "../../../shared/config/branding";
import { useClinic } from "../../../hooks/useClinic";

const TOKEN_KEY = "crm_access_token";

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

export const RegisterPage: React.FC = () => {
  const { isAuthenticated, clearError } = useAuth();
  const { clinic } = useClinic();
  const brandName = clinic.name || BRANDING.productName;

  const [clinicName, setClinicName] = React.useState("");
  const [clinicSlug, setClinicSlug] = React.useState("");
  const [fullName, setFullName] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  React.useEffect(() => {
    document.title = `${brandName} — Регистрация`;
  }, [brandName]);

  const canSubmit = Boolean(
    clinicName.trim() &&
      clinicSlug.trim() &&
      fullName.trim() &&
      username.trim() &&
      password.trim().length >= 6
  );

  const onClinicNameChange = (value: string) => {
    setClinicName(value);
    setError(null);
    clearError();
    setClinicSlug((prev) => (prev.trim() === "" ? slugify(value) : prev));
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const payload = await authApi.onboarding({
        clinicName: clinicName.trim(),
        clinicSlug: clinicSlug.trim(),
        fullName: fullName.trim(),
        username: username.trim(),
        password,
      });

      if (!payload.token) {
        throw new Error("Токен не получен");
      }

      sessionStorage.setItem(TOKEN_KEY, payload.token);
      localStorage.removeItem(TOKEN_KEY);
      window.location.assign("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать клинику");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-[#F8FAFC] to-[#EEF2F7] px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_circle_at_20%_10%,rgba(99,102,241,0.10),transparent_48%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(560px_circle_at_80%_18%,rgba(56,189,248,0.08),transparent_48%)]" />
      <div className="relative z-10 w-full max-w-[460px]">
        <div className="mb-7 flex flex-col items-center text-center">
          <Logo size={64} className="justify-center" />
          <h1 className="mt-4 text-[30px] font-bold leading-tight tracking-tight text-[#111827]">
            {brandName}
          </h1>
          <p className="mt-1 text-sm text-slate-500">Создайте клинику и начните работу</p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="rounded-2xl border border-[#E5E7EB] bg-white p-8 shadow-[0_12px_28px_rgba(15,23,42,0.08)]"
        >
          <h2 className="mb-1 text-[26px] font-semibold leading-tight text-[#111827]">
            Регистрация клиники
          </h2>
          <p className="mb-5 text-sm text-gray-500">Один шаг до запуска вашей CRM</p>

          <form className="space-y-4" onSubmit={onSubmit} noValidate aria-busy={isSubmitting}>
            <div className="relative">
              <Building2 className="absolute left-3 top-[15px] text-gray-400" size={18} />
              <input
                value={clinicName}
                onChange={(e) => onClinicNameChange(e.target.value)}
                autoFocus
                className="h-12 w-full rounded-xl border border-[#E5E7EB] bg-white pl-10 pr-4 outline-none transition focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/10"
                placeholder="Название клиники"
              />
            </div>

            <div className="relative">
              <Building2 className="absolute left-3 top-[15px] text-gray-400" size={18} />
              <input
                value={clinicSlug}
                onChange={(e) => {
                  setClinicSlug(slugify(e.target.value));
                  setError(null);
                }}
                className="h-12 w-full rounded-xl border border-[#E5E7EB] bg-white pl-10 pr-4 outline-none transition focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/10"
                placeholder="Slug (например, kamilovs-clinic)"
              />
            </div>

            <div className="relative">
              <User className="absolute left-3 top-[15px] text-gray-400" size={18} />
              <input
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  setError(null);
                }}
                className="h-12 w-full rounded-xl border border-[#E5E7EB] bg-white pl-10 pr-4 outline-none transition focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/10"
                placeholder="Ваше имя"
              />
            </div>

            <div className="relative">
              <User className="absolute left-3 top-[15px] text-gray-400" size={18} />
              <input
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setError(null);
                }}
                autoComplete="username"
                className="h-12 w-full rounded-xl border border-[#E5E7EB] bg-white pl-10 pr-4 outline-none transition focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/10"
                placeholder="Логин"
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-3 top-[15px] text-gray-400" size={18} />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                autoComplete="new-password"
                className="h-12 w-full rounded-xl border border-[#E5E7EB] bg-white pl-10 pr-10 outline-none transition focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/10"
                placeholder="Пароль (минимум 6 символов)"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-gray-400 transition-colors duration-200 hover:text-gray-600"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {error ? (
              <div
                className="rounded-xl border border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.08)] px-3.5 py-2.5 text-sm text-[#DC2626]"
                role="alert"
                aria-live="polite"
              >
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting || !canSubmit}
              className="h-12 w-full rounded-xl bg-[#2563EB] font-medium text-white transition hover:bg-[#1D4ED8] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Создаём..." : "Создать клинику"}
            </button>

            <p className="text-center text-sm text-slate-500">
              Уже есть аккаунт?{" "}
              <Link
                to="/login"
                className="font-medium text-[#2563EB] transition-colors hover:text-[#1D4ED8]"
              >
                Войти
              </Link>
            </p>
          </form>
        </motion.div>
      </div>
    </div>
  );
};

export default RegisterPage;
