import React from "react";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../../auth/AuthContext";
import { appointmentsFlowApi, type Appointment } from "../../appointments/api/appointmentsFlowApi";

type WorkspaceForm = {
  diagnosis: string;
  treatment: string;
  notes: string;
};

const fieldClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20";

export const DoctorWorkspacePage: React.FC = () => {
  const { appointmentId } = useParams<{ appointmentId: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const [appointment, setAppointment] = React.useState<Appointment | null>(null);
  const [patientName, setPatientName] = React.useState("Пациент");
  const [serviceName, setServiceName] = React.useState("Услуга");
  const [form, setForm] = React.useState<WorkspaceForm>({
    diagnosis: "",
    treatment: "",
    notes: "",
  });
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const parsedId = Number(appointmentId);

  const load = React.useCallback(async () => {
    if (!token || !Number.isInteger(parsedId) || parsedId <= 0) return;
    setLoading(true);
    setError(null);
    try {
      const [rows, patients, services] = await Promise.all([
        appointmentsFlowApi.listAppointments(token),
        appointmentsFlowApi.listPatients(token),
        appointmentsFlowApi.listServices(token),
      ]);
      const found = rows.find((row) => row.id === parsedId) ?? null;
      if (!found) {
        setError("Запись не найдена");
        setAppointment(null);
        return;
      }
      const patient = patients.find((row) => row.id === found.patientId);
      const service = services.find((row) => row.id === found.serviceId);
      setAppointment(found);
      setPatientName(patient?.fullName ?? `Пациент #${found.patientId}`);
      setServiceName(service?.name ?? `Услуга #${found.serviceId}`);
      setForm({
        diagnosis: found.diagnosis ?? "",
        treatment: found.treatment ?? "",
        notes: found.notes ?? "",
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }, [parsedId, token]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const saveDraft = async () => {
    if (!token || !appointment) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await appointmentsFlowApi.updateAppointment(token, appointment.id, {
        diagnosis: form.diagnosis.trim() || null,
        treatment: form.treatment.trim() || null,
        notes: form.notes.trim() || null,
      });
      setAppointment(updated);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось сохранить");
    } finally {
      setSubmitting(false);
    }
  };

  const completeVisit = async () => {
    if (!token || !appointment) return;
    setSubmitting(true);
    setError(null);
    try {
      await appointmentsFlowApi.completeAppointment(token, appointment.id, {
        diagnosis: form.diagnosis.trim() || null,
        treatment: form.treatment.trim() || null,
        notes: form.notes.trim() || null,
      });
      navigate("/appointments");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось завершить приём");
    } finally {
      setSubmitting(false);
    }
  };

  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    return <div className="p-4 text-sm text-rose-600">Некорректный ID записи.</div>;
  }

  return (
    <div className="min-h-full bg-[#f8fafc] md:mx-auto md:max-w-3xl md:rounded-2xl md:border md:border-slate-200 md:bg-white md:p-6">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-[#f8fafc] px-4 py-3 md:static md:border-0 md:bg-transparent md:px-0 md:py-0">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700"
          aria-label="Назад"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-slate-900">{patientName}</h1>
          <p className="truncate text-xs text-slate-500">{serviceName}</p>
        </div>
      </header>

      <div className="space-y-3 px-4 pb-28 pt-3 md:px-0 md:pb-0 md:pt-5">
        {loading ? <p className="text-sm text-slate-500">Загрузка...</p> : null}
        {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

        <section className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Диагноз</label>
          <textarea
            value={form.diagnosis}
            onChange={(e) => setForm((prev) => ({ ...prev, diagnosis: e.target.value }))}
            className={`${fieldClass} min-h-[120px]`}
            placeholder="Введите диагноз"
            disabled={loading || submitting}
          />
        </section>

        <section className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Лечение</label>
          <textarea
            value={form.treatment}
            onChange={(e) => setForm((prev) => ({ ...prev, treatment: e.target.value }))}
            className={`${fieldClass} min-h-[120px]`}
            placeholder="Опишите лечение"
            disabled={loading || submitting}
          />
        </section>

        <section className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Назначение</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
            className={`${fieldClass} min-h-[120px]`}
            placeholder="Рекомендации и назначения"
            disabled={loading || submitting}
          />
        </section>
      </div>

      <footer className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white px-4 py-3 md:static md:mt-6 md:border-0 md:p-0">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void saveDraft()}
            disabled={loading || submitting || !appointment}
            className="inline-flex min-h-[46px] flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-50"
          >
            Сохранить
          </button>
          <button
            type="button"
            onClick={() => void completeVisit()}
            disabled={
              loading ||
              submitting ||
              !appointment ||
              !form.diagnosis.trim() ||
              !form.treatment.trim()
            }
            className="inline-flex min-h-[46px] flex-1 items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            Завершить приём
          </button>
        </div>
      </footer>
    </div>
  );
};

