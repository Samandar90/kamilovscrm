import React from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  BarChart3,
  Lightbulb,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { MorningBriefingState } from "../../../hooks/useMorningBriefing";

function greetingPhrase(date: Date, t: any): string {
  const h = date.getHours();
  if (h >= 5 && h < 12) return t("dashboard.greeting.morning");
  if (h >= 12 && h < 17) return t("dashboard.greeting.afternoon");
  if (h >= 17) return t("dashboard.greeting.evening");
  return t("dashboard.greeting.morning");
}

export type DashboardMorningBriefingCardProps = {
  userName: string;
  state: MorningBriefingState;
  onRefresh: () => void;
};

type ParsedBriefing = {
  preamble: string;
  chart?: string;
  warning?: string;
  idea?: string;
};

/** Делит ответ LLM на преамбулу и блоки по строкам-заголовкам с эмодзи. */
function parseBriefingSections(raw: string): ParsedBriefing {
  const lines = raw.trim().split(/\r?\n/);
  let mode: "preamble" | "chart" | "warning" | "idea" = "preamble";
  const buffers = {
    preamble: [] as string[],
    chart: [] as string[],
    warning: [] as string[],
    idea: [] as string[],
  };

  // The card renders its own lucide icon per section, so the leading emoji
  // from the LLM text is stripped to avoid a doubled icon.
  const stripEmoji = (line: string, emoji: string) => line.trim().slice(emoji.length).trimStart();

  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("📊")) {
      mode = "chart";
      buffers.chart.push(stripEmoji(t, "📊"));
      continue;
    }
    if (t.startsWith("⚠️")) {
      mode = "warning";
      buffers.warning.push(stripEmoji(t, "⚠️"));
      continue;
    }
    if (t.startsWith("💡")) {
      mode = "idea";
      buffers.idea.push(stripEmoji(t, "💡"));
      continue;
    }
    buffers[mode].push(line);
  }

  const trimJoin = (arr: string[]) => arr.join("\n").trim();

  return {
    preamble: trimJoin(buffers.preamble),
    chart: buffers.chart.length ? trimJoin(buffers.chart) : undefined,
    warning: buffers.warning.length ? trimJoin(buffers.warning) : undefined,
    idea: buffers.idea.length ? trimJoin(buffers.idea) : undefined,
  };
}

const percentBadgeRe = /^([+-])(\d+(?:[.,]\d+)?)%$/;

function PercentBadge({ token }: { token: string }): React.ReactElement | null {
  const m = token.trim().match(percentBadgeRe);
  if (!m) return null;
  const sign = m[1];
  const rest = `${m[2]}%`;
  const positive = sign === "+";
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums ${
        positive
          ? "bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-200/80"
          : "bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-200/80"
      }`}
    >
      {sign}
      {rest}
    </span>
  );
}

/** Разбивает строку: бейджи ±N%, затем крупные жирные числа. */
function renderRichLine(line: string, lineKey: string): React.ReactNode {
  const percentParts = line.split(/([+-]\d+(?:[.,]\d+)?%)/g);
  return percentParts.map((part, i) => {
    if (percentBadgeRe.test(part.trim())) {
      return <PercentBadge key={`${lineKey}-p-${i}`} token={part} />;
    }
    return renderNumberSpans(part, `${lineKey}-n-${i}`);
  });
}

function renderNumberSpans(segment: string, keyPrefix: string): React.ReactNode {
  const numRe = /(\d+(?:[.,]\d+)?)/g;
  const pieces: React.ReactNode[] = [];
  let last = 0;
  let mi = 0;
  let m: RegExpExecArray | null;
  while ((m = numRe.exec(segment)) !== null) {
    if (m.index > last) {
      pieces.push(segment.slice(last, m.index));
    }
    pieces.push(
      <span
        key={`${keyPrefix}-${mi++}`}
        className="text-[1.05rem] font-semibold tabular-nums text-slate-900"
      >
        {m[1]}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < segment.length) {
    pieces.push(segment.slice(last));
  }
  return pieces.length ? pieces : segment;
}

function RichBriefingBlock({ text, className }: { text: string; className?: string }) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return (
    <div className={className}>
      {lines.map((line, idx) => (
        <p key={idx} className="text-[14px] leading-relaxed text-slate-700 last:mb-0 [&:not(:last-child)]:mb-1.5">
          {renderRichLine(line, `l-${idx}`)}
        </p>
      ))}
    </div>
  );
}

const sectionMotion = {
  hidden: { opacity: 0, y: 12 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.06 * i, duration: 0.4, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

const skeletonBar = (key: string, className: string) => (
  <div key={key} className={`animate-pulse rounded-md bg-slate-100 ${className}`} />
);

type SectionCardProps = {
  icon: React.ReactNode;
  children: React.ReactNode;
  className: string;
  index: number;
};

function SectionCard({ icon, children, className, index }: SectionCardProps) {
  return (
    <motion.div
      custom={index}
      variants={sectionMotion}
      initial="hidden"
      animate="show"
      className={`group relative overflow-hidden rounded-xl border px-4 py-3.5 shadow-sm transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-md ${className}`}
    >
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-to-br from-white/40 to-transparent" />
      <div className="relative flex gap-3">
        <div className="mt-0.5 shrink-0 text-slate-500 transition-transform duration-300 group-hover:scale-105 [&_svg]:h-[18px] [&_svg]:w-[18px]">
          {icon}
        </div>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </motion.div>
  );
}

export const DashboardMorningBriefingCard: React.FC<DashboardMorningBriefingCardProps> = ({
  userName,
  state,
  onRefresh,
}) => {
  const { t } = useTranslation();
  const greeting = greetingPhrase(new Date(), t);
  const displayName = userName.trim() || t("dashboard.colleague");
  const loading = state.status === "loading";
  const contentKey =
    state.status === "success" ? state.briefing : state.status === "error" ? state.message : "loading";

  const parsed =
    state.status === "success" ? parseBriefingSections(state.briefing) : null;
  const hasStructured =
    parsed && (parsed.chart != null || parsed.warning != null || parsed.idea != null);

  return (
    <motion.section
      className="w-full overflow-hidden rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_18px_40px_-18px_rgba(15,23,42,0.12),0_0_0_1px_rgba(15,23,42,0.03)]"
      aria-busy={loading}
      aria-live="polite"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            {t("dashboard.morningAIBriefing")}
          </p>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/10 to-indigo-500/5 text-violet-600 ring-1 ring-violet-200/60">
              <Sparkles className="h-4.5 w-4.5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 pt-0.5">
              <h2 className="text-[17px] font-semibold tracking-tight text-slate-900">
                {greeting}, {displayName}
              </h2>
              <p className="mt-0.5 text-sm text-slate-500">{t("dashboard.briefSummaryToday")}</p>
            </div>
          </div>
        </div>
        <motion.button
          type="button"
          onClick={() => onRefresh()}
          disabled={loading}
          whileHover={{ scale: loading ? 1 : 1.02 }}
          whileTap={{ scale: loading ? 1 : 0.98 }}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200/90 bg-slate-50/90 px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
          {t("dashboard.updateAnalysis")}
        </motion.button>
      </div>

      <div className="mt-4 space-y-2.5">
        {state.status === "loading" ? (
          <div className="space-y-3" role="status" aria-label={t("dashboard.loadingBriefing")}>
            {skeletonBar("a", "h-4 w-full")}
            {skeletonBar("b", "h-4 w-[92%]")}
            {skeletonBar("c", "h-4 w-[88%]")}
            {skeletonBar("d", "h-4 w-[72%]")}
            {skeletonBar("e", "h-4 w-[40%]")}
          </div>
        ) : null}

        {state.status === "error" ? (
          <motion.div
            key={contentKey}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-xl border border-rose-200/80 bg-rose-50/90 px-3.5 py-3 text-sm leading-relaxed text-rose-900"
          >
            {state.message}
          </motion.div>
        ) : null}

        {state.status === "success" && parsed && hasStructured ? (
          <div className="space-y-3">
            {(() => {
              let animIndex = 0;
              return (
                <>
                  {parsed.preamble ? (
                    <motion.div
                      key="preamble"
                      custom={animIndex++}
                      variants={sectionMotion}
                      initial="hidden"
                      animate="show"
                      className="rounded-xl border border-slate-100 bg-slate-50/50 px-3.5 py-3 text-[13px] leading-relaxed text-slate-600 transition-all duration-300 hover:border-slate-200/80 hover:bg-slate-50/70 hover:shadow-sm"
                    >
                      <RichBriefingBlock text={parsed.preamble} />
                    </motion.div>
                  ) : null}

                  {parsed.chart ? (
                    <SectionCard
                      key="chart"
                      index={animIndex++}
                      icon={<BarChart3 strokeWidth={1.75} className="text-slate-600" />}
                      className="border-slate-200/80 bg-slate-100/80 hover:border-slate-300/90"
                    >
                      <RichBriefingBlock text={parsed.chart} />
                    </SectionCard>
                  ) : null}

                  {parsed.warning ? (
                    <SectionCard
                      key="warning"
                      index={animIndex++}
                      icon={<AlertTriangle strokeWidth={1.75} className="text-rose-600/90" />}
                      className="border-rose-200/70 bg-rose-50/65 hover:border-rose-300/80"
                    >
                      <RichBriefingBlock text={parsed.warning} />
                    </SectionCard>
                  ) : null}

                  {parsed.idea ? (
                    <SectionCard
                      key="idea"
                      index={animIndex++}
                      icon={<Lightbulb strokeWidth={1.75} className="text-emerald-600/90" />}
                      className="border-emerald-200/70 bg-emerald-50/55 hover:border-emerald-300/80"
                    >
                      <RichBriefingBlock text={parsed.idea} />
                    </SectionCard>
                  ) : null}
                </>
              );
            })()}
          </div>
        ) : null}

        {state.status === "success" && parsed && !hasStructured ? (
          <motion.div
            key={contentKey}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="group rounded-xl border border-slate-200/80 bg-slate-50/60 px-3.5 py-3 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
          >
            <RichBriefingBlock text={state.briefing} />
          </motion.div>
        ) : null}
      </div>
    </motion.section>
  );
};
