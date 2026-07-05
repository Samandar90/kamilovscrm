import React from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Calendar,
  CreditCard,
  FileText,
  Stethoscope,
  User,
  Users,
} from "lucide-react";
import { SystemFlowDiagram } from "../components/SystemFlowDiagram";

export const ArchitecturePage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const zones: Array<{
    title: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    to: string;
    tone: "blue" | "green";
  }> = [
    {
      title: t("architecture.zones.frontOffice.title"),
      description: t("architecture.zones.frontOffice.description"),
      icon: Users,
      to: "/patients",
      tone: "blue",
    },
    {
      title: t("architecture.zones.clinicalCore.title"),
      description: t("architecture.zones.clinicalCore.description"),
      icon: Stethoscope,
      to: "/appointments",
      tone: "blue",
    },
    {
      title: t("architecture.zones.financialCore.title"),
      description: t("architecture.zones.financialCore.description"),
      icon: CreditCard,
      to: "/billing/invoices",
      tone: "green",
    },
  ];

  const opsTimeline = [
    t("architecture.timeline.patientRegistration"),
    t("architecture.timeline.appointmentCreation"),
    t("architecture.timeline.clinicalVisit"),
    t("architecture.timeline.invoiceCreation"),
    t("architecture.timeline.cashPayment"),
    t("architecture.timeline.analyticsReports"),
  ];

  const moneyFlow = [
    { label: t("architecture.moneyFlow.serviceAdded"), icon: FileText },
    { label: t("architecture.moneyFlow.paymentProcessed"), icon: CreditCard },
    { label: t("architecture.moneyFlow.revenueReported"), icon: BarChart3 },
  ];

  return (
    <div className="space-y-6 bg-[#f8fafc] p-6">
      <header>
        <h2 className="text-2xl font-semibold text-[#0f172a]">{t("architecture.title")}</h2>
        <p className="text-sm text-[#64748b]">
          {t("architecture.subtitle")}
        </p>
      </header>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[#64748b]">
          {t("architecture.zones.title")}
        </h3>
        <div className="grid gap-3 lg:grid-cols-3">
          {zones.map((zone, index) => {
            const Icon = zone.icon;
            return (
              <motion.button
                key={zone.title}
                type="button"
                onClick={() => navigate(zone.to)}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.08, duration: 0.35, ease: "easeOut" }}
                whileHover={{ scale: 1.03 }}
                className={`rounded-2xl border bg-white p-5 text-left shadow-md transition ${
                  zone.tone === "green"
                    ? "border-emerald-100 hover:shadow-emerald-100/70"
                    : "border-slate-200 hover:shadow-blue-100/70"
                }`}
              >
                <div
                  className={`inline-flex rounded-xl p-2 ${
                    zone.tone === "green"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-blue-100 text-blue-700"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div className="mt-3 text-base font-semibold text-[#0f172a]">{zone.title}</div>
                <div className="mt-1 text-sm text-[#64748b]">{zone.description}</div>
              </motion.button>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[#64748b]">
          {t("architecture.visualFlow.title")}
        </h3>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <SystemFlowDiagram onNodeClick={(to) => navigate(to)} />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[#64748b]">
          {t("architecture.operationalFlow.title")}
        </h3>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="relative ml-2 space-y-3">
            <div className="absolute bottom-0 left-3 top-1 w-px bg-slate-200" />
            {opsTimeline.map((item, index) => (
              <motion.div
                key={item}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.07, duration: 0.3 }}
                className="relative flex items-center gap-3"
              >
                <div className="relative z-10 inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                  {index + 1}
                </div>
                <div className="text-sm text-[#334155]">{item}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[#64748b]">
          {t("architecture.financialFlow.title")}
        </h3>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm"
        >
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <Activity className="h-3.5 w-3.5" />
            {t("architecture.financialFlow.pipelineLabel")}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {moneyFlow.map((step, idx) => {
              const Icon = step.icon;
              return (
                <motion.button
                  key={step.label}
                  type="button"
                  onClick={() =>
                    navigate(
                      idx === 0
                        ? "/billing/invoices"
                        : idx === 1
                          ? "/billing/cash-desk"
                          : "/reports"
                    )
                  }
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.08, duration: 0.3 }}
                  whileHover={{ scale: 1.03 }}
                  className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4 text-left shadow-md"
                >
                  <div className="inline-flex rounded-lg bg-white p-2 text-emerald-700">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="mt-2 text-sm font-medium text-emerald-800">{step.label}</div>
                </motion.button>
              );
            })}
          </div>
        </motion.div>
      </section>
    </div>
  );
};

