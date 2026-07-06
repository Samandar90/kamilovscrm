import React from "react";
import { useTranslation } from "react-i18next";
import type { Patient } from "../api/appointmentsFlowApi";
import { quickModalComboboxInputClass } from "../utils/modalFieldClasses";
import { usePatientSearch } from "../hooks/usePatientSearch";

type Props = {
  token: string | null;
  query: string;
  selectedPatient: Patient | null;
  disabled?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  onQueryChange: (query: string) => void;
  onSelectPatient: (patient: Patient | null) => void;
  onCreatePatient: (query: string) => Promise<void> | void;
  errorMessage?: string | null;
};

export const PatientAutocomplete: React.FC<Props> = ({
  token,
  query,
  selectedPatient,
  disabled = false,
  inputRef,
  onQueryChange,
  onSelectPatient,
  onCreatePatient,
  errorMessage,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const { suggestions, loading, error } = usePatientSearch(token, query);

  if (selectedPatient) {
    return (
      <div className="mt-2">
        <span className="inline-flex items-center gap-2 rounded-lg bg-green-50 px-3 py-1 text-sm font-medium text-green-700">
          {selectedPatient.fullName}
          <button
            type="button"
            className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-green-100"
            onClick={() => {
              onSelectPatient(null);
              onQueryChange("");
              setOpen(true);
            }}
            aria-label={t("appointments.removePatientAriaLabel")}
          >
            ✕
          </button>
        </span>
        {errorMessage ? <p className="mt-2 text-xs text-rose-600">{errorMessage}</p> : null}
        {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="relative mt-2">
      <input
        ref={inputRef}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onQueryChange(e.target.value);
          onSelectPatient(null);
          setOpen(true);
        }}
        placeholder={t("appointments.enterPatientName")}
        className={`${quickModalComboboxInputClass} w-full`}
        disabled={disabled}
      />

      {open && query.trim() ? (
        <div className="absolute z-50 mt-2 max-h-60 w-full overflow-auto rounded-xl border border-[#e5e7eb] bg-white shadow-lg">
          {loading ? <div className="px-4 py-2 text-sm text-slate-500">{t("appointments.searchingPatients")}</div> : null}

          {!loading
            ? suggestions.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="block w-full cursor-pointer px-4 py-2 text-left hover:bg-slate-50"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSelectPatient(p);
                    onQueryChange(p.fullName);
                    setOpen(false);
                  }}
                >
                  <div className="font-medium text-[#111827]">{p.fullName}</div>
                  <div className="text-sm text-slate-500">{p.phone || t("appointments.noPhoneSpecified")}</div>
                </button>
              ))
            : null}

          {!loading && suggestions.length === 0 ? (
            <button
              type="button"
              className="block w-full cursor-pointer px-4 py-2 text-left text-green-600 hover:bg-green-50"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                void onCreatePatient(query.trim());
                setOpen(false);
              }}
            >
              ➕ {t("appointments.createPatientX", { name: query.trim() })}
            </button>
          ) : null}
        </div>
      ) : null}

      {errorMessage ? <p className="mt-2 text-xs text-rose-600">{errorMessage}</p> : null}
      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
};

