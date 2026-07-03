import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  BarChart3,
  Bot,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Printer,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Logo } from "../../shared/ui/Logo";
import { BRANDING, SALES_CONTACTS } from "../../shared/config/branding";

const FEATURES = [
  {
    icon: Users,
    title: "Пациенты и история визитов",
    text: "Картотека пациентов, источники обращений, телефоны и заметки — всё в одном месте.",
  },
  {
    icon: CalendarDays,
    title: "Записи и расписание врачей",
    text: "Запись на приём за пару кликов, статусы визитов, перенос и напоминания регистратуре.",
  },
  {
    icon: CreditCard,
    title: "Касса, счета и оплаты",
    text: "Счета из приёма в один клик, кассовые смены, наличные и терминал, возвраты.",
  },
  {
    icon: Printer,
    title: "Фирменные чеки",
    text: "Квитанции с логотипом и названием вашей клиники — печать сразу из кассы.",
  },
  {
    icon: BarChart3,
    title: "Отчёты и аналитика",
    text: "Выручка по дням, врачам и услугам. Видно, что приносит деньги, а что простаивает.",
  },
  {
    icon: Bot,
    title: "AI-ассистент",
    text: "Утренняя сводка, ответы на вопросы по данным клиники, рекомендации по загрузке.",
  },
];

const STEPS = [
  { n: "1", title: "Оставьте заявку", text: "Напишите нам в Telegram или позвоните — расскажем и покажем систему." },
  { n: "2", title: "Мы создаём вашу клинику", text: "Название, логотип, аккаунты для персонала — готово за один день." },
  { n: "3", title: "14 дней бесплатно", text: "Полный доступ ко всем функциям. Понравится — продлите подписку." },
];

export const LandingPage: React.FC = () => {
  React.useEffect(() => {
    document.title = `${BRANDING.productName} — ${BRANDING.productTagline}`;
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] to-[#EEF2F7] text-slate-900">
      {/* Шапка */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <div className="flex items-center gap-2.5">
          <Logo size={34} />
          <span className="text-lg font-bold tracking-tight">{BRANDING.productName}</span>
        </div>
        <Link
          to="/login"
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
        >
          Войти
        </Link>
      </header>

      {/* Герой */}
      <section className="mx-auto max-w-6xl px-5 pb-14 pt-10 text-center md:pt-16">
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
          <h1 className="mx-auto max-w-3xl text-4xl font-extrabold leading-tight tracking-tight md:text-5xl">
            CRM-система для вашей клиники
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
            Пациенты, записи, касса, отчёты и AI-ассистент — всё, что нужно клинике,
            в одной системе. Под вашим брендом, с вашим логотипом.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href={SALES_CONTACTS.telegramHref}
              target="_blank"
              rel="noreferrer"
              className="w-full rounded-xl bg-[#2563EB] px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-[#1D4ED8] sm:w-auto"
            >
              Подключить клинику — 14 дней бесплатно
            </a>
            <Link
              to="/login"
              className="w-full rounded-xl border border-slate-200 bg-white px-7 py-3.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 sm:w-auto"
            >
              Посмотреть демо
            </Link>
          </div>
          <div className="mx-auto mt-5 inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-xl border border-slate-200 bg-white/70 px-4 py-2 text-xs text-slate-500">
            <span>Демо-доступ:</span>
            <span>
              логин <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono font-semibold text-slate-700">demo</code>
            </span>
            <span>
              пароль <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono font-semibold text-slate-700">demo123</code>
            </span>
          </div>
        </motion.div>
      </section>

      {/* Функции */}
      <section className="mx-auto max-w-6xl px-5 pb-16">
        <h2 className="text-center text-2xl font-bold tracking-tight md:text-3xl">Всё нужное — из коробки</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.35, delay: i * 0.05 }}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-[#2563EB]">
                <f.icon size={22} strokeWidth={1.8} />
              </div>
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{f.text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Как подключиться */}
      <section className="border-y border-slate-200 bg-white/60 py-16">
        <div className="mx-auto max-w-6xl px-5">
          <h2 className="text-center text-2xl font-bold tracking-tight md:text-3xl">Как подключиться</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[#2563EB] text-sm font-bold text-white">
                  {s.n}
                </div>
                <h3 className="mt-4 font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm text-slate-500">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Цена + доверие */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <div className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm md:p-10">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <CheckCircle2 size={14} /> 14 дней бесплатно, без карты
          </div>
          <h2 className="mt-4 text-2xl font-bold tracking-tight">Простая подписка для всей клиники</h2>
          <p className="mt-2 text-slate-600">
            Одна цена — все функции, без ограничений по числу врачей и пациентов.
            Стоимость обсудим при подключении.
          </p>
          <ul className="mx-auto mt-5 grid max-w-md gap-2 text-left text-sm text-slate-600">
            {[
              "Все модули: записи, касса, отчёты, AI-ассистент",
              "Ваш логотип в системе и на чеках",
              "Данные каждой клиники полностью изолированы",
              "Поддержка на русском в Telegram",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-600" /> {t}
              </li>
            ))}
          </ul>
          <div className="mt-7 flex flex-col items-center justify-center gap-2 text-sm sm:flex-row sm:gap-6">
            <a href={SALES_CONTACTS.phoneHref} className="font-semibold text-[#2563EB] hover:underline">
              {SALES_CONTACTS.phone}
            </a>
            <a
              href={SALES_CONTACTS.telegramHref}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-[#2563EB] hover:underline"
            >
              Telegram: {SALES_CONTACTS.telegram}
            </a>
          </div>
        </div>
      </section>

      {/* Подвал */}
      <footer className="border-t border-slate-200 py-8 text-center text-xs text-slate-400">
        © {new Date().getFullYear()} {BRANDING.productName} · {BRANDING.productTagline}
      </footer>
    </div>
  );
};

export default LandingPage;
