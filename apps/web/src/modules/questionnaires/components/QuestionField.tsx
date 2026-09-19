import React from "react";
import { useTranslation } from "react-i18next";
import type { QuestionnaireQuestion } from "../api/questionnairesApi";
import type { AnswerDraft } from "../utils/questions";

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500/55 focus:ring-2 focus:ring-emerald-500/20 disabled:bg-slate-50";
const choiceClass =
  "flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 transition hover:bg-slate-50 has-[:checked]:border-emerald-300 has-[:checked]:bg-emerald-50";

type Props = {
  question: QuestionnaireQuestion;
  value: AnswerDraft;
  onChange: (value: AnswerDraft) => void;
  disabled?: boolean;
  idPrefix: string;
};

/** One answer control per question type. */
export const QuestionField: React.FC<Props> = ({ question, value, onChange, disabled = false, idPrefix }) => {
  const { t } = useTranslation();
  const id = `${idPrefix}-${question.id}`;
  const label = (
    <>
      {question.label}
      {question.required ? (
        <span className="ml-0.5 text-rose-600" aria-hidden>
          *
        </span>
      ) : null}
    </>
  );
  const labelClass = "mb-1.5 block text-sm font-medium text-slate-800";
  const text = typeof value === "string" ? value : "";

  if (question.type === "yes_no" || question.type === "single_choice") {
    const options: Array<{ value: string | boolean; label: string }> =
      question.type === "yes_no"
        ? [
            { value: true, label: t("questionnaires.yes") },
            { value: false, label: t("questionnaires.no") },
          ]
        : (question.options ?? []).map((option) => ({ value: option, label: option }));
    return (
      <fieldset>
        <legend className={labelClass}>{label}</legend>
        <div className="grid gap-1.5 sm:grid-cols-2" role="radiogroup" aria-required={question.required}>
          {options.map((option) => (
            <label key={String(option.value)} className={choiceClass}>
              <input
                type="radio"
                name={id}
                className="h-4 w-4 accent-emerald-600"
                checked={value === option.value}
                onChange={() => onChange(option.value as AnswerDraft)}
                // A second click on the chosen option clears an optional answer.
                onClick={() => {
                  if (value === option.value && !question.required) onChange(undefined);
                }}
                disabled={disabled}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  if (question.type === "multi_choice") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset>
        <legend className={labelClass}>{label}</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {(question.options ?? []).map((option) => (
            <label key={option} className={choiceClass}>
              <input
                type="checkbox"
                className="h-4 w-4 accent-emerald-600"
                checked={selected.includes(option)}
                onChange={(event) =>
                  onChange(
                    event.target.checked ? [...selected, option] : selected.filter((item) => item !== option)
                  )
                }
                disabled={disabled}
              />
              {option}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {question.type === "textarea" ? (
        <textarea
          id={id}
          className={`${inputClass} min-h-[88px]`}
          value={text}
          onChange={(event) => onChange(event.target.value)}
          required={question.required}
          disabled={disabled}
        />
      ) : (
        <input
          id={id}
          type={question.type === "date" ? "date" : "text"}
          inputMode={question.type === "number" ? "decimal" : undefined}
          className={inputClass}
          value={text}
          onChange={(event) => onChange(event.target.value)}
          required={question.required}
          disabled={disabled}
        />
      )}
    </div>
  );
};
