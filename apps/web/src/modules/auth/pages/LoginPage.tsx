import React, { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Eye, EyeOff, Lock, User } from "lucide-react";
import { useAuth } from "../../../auth/AuthContext";
import { Logo } from "../../../shared/ui/Logo";
import { BRANDING } from "../../../shared/config/branding";
import { useClinic } from "../../../hooks/useClinic";
const SECRET_CODE = "$2a$12$jgquu23kFyO2RgaE3QZnt.za2rxPAk34cmg2Y2KhO0BCPoGm6HFry";

const mapLoginApiError = (message: string, wrongCredentialsMsg: string): string => {
  if (message === wrongCredentialsMsg) return message;
  const m = message.toLowerCase().trim();
  if (
    m.includes("invalid credentials") ||
    m.includes("invalid username") ||
    m.includes("wrong password") ||
    m.includes("incorrect password") ||
    m.includes("unauthorized") ||
    (m.includes("неверн") && (m.includes("логин") || m.includes("парол")))
  ) {
    return wrongCredentialsMsg;
  }
  return message;
};

export const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const { login, isAuthenticated, isLoading, error, clearError } = useAuth();
  const { clinic } = useClinic();
  const brandName = clinic.name || BRANDING.productName;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [show, setShow] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [isAllowed, setIsAllowed] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const lastSubmitAtRef = React.useRef(0);

  React.useEffect(() => {
    document.title = `${brandName} — ${t("auth.login")}`;
  }, [brandName, t]);

  React.useEffect(() => {
    if (accessCode === SECRET_CODE) {
      setIsAllowed(true);
    } else {
      setIsAllowed(false);
    }
  }, [accessCode]);

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const canSubmit = Boolean(username.trim() && password.trim());

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const now = Date.now();
    if (now - lastSubmitAtRef.current < 700) return;
    lastSubmitAtRef.current = now;
    if (!username.trim() || !password.trim()) {
      setFormError(t("forms.required"));
      return;
    }
    setFormError(null);
    clearError();
    await login(username.trim(), password, rememberMe);
  };

  const displayError = formError ?? (error ? mapLoginApiError(error, t("auth.loginError")) : null);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-[#F8FAFC] to-[#EEF2F7] px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_circle_at_20%_10%,rgba(99,102,241,0.10),transparent_48%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(560px_circle_at_80%_18%,rgba(56,189,248,0.08),transparent_48%)]" />
      <div className="relative z-10 w-full max-w-[420px]">
        <div className="mb-7 flex flex-col items-center text-center">
          <Logo size={64} className="justify-center" />
          <h1 className="mt-4 text-[30px] font-bold leading-tight tracking-tight text-[#111827]">
            {brandName}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{BRANDING.productTagline}</p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="rounded-2xl border border-[#E5E7EB] bg-white p-8 shadow-[0_12px_28px_rgba(15,23,42,0.08)]"
        >
          <h2 className="mb-1 text-[26px] leading-tight font-semibold text-[#111827]">
            {t("auth.login")}
          </h2>
          <p className="mb-5 text-sm text-gray-500">
            {t("auth.enterPassword")}
          </p>

          <form className="space-y-4" onSubmit={onSubmit} noValidate aria-busy={isLoading}>
            <div className="relative">
              <User className="absolute left-3 top-[15px] text-gray-400" size={18} />
              <input
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setFormError(null);
                  clearError();
                }}
                autoFocus
                autoComplete="username"
                className="h-12 w-full rounded-xl border border-[#E5E7EB] bg-white pl-10 pr-4 outline-none transition focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/10"
                placeholder={t("auth.enterUsername")}
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-3 top-[15px] text-gray-400" size={18} />
              <input
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setFormError(null);
                  clearError();
                }}
                autoComplete="current-password"
                className="crm-login-password-field h-12 w-full rounded-xl border border-[#E5E7EB] bg-white pl-10 pr-10 outline-none transition focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/10"
                placeholder={t("auth.enterPassword")}
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-gray-400 transition-colors duration-200 hover:text-gray-600"
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB]/20"
              />
              {t("auth.rememberMe")}
            </label>

            {displayError ? (
              <motion.div
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: [0, -4, 4, -3, 3, 0] }}
                transition={{ duration: 0.36 }}
                className="rounded-xl border border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.08)] px-3.5 py-2.5 text-sm text-[#DC2626]"
                role="alert"
                aria-live="polite"
              >
                {displayError}
              </motion.div>
            ) : null}

            <button
              type="submit"
              disabled={isLoading || !canSubmit}
              className="h-12 w-full rounded-xl bg-[#2563EB] text-white font-medium transition hover:bg-[#1D4ED8] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? `${t("auth.login")}...` : t("auth.login")}
            </button>

            <div className="space-y-2 pt-1">
              <input
                type="text"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                autoComplete="off"
                className="h-10 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm outline-none transition focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/10"
                placeholder="Access Code"
              />

              {isAllowed ? (
                <p className="text-center text-sm text-slate-500">
                  {t("auth.noAccount")}{" "}
                  <Link
                    to="/register"
                    className="font-medium text-[#2563EB] transition-colors hover:text-[#1D4ED8]"
                  >
                    {t("auth.register")}
                  </Link>
                </p>
              ) : null}
            </div>
          </form>
        </motion.div>
      </div>
    </div>
  );
};

export default LoginPage;
