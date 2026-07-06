import React from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../../components/ui/Modal";
import { PhoneInput } from "../../../shared/ui/PhoneInput";
import { phoneToApiValue } from "../../../utils/phoneInput";
import type { Patient, PatientCreateInput } from "../api/appointmentsFlowApi";
import { appointmentsFlowApi } from "../api/appointmentsFlowApi";

type Props = {
  open: boolean;
  token: string | null;
  initialName: string;
  submitting: boolean;
  onClose: () => void;
  onCreated: (patient: Patient) => void;
  onError: (message: string | null) => void;
};

export const CreatePatientModal: React.FC<Props> = ({
  open,
  token,
  initialName,
  submitting,
  onClose,
  onCreated,
  onError,
}) => {
  const { t } = useTranslation();
  const [fullName, setFullName] = React.useState(initialName);
  const [phone, setPhone] = React.useState("");
  const [birthDate, setBirthDate] = React.useState("");
  const [gender, setGender] = React.useState<"male" | "female">("male");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setFullName(initialName);
    setPhone("");
    setBirthDate("");
    setGender("male");
  }, [initialName, open]);

  const handleSubmit = async () => {
    if (!token || submitting || saving) return;
    const name = fullName.trim();
    if (name.length < 5) {
      onError(t("appointments.patientNameTooShort"));
      return;
    }
    const apiPhone = phoneToApiValue(phone);
    const digits = apiPhone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) {
      onError(t("appointments.invalidPhone"));
      return;
    }
    const payload: PatientCreateInput = {
      fullName: name,
      phone: apiPhone,
      birthDate: birthDate.trim() || null,
      gender,
    };
    setSaving(true);
    onError(null);
    try {
      const created = await appointmentsFlowApi.createPatient(token, payload);
      onCreated(created);
    } catch (error) {
      onError(error instanceof Error ? error.message : t("appointments.failedToCreatePatient"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      className="w-[min(480px,calc(100vw-2rem))] rounded-[20px] border border-[#e5e7eb] bg-white p-6 shadow-[0_24px_48px_-24px_rgba(15,23,42,0.2)]"
    >
      <h3 className="text-lg font-semibold text-[#111827]">{t("appointments.createPatientHeader")}</h3>
      <div className="mt-4 space-y-3">
        <label className="block text-sm text-[#374151]">
          {t("appointments.fullName")}
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="mt-1 h-11 w-full rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-3 text-sm text-[#111827] outline-none transition focus:border-[#22c55e] focus:bg-white focus:ring-1 focus:ring-[#22c55e]/25"
          />
        </label>
        <label className="block text-sm text-[#374151]">
          {t("appointments.phone")}
          <PhoneInput
            value={phone}
            onChange={setPhone}
            className="mt-1 h-11 w-full rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-3 text-sm text-[#111827] outline-none transition focus:border-[#22c55e] focus:bg-white focus:ring-1 focus:ring-[#22c55e]/25"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm text-[#374151]">
            {t("appointments.birthDate")}
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className="mt-1 h-11 w-full rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-3 text-sm text-[#111827] outline-none transition focus:border-[#22c55e] focus:bg-white focus:ring-1 focus:ring-[#22c55e]/25"
            />
          </label>
          <label className="block text-sm text-[#374151]">
            {t("appointments.gender")}
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value as "male" | "female")}
              className="mt-1 h-11 w-full rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-3 text-sm text-[#111827] outline-none transition focus:border-[#22c55e] focus:bg-white focus:ring-1 focus:ring-[#22c55e]/25"
            >
              <option value="male">{t("appointments.male")}</option>
              <option value="female">{t("appointments.female")}</option>
            </select>
          </label>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={submitting || saving}
          className="rounded-xl border border-[#e5e7eb] bg-white px-4 py-2 text-sm font-medium text-[#111827] transition hover:bg-[#f3f4f6] disabled:opacity-60"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting || saving}
          className="rounded-xl bg-[#22c55e] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#16a34a] disabled:opacity-60"
        >
          {saving ? t("appointments.creating") : t("appointments.create")}
        </button>
      </div>
    </Modal>
  );
};
