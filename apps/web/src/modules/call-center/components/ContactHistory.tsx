import React from "react";
import { useTranslation } from "react-i18next";
import { History, ChevronLeft, ChevronRight } from "lucide-react";
import { workspaceApi, type ContactAttempt } from "../api/workspaceApi";
import { formatContact } from "../workspaceUtils";

export function ContactHistory({ patientId, revision = 0 }: { patientId?: number; revision?: number }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = React.useState<ContactAttempt[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    workspaceApi.history(patientId, page, controller.signal).then((result) => {
      setItems(result.items); setTotal(result.total);
    }).catch((e: unknown) => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : t("callWorkspace.loadError"));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [patientId, page, revision, t]);
  return <section className="cc-history" aria-label={t("callWorkspace.history")}>
    {patientId && <h3><History size={16} />{t("callWorkspace.contactHistory")}</h3>}
    {error ? <p className="cc-error" role="alert">{error}</p> : loading ? <p className="cc-muted" role="status">{t("callWorkspace.loading")}</p> : items.length === 0 ?
      <div className="cc-quiet-empty"><History size={24} /><p>{t("callWorkspace.noHistory")}</p></div> :
      <ol className="cc-timeline">{items.map((item) => <li key={item.id}>
        <span className={`cc-timeline-dot cc-outcome-${item.outcome}`} />
        <div className="cc-history-top"><strong>{t(`callWorkspace.outcomes.${item.outcome}`, { defaultValue: item.outcome })}</strong><time>{formatContact(item.calledAt, i18n.language)}</time></div>
        {!patientId && <p className="cc-history-patient">{item.patientName}</p>}
        <p className="cc-muted">{item.calledByName || "—"} · {t(`callWorkspace.segments.${item.campaign}`, { defaultValue: item.campaign })}</p>
        {item.note && <p className="cc-history-note">{item.note}</p>}
        {item.callbackAt && <p className="cc-callback-time">{t("callWorkspace.callbackAt")}: {formatContact(item.callbackAt, i18n.language)}</p>}
      </li>)}</ol>}
    {total > 30 && <div className="cc-pagination">
      <button type="button" className="cc-icon-btn" disabled={page === 1 || loading} onClick={() => setPage((p) => p - 1)} aria-label={t("callWorkspace.prev")}><ChevronLeft size={16} /></button>
      <span>{page} / {Math.ceil(total / 30)}</span>
      <button type="button" className="cc-icon-btn" disabled={page * 30 >= total || loading} onClick={() => setPage((p) => p + 1)} aria-label={t("callWorkspace.next")}><ChevronRight size={16} /></button>
    </div>}
  </section>;
}
