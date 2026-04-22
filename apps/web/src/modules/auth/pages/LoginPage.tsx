import React, { useState } from "react";
import { Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ActivitySquare, CalendarDays, Eye, EyeOff, Lock, ShieldCheck, User, Users } from "lucide-react";
import { useAuth } from "../../../auth/AuthContext";

const WRONG_CREDENTIALS_MSG = "Неверный логин или пароль";

/** Единый текст для неверной пары логин/пароль (в т.ч. если API отдало другое сообщение). */
const mapLoginApiError = (message: string): string => {
  if (message === WRONG_CREDENTIALS_MSG) return message;
  const m = message.toLowerCase().trim();
  if (
    m.includes("invalid credentials") ||
    m.includes("invalid username") ||
    m.includes("wrong password") ||
    m.includes("incorrect password") ||
    m.includes("unauthorized") ||
    (m.includes("неверн") && (m.includes("логин") || m.includes("парол")))
  ) {
    return WRONG_CREDENTIALS_MSG;
  }
  return message;
};

function CursorGlow() {
  return null;
}

export const LoginPage: React.FC = () => {
  const { login, isAuthenticated, isLoading, error, clearError } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [show, setShow] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const lastSubmitAtRef = React.useRef(0);

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
      setFormError("Введите логин и пароль");
      return;
    }
    setFormError(null);
    clearError();
    await login(username.trim(), password, rememberMe);
  };

  const displayError = formError ?? (error ? mapLoginApiError(error) : null);

  const features = [
    { icon: Users, title: "Пациенты" },
    { icon: CalendarDays, title: "Расписание" },
    { icon: ActivitySquare, title: "Аналитика" },
  ];

  return (
    <div className="min-h-screen flex relative overflow-hidden">
      <CursorGlow />

      <div className="hidden lg:flex w-1/2 relative overflow-hidden bg-[#0B1120] text-white">
        <div className="absolute inset-0 bg-[linear-gradient(160deg,#0B1120_0%,#0F172A_100%)]" />
        <div className="relative z-10 flex h-full w-full flex-col justify-center pl-20 pr-12">
          <div className="max-w-[480px]">
          <h1 className="text-[48px] font-semibold leading-[1.1] tracking-tight">
            Управление клиникой
            <br />
            в <span className="text-blue-400">одном месте</span>
          </h1>

          <p className="mt-4 max-w-[360px] text-white/60">Цифровая система для современной клиники</p>

          <div className="mt-7 flex flex-col gap-3">
            {features.map((item) => (
              <div
                key={item.title}
                className="group inline-flex w-fit items-center gap-3 text-white/70 transition duration-200 hover:translate-x-0.5 hover:text-white"
              >
                <item.icon size={16} className="text-white/55 transition group-hover:text-white/80" />
                <span className="text-sm">{item.title}</span>
              </div>
            ))}
          </div>

          <div className="mt-8 inline-flex items-center gap-2 text-xs text-white/45">
            <ShieldCheck size={14} />
            Ваши данные под надёжной защитой
          </div>
          </div>
        </div>
      </div>

      <div className="relative z-10 flex-1 flex items-center justify-center bg-gradient-to-br from-[#F8FAFC] to-[#EEF2F7]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(560px_circle_at_84%_20%,rgba(99,102,241,0.10),transparent_45%)]" />
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="w-[400px] rounded-2xl border border-[#E5E7EB] bg-white p-8 shadow-[0_12px_28px_rgba(15,23,42,0.08)]"
        >
          <h2 className="mb-1 text-[26px] leading-tight font-semibold text-[#111827]">
            Добро пожаловать
          </h2>
          <p className="mb-5 text-sm text-gray-500">
            Войдите в систему для продолжения работы
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
                placeholder="Введите логин"
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
                placeholder="Введите пароль"
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
              Запомнить меня
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
              {isLoading ? "Вход..." : "Войти"}
            </button>
          </form>
        </motion.div>
      </div>
    </div>
  );
};

export default LoginPage;
