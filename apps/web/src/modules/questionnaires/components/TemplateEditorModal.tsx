import React from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../../components/ui/Modal";
import type { Doctor } from "../../appointments/api/appointmentsFlowApi";
import {
  modalInputClass,
  modalLabelClass,
  modalSelectClass,
  modalSelectClassInline,
} from "../../appointments/utils/modalFieldClasses";
import {
  QUESTION_TYPES,
  questionnairesApi,
  type QuestionType,
  type QuestionnaireQuestion,
  type QuestionnaireTemplate,
} from "../api/questionnairesApi";
import { QUESTION_TYPE_KEYS, isChoiceQuestion, newQuestionId } from "../utils/questions";

const MAX_TITLE = 200;
const MAX_LABEL = 300;

type QuestionDraft = {
  id: string;
  label: string;
  type: QuestionType;
  required: boolean;
  /** Choice options, one per line. */
  optionsText: string;
};

const toDraft = (question: QuestionnaireQuestion): QuestionDraft => ({
  id: question.id,
  label: question.label,
  type: question.type,
  required: question.required,
  optionsText: (question.options ?? []).join("\n"),
});

const emptyQuestion = (): QuestionDraft => ({
  id: newQuestionId(),
  label: "",
  type: "text",
  required: false,
  optionsText: "",
});

const parseOptions = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

type Props = {
  token: string;
  /** null — new template. */
  template: QuestionnaireTemplate | null;
  /** Managers bind a template to any doctor; a doctor's template is always their own. */
  doctors: Doctor[] | null;
  onClose: () => void;
  onSaved: (saved: QuestionnaireTemplate) => void;
};

export const TemplateEditorModal: React.FC<Props> = ({ token, template, doctors, onClose, onSaved }) => {
  const { t } = useTranslation();
  const [title, setTitle] = React.useState(template?.title ?? "");
  const [description, setDescription] = React.useState(template?.description ?? "");
  const [doctorId, setDoctorId] = React.useState(template?.doctorId != null ? String(template.doctorId) : "");
  const [active, setActive] = React.useState(template?.active ?? true);
  const [questions, setQuestions] = React.useState<QuestionDraft[]>(() =>
    template ? template.questions.map(toDraft) : [emptyQuestion()]
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const updateQuestion = (id: string, patch: Partial<QuestionDraft>) =>
    setQuestions((prev) => prev.map((question) => (question.id === id ? { ...question, ...patch } : question)));
  const moveQuestion = (index: number, delta: -1 | 1) =>
    setQuestions((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(index + delta, 0, moved);
      return next;
    });

  const validate = (): string | null => {
    if (!title.trim()) return t("questionnaires.errors.titleRequired");
    if (questions.length === 0) return t("questionnaires.errors.noQuestions");
    for (const [index, question] of questions.entries()) {
      if (!question.label.trim()) return t("questionnaires.errors.labelRequired", { number: index + 1 });
      if (isChoiceQuestion(question.type)) {
        const options = parseOptions(question.optionsText);
        const unique = new Set(options.map((option) => option.toLowerCase()));
        if (options.length < 2 || unique.size !== options.length) {
          return t("questionnaires.errors.optionsInvalid", { label: question.label.trim() });
        }
      }
    }
    return null;
  };

  const save = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const input = {
      title: title.trim(),
      description: description.trim() || null,
      doctorId: doctorId ? Number(doctorId) : null,
      active,
      questions: questions.map((question) => ({
        id: question.id,
        label: question.label.trim(),
        type: question.type,
        required: question.required,
        ...(isChoiceQuestion(question.type) ? { options: parseOptions(question.optionsText) } : {}),
      })),
    };
    try {
      const saved = template
        ? await questionnairesApi.updateTemplate(token, template.id, input)
        : await questionnairesApi.createTemplate(token, input);
      onSaved(saved);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("questionnaires.errors.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const iconButton =
    "inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30";

  return (
    <Modal
      isOpen
      onClose={saving ? () => undefined : onClose}
      backdropClassName="modal-backdrop-enter fixed inset-0 bg-black/[0.12]"
      className="flex max-h-[min(94dvh,860px)] w-[min(720px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_64px_-20px_rgba(15,23,42,0.22)]"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="template-editor-title" className="flex min-h-0 flex-col">
        <header className="shrink-0 border-b border-slate-100 px-5 py-4">
          <h2 id="template-editor-title" className="text-base font-semibold text-slate-900">
            {template ? t("questionnaires.editTemplate") : t("questionnaires.newTemplate")}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">{t("questionnaires.editorHint")}</p>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="template-title" className={modalLabelClass}>
                {t("questionnaires.templateTitle")}
              </label>
              <input
                id="template-title"
                className={modalInputClass}
                value={title}
                maxLength={MAX_TITLE}
                onChange={(event) => setTitle(event.target.value)}
                disabled={saving}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="template-description" className={modalLabelClass}>
                {t("questionnaires.description")}
              </label>
              <textarea
                id="template-description"
                className={`${modalInputClass} min-h-[64px]`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={saving}
              />
            </div>
            {doctors ? (
              <div>
                <label htmlFor="template-doctor" className={modalLabelClass}>
                  {t("questionnaires.doctor")}
                </label>
                <select
                  id="template-doctor"
                  className={modalSelectClass}
                  value={doctorId}
                  onChange={(event) => setDoctorId(event.target.value)}
                  disabled={saving}
                >
                  <option value="">{t("questionnaires.forAllDoctors")}</option>
                  {doctors.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>
                      {doctor.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {template ? (
              <label className="flex items-center gap-2 self-end pb-2.5 text-sm text-slate-800">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-emerald-600"
                  checked={active}
                  onChange={(event) => setActive(event.target.checked)}
                  disabled={saving}
                />
                {t("questionnaires.activeTemplate")}
              </label>
            ) : null}
          </div>

          <div className="space-y-3">
            <p className={modalLabelClass}>{t("questionnaires.questions")}</p>
            {questions.map((question, index) => (
              <fieldset key={question.id} className="rounded-xl border border-slate-200 p-3">
                <legend className="px-1 text-xs font-semibold text-slate-500">
                  {t("questionnaires.questionNumber", { number: index + 1 })}
                </legend>
                <div className="flex gap-2">
                  <input
                    className={`${modalInputClass.replace("mt-2 ", "")} flex-1`}
                    value={question.label}
                    maxLength={MAX_LABEL}
                    placeholder={t("questionnaires.questionPlaceholder")}
                    aria-label={t("questionnaires.questionNumber", { number: index + 1 })}
                    onChange={(event) => updateQuestion(question.id, { label: event.target.value })}
                    disabled={saving}
                  />
                  <div className="flex shrink-0 items-start">
                    <button
                      type="button"
                      className={iconButton}
                      onClick={() => moveQuestion(index, -1)}
                      disabled={saving || index === 0}
                      aria-label={t("questionnaires.moveUp")}
                    >
                      <ArrowUp className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={iconButton}
                      onClick={() => moveQuestion(index, 1)}
                      disabled={saving || index === questions.length - 1}
                      aria-label={t("questionnaires.moveDown")}
                    >
                      <ArrowDown className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={`${iconButton} hover:bg-rose-50 hover:text-rose-600`}
                      onClick={() => setQuestions((prev) => prev.filter((row) => row.id !== question.id))}
                      disabled={saving || questions.length === 1}
                      aria-label={t("questionnaires.removeQuestion")}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <select
                    className={`${modalSelectClassInline.replace("w-full", "w-auto")} py-2`}
                    value={question.type}
                    onChange={(event) => updateQuestion(question.id, { type: event.target.value as QuestionType })}
                    aria-label={t("questionnaires.answerType")}
                    disabled={saving}
                  >
                    {QUESTION_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(QUESTION_TYPE_KEYS[type])}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-emerald-600"
                      checked={question.required}
                      onChange={(event) => updateQuestion(question.id, { required: event.target.checked })}
                      disabled={saving}
                    />
                    {t("questionnaires.required")}
                  </label>
                </div>
                {isChoiceQuestion(question.type) ? (
                  <textarea
                    className={`${modalInputClass} min-h-[84px]`}
                    value={question.optionsText}
                    placeholder={t("questionnaires.optionsPlaceholder")}
                    aria-label={t("questionnaires.options")}
                    onChange={(event) => updateQuestion(question.id, { optionsText: event.target.value })}
                    disabled={saving}
                  />
                ) : null}
              </fieldset>
            ))}
            <button
              type="button"
              onClick={() => setQuestions((prev) => [...prev, emptyQuestion()])}
              disabled={saving}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-emerald-400/70 bg-emerald-50/50 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-50 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t("questionnaires.addQuestion")}
            </button>
          </div>

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
            disabled={saving}
            className="h-10 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </footer>
      </div>
    </Modal>
  );
};
