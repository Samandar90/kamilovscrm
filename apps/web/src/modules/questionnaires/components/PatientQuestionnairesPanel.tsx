import React from "react";
import { ClipboardList, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../../auth/AuthContext";
import { canCreateQuestionnaires } from "../../../auth/roleGroups";
import { questionnairesApi, type PatientQuestionnaireSummary } from "../api/questionnairesApi";
import { useQuestionnaireDialogs } from "../hooks/useQuestionnaireDialogs";

const PANEL_LIMIT = 50;

type Props = {
  patient: { id: number; fullName: string };
  /** Links a new questionnaire to the current visit (doctor workspace). */
  appointmentId?: number | null;
};

/** The patient's questionnaires from the shared base, with filling in place. */
export const PatientQuestionnairesPanel: React.FC<Props> = ({ patient, appointmentId = null }) => {
  const { t } = useTranslation();
  const { token, user } = useAuth();
  const [items, setItems] = React.useState<PatientQuestionnaireSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const result = await questionnairesApi.list(token, { patientId: patient.id, limit: PANEL_LIMIT });
      setItems(result.items);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("questionnaires.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [token, patient.id, t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const dialogs = useQuestionnaireDialogs(() => void load());

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3" aria-labelledby={`patient-questionnaires-${patient.id}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={`patient-questionnaires-${patient.id}`} className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <ClipboardList className="h-4 w-4 text-slate-500" aria-hidden />
          {t("questionnaires.patientPanelTitle")}
        </h3>
        {canCreateQuestionnaires(user?.role) ? (
          <button
            type="button"
            onClick={() => dialogs.openFill({ kind: "new", patient, appointmentId })}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t("questionnaires.fill")}
          </button>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
      {loading ? (
        <div className="mt-2 h-10 animate-pulse rounded-lg bg-slate-100" aria-busy="true" />
      ) : items.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">{t("questionnaires.patientEmpty")}</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => dialogs.openView(item.id)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-2 text-left transition hover:bg-slate-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900">{item.title}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {new Date(item.createdAt).toLocaleDateString()} · {item.doctorName ?? item.createdByName ?? "—"}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-slate-500">
                  {t("questionnaires.answeredOf", { answered: item.answeredCount, total: item.questionCount })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {dialogs.element}
    </section>
  );
};
