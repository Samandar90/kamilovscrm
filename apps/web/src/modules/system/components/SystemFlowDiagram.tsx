import React from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import {
  BarChart3,
  Calendar,
  CreditCard,
  FileText,
  Stethoscope,
  User,
} from "lucide-react";

type FlowNode = {
  key: string;
  titleKey: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "blue" | "green";
};

const NODES_CONFIG: FlowNode[] = [
  { key: "patient", titleKey: "systemFlow.patient", to: "/patients", icon: User, tone: "blue" },
  { key: "appointment", titleKey: "systemFlow.appointment", to: "/appointments", icon: Calendar, tone: "blue" },
  { key: "visit", titleKey: "systemFlow.visit", to: "/appointments", icon: Stethoscope, tone: "blue" },
  { key: "invoice", titleKey: "systemFlow.invoice", to: "/billing/invoices", icon: FileText, tone: "green" },
  { key: "payment", titleKey: "systemFlow.payment", to: "/billing/cash-desk", icon: CreditCard, tone: "green" },
  { key: "report", titleKey: "systemFlow.report", to: "/reports", icon: BarChart3, tone: "green" },
];

const toneClass: Record<FlowNode["tone"], string> = {
  blue: "border-blue-100 bg-blue-50/50 text-blue-700",
  green: "border-emerald-100 bg-emerald-50/50 text-emerald-700",
};

export const SystemFlowDiagram: React.FC<{ onNodeClick: (to: string) => void }> = ({
  onNodeClick,
}) => {
  const { t } = useTranslation();
  const NODES = NODES_CONFIG.map(node => ({ ...node, title: t(node.titleKey) }));

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max items-center gap-3">
        {NODES.map((node, index) => {
          const Icon = node.icon;
          return (
            <React.Fragment key={node.key}>
              <motion.button
                type="button"
                onClick={() => onNodeClick(node.to)}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.08, duration: 0.35, ease: "easeOut" }}
                whileHover={{ scale: 1.03, boxShadow: "0 0 0 6px rgba(59,130,246,0.08)" }}
                className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium shadow-md transition ${toneClass[node.tone]}`}
              >
                <Icon className="h-4 w-4" />
                {node.title}
              </motion.button>
              {index < NODES.length - 1 ? (
                <motion.span
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + index * 0.08, duration: 0.3 }}
                  className="text-lg text-slate-400"
                >
                  →
                </motion.span>
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
