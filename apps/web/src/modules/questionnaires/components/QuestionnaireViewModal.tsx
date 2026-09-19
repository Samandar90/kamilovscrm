import React from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../../components/ui/Modal";
import { questionnairesApi, type PatientQuestionnaire } from "../api/questionnairesApi";
import { formatAnswer } from "../utils/questions";

type Props = {
  token: string;
  questionnaireId: number;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onEdit: (questionnaire: PatientQuestionnaire) => void;
  onDeleted: () => void;
};

const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const QuestionnaireViewModal: React.FC<Props> = ({
  token,
  questionnaireId,
  canEdit,
  canDelete,
  onClose,
  onEdit,
  onDeleted,
}) => {
  const { t } = useTranslation();
  const [questionnaire, setQuestionnaire] = React.useState<PatientQuestionnaire | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    questionnairesApi
      .get(token, questionnaireId)
      .then((row) => {
        if (!cancelled) setQuestionnaire(row);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : t("questionnaires.errors.loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [token, questionnaireId, t]);

  const remove = async () => {
    if (!questionnaire || !window.confirm(t("questionnaires.confirmDelete"))) return;
    setDeleting(true);
    setError(null);
    try {
      await questionnairesApi.remove(token, questionnaire.id);
      onDeleted();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("questionnaires.errors.saveFailed"));
      setDeleting(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      backdropClassName="modal-backdrop-enter fixed inset-0 bg-black/[0.12]"
      className="flex max-h-[min(92dvh,760px)] w-[min(600px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_64px_-20px_rgba(15,23,42,0.22)]"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="questionnaire-view-title" className="flex min-h-0 flex-col">
        <header className="shrink-0 border-b border-slate-100 px-5 py-4">
          <h2 id="questionnaire-view-title" className="text-base font-semibold text-slate-900">
            {questionnaire?.title ?? t("common.loading")}
          </h2>
          {questionnaire ? (
            <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-slate-500 sm:grid-cols-2">
              <div>
                <dt className="inline font-semibold text-slate-600">{t("common.patient")}: </dt>
                <dd className="inline">{questionnaire.patientName}</dd>
              </div>
              <div>
                <dt className="inline font-semibold text-slate-600">{t("questionnaires.doctor")}: </dt>
                <dd className="inline">{questionnaire.doctorName ?? "—"}</dd>
              </div>
              <div>
                <dt className="inline font-semibold text-slate-600">{t("questionnaires.filledBy")}: </dt>
                <dd className="inline">
                  {questionnaire.createdByName ?? "—"}, {formatDateTime(questionnaire.createdAt)}
                </dd>
              </div>
              {questionnaire.updatedAt !== questionnaire.createdAt ? (
                <div>
                  <dt className="inline font-semibold text-slate-600">{t("questionnaires.updatedBy")}: </dt>
                  <dd className="inline">
                    {questionnaire.updatedByName ?? "—"}, {formatDateTime(questionnaire.updatedAt)}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
          {error ? (
            <div className="my-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">
              {error}
            </div>
          ) : null}
          {questionnaire ? (
            <dl className="divide-y divide-slate-100">
              {questionnaire.questions.map((question) => (
                <div key={question.id} className="py-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{question.label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm text-slate-900">
                    {formatAnswer(questionnaire.answers[question.id], t)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : !error ? (
            <div className="space-y-2 py-3" aria-busy="true">
              {[0, 1, 2].map((row) => (
                <div key={row} className="h-12 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          ) : null}
        </div>

        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">
          {questionnaire && canDelete ? (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={deleting}
              className="mr-auto h-10 rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-800 transition hover:bg-rose-100 disabled:opacity-50"
            >
              {t("common.delete")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 transition hover:bg-slate-50"
          >
            {t("common.close")}
          </button>
          {questionnaire && canEdit ? (
            <button
              type="button"
              onClick={() => onEdit(questionnaire)}
              disabled={deleting}
              className="h-10 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {t("common.edit")}
            </button>
          ) : null}
        </footer>
      </div>
    </Modal>
  );
};
