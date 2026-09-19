import React from "react";
import { ClipboardList } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../../components/ui/Modal";
import type { Patient } from "../../appointments/api/appointmentsFlowApi";
import { PatientAutocompleteInput } from "../../appointments/components/PatientAutocompleteInput";
import { modalLabelClass, modalSelectClass } from "../../appointments/utils/modalFieldClasses";
import {
  questionnairesApi,
  type PatientQuestionnaire,
  type QuestionnaireTemplate,
} from "../api/questionnairesApi";
import { missingRequired, toAnswers, toDrafts, type AnswerDrafts } from "../utils/questions";
import { QuestionField } from "./QuestionField";

export type FillTarget =
  | {
      kind: "new";
      /** Preset patient (patient card, doctor workspace); otherwise it is picked in the form. */
      patient?: Pick<Patient, "id" | "fullName"> | null;
      appointmentId?: number | null;
      templateId?: number | null;
    }
  | { kind: "edit"; questionnaire: PatientQuestionnaire };

type Props = {
  token: string;
  target: FillTarget;
  onClose: () => void;
  onSaved: (saved: PatientQuestionnaire) => void;
};

export const QuestionnaireFillModal: React.FC<Props> = ({ token, target, onClose, onSaved }) => {
  const { t } = useTranslation();
  const isNew = target.kind === "new";
  const [templates, setTemplates] = React.useState<QuestionnaireTemplate[]>([]);
  const [templateId, setTemplateId] = React.useState<number | null>(isNew ? target.templateId ?? null : null);
  const [patient, setPatient] = React.useState<Pick<Patient, "id" | "fullName"> | null>(
    isNew ? target.patient ?? null : null
  );
  const [patientQuery, setPatientQuery] = React.useState("");
  const [drafts, setDrafts] = React.useState<AnswerDrafts>(() =>
    target.kind === "edit" ? toDrafts(target.questionnaire.answers) : {}
  );
  const [loading, setLoading] = React.useState(isNew);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isNew) return;
    let cancelled = false;
    questionnairesApi
      .listTemplates(token)
      .then((rows) => {
        if (!cancelled) setTemplates(rows);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : t("questionnaires.errors.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isNew, token, t]);

  const template = templates.find((row) => row.id === templateId) ?? null;
  const questions = target.kind === "edit" ? target.questionnaire.questions : template?.questions ?? [];
  const title = target.kind === "edit" ? target.questionnaire.title : template?.title ?? t("questionnaires.fillTitle");
  const patientName = target.kind === "edit" ? target.questionnaire.patientName : patient?.fullName ?? null;

  const save = async () => {
    const missing = missingRequired(questions, drafts);
    if (missing) {
      setError(t("questionnaires.errors.requiredMissing", { label: missing.label }));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const answers = toAnswers(questions, drafts);
      const saved =
        target.kind === "edit"
          ? await questionnairesApi.updateAnswers(token, target.questionnaire.id, answers)
          : await questionnairesApi.create(token, {
              patientId: patient!.id,
              templateId: templateId!,
              appointmentId: target.appointmentId ?? null,
              answers,
            });
      onSaved(saved);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("questionnaires.errors.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const canSave = !saving && questions.length > 0 && (target.kind === "edit" || Boolean(patient && templateId));
  const generalTemplates = templates.filter((row) => row.doctorId === null);
  const doctorTemplates = templates.filter((row) => row.doctorId !== null);

  return (
    <Modal
      isOpen
      onClose={saving ? () => undefined : onClose}
      backdropClassName="modal-backdrop-enter fixed inset-0 bg-black/[0.12]"
      className="flex max-h-[min(92dvh,760px)] w-[min(600px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_64px_-20px_rgba(15,23,42,0.22)]"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="questionnaire-fill-title" className="flex min-h-0 flex-col">
        <header className="flex shrink-0 gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-800">
            <ClipboardList className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 id="questionnaire-fill-title" className="truncate text-base font-semibold text-slate-900">
              {title}
            </h2>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {patientName ?? t("questionnaires.fillSubtitle")}
            </p>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {isNew && !(target.kind === "new" && target.patient) ? (
            <div>
              <label htmlFor="questionnaire-patient" className={modalLabelClass}>
                {t("common.patient")}
              </label>
              {patient ? (
                <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
                  <span className="truncate">{patient.fullName}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setPatient(null);
                      setPatientQuery("");
                    }}
                    className="shrink-0 text-xs font-semibold text-emerald-800 underline-offset-2 hover:underline"
                  >
                    {t("questionnaires.changePatient")}
                  </button>
                </div>
              ) : (
                <PatientAutocompleteInput
                  id="questionnaire-patient"
                  query={patientQuery}
                  selectedPatient={null}
                  token={token}
                  onQueryChange={setPatientQuery}
                  onSelectPatient={(selected) => setPatient(selected)}
                  placeholder={t("appointments.patientSearchPlaceholder")}
                  wrapperClassName="relative mt-1.5"
                  disabled={saving}
                />
              )}
            </div>
          ) : null}

          {isNew ? (
            <div>
              <label htmlFor="questionnaire-template" className={modalLabelClass}>
                {t("questionnaires.template")}
              </label>
              <select
                id="questionnaire-template"
                className={modalSelectClass.replace("mt-2", "mt-1.5")}
                value={templateId ?? ""}
                onChange={(event) => {
                  setTemplateId(event.target.value ? Number(event.target.value) : null);
                  setDrafts({});
                  setError(null);
                }}
                disabled={saving || loading}
              >
                <option value="">
                  {loading
                    ? t("common.loading")
                    : templates.length === 0
                      ? t("questionnaires.noTemplates")
                      : t("questionnaires.chooseTemplate")}
                </option>
                {generalTemplates.length > 0 ? (
                  <optgroup label={t("questionnaires.forAllDoctors")}>
                    {generalTemplates.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.title}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {doctorTemplates.length > 0 ? (
                  <optgroup label={t("questionnaires.doctorTemplates")}>
                    {doctorTemplates.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.title} · {row.doctorName ?? `#${row.doctorId}`}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              {template?.description ? <p className="mt-1.5 text-xs text-slate-500">{template.description}</p> : null}
            </div>
          ) : null}

          {questions.map((question) => (
            <QuestionField
              key={question.id}
              idPrefix="questionnaire"
              question={question}
              value={drafts[question.id]}
              onChange={(value) => setDrafts((prev) => ({ ...prev, [question.id]: value }))}
              disabled={saving}
            />
          ))}

          {error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!canSave}
            className="h-10 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </footer>
      </div>
    </Modal>
  );
};
