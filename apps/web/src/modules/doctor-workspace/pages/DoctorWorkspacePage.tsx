import React from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../../auth/AuthContext";
import { appointmentsFlowApi, type Appointment, type Service } from "../../appointments/api/appointmentsFlowApi";
import { cashDeskApi } from "../../billing/api/cashDeskApi";
import { useClinic } from "../../../hooks/useClinic";

type WorkspaceForm = {
  diagnosis: string;
  treatment: string;
  notes: string;
};

const fieldClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20";

export const DoctorWorkspacePage: React.FC = () => {
  const { t } = useTranslation();
  const { appointmentId } = useParams<{ appointmentId: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const { clinic } = useClinic();
  const [appointment, setAppointment] = React.useState<Appointment | null>(null);
  const [patientName, setPatientName] = React.useState(t("common.patient"));
  const [serviceName, setServiceName] = React.useState(t("common.service"));
  const [servicesCatalog, setServicesCatalog] = React.useState<Service[]>([]);
  const [assignedServiceIds, setAssignedServiceIds] = React.useState<number[]>([]);
  const [servicePickerOpen, setServicePickerOpen] = React.useState(false);
  const [selectedServiceId, setSelectedServiceId] = React.useState("");
  const [form, setForm] = React.useState<WorkspaceForm>({
    diagnosis: "",
    treatment: "",
    notes: "",
  });
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [clinicPrintName, setClinicPrintName] = React.useState(t("common.clinic"));

  const parsedId = Number(appointmentId);
  const noServicesForDoctor = !loading && appointment !== null && servicesCatalog.length === 0;

  const load = React.useCallback(async () => {
    if (!token || !Number.isInteger(parsedId) || parsedId <= 0) return;
    setLoading(true);
    setError(null);
    try {
      const [rows, patients, assignedRows, clinicMeta] = await Promise.all([
        appointmentsFlowApi.listAppointments(token),
        appointmentsFlowApi.listPatients(token),
        appointmentsFlowApi.listAppointmentAssignedServices(token, parsedId).catch(() => []),
        cashDeskApi.getClinicMeta(token).catch(() => null),
      ]);
      setClinicPrintName(clinicMeta?.clinicName?.trim() || t("common.clinic"));
      const found = rows.find((row) => row.id === parsedId) ?? null;
      if (!found) {
        setError(t("doctorWorkspace.errors.appointmentNotFound"));
        setAppointment(null);
        return;
      }
      const doctorServices = await appointmentsFlowApi.listServices(token, found.doctorId);
      const patient = patients.find((row) => row.id === found.patientId);
      const service = doctorServices.find((row) => row.id === found.serviceId);
      setAppointment(found);
      setServicesCatalog(doctorServices);
      setAssignedServiceIds(assignedRows.map((row) => row.serviceId));
      setPatientName(patient?.fullName ?? t("common.patientWithId", { id: found.patientId }));
      setServiceName(service?.name ?? t("common.serviceWithId", { id: found.serviceId }));
      setSelectedServiceId("");
      setServicePickerOpen(false);
      setForm({
        diagnosis: found.diagnosis ?? "",
        treatment: found.treatment ?? "",
        notes: found.notes ?? "",
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("common.errors.loadError"));
    } finally {
      setLoading(false);
    }
  }, [parsedId, token]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 2400);
    return () => window.clearTimeout(t);
  }, [notice]);

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
      setNotice(t("common.actions.saved"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("doctorWorkspace.errors.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const completeVisit = async () => {
    if (!token || !appointment) return;
    if (!form.diagnosis.trim() || !form.treatment.trim()) {
      setError(t("doctorWorkspace.errors.missingDiagnosisTreatment"));
      return;
    }
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
      setError(requestError instanceof Error ? requestError.message : t("doctorWorkspace.errors.completeFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const addService = async () => {
    if (!token || !appointment) return;
    const serviceId = Number(selectedServiceId);
    if (!Number.isInteger(serviceId) || serviceId <= 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await appointmentsFlowApi.addAppointmentService(token, appointment.id, serviceId);
      setAssignedServiceIds((prev) => (prev.includes(serviceId) ? prev : [...prev, serviceId]));
      setSelectedServiceId("");
      setServicePickerOpen(false);
      setNotice(t("doctorWorkspace.notices.serviceAdded"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("doctorWorkspace.errors.addServiceFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const createInvoice = async () => {
    if (!token || !appointment) return;
    setSubmitting(true);
    setError(null);
    try {
      await appointmentsFlowApi.createInvoiceFromAppointment(token, appointment.id);
      setNotice(t("doctorWorkspace.notices.invoiceCreated"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("doctorWorkspace.errors.createInvoiceFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const printPrescription = (targetAppointment: Appointment) => {
    const safeClinicName = clinicPrintName
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    const serviceLines = assignedServiceIds.length
      ? assignedServiceIds
          .map((id) => servicesCatalog.find((s) => s.id === id)?.name ?? t("common.serviceWithId", { id }))
          .map((name) => `<li>${name}</li>`)
          .join("")
      : `<li>${serviceName}</li>`;
    const win = window.open("", "_blank");
    if (!win) return;

    const dateLabel = new Date(targetAppointment.startAt.includes(" ") ? targetAppointment.startAt.replace(" ", "T") : targetAppointment.startAt)
      .toLocaleString(navigator.language);

    const html = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <title>Назначение пациента</title>
    <style>
      @page { size: A4; margin: 14mm 14mm 16mm; }
      body {
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
        color: #0f172a;
        margin: 0;
        font-size: 15px;
        line-height: 1.45;
      }
      .sheet { width: 100%; }
      .header {
        display: flex;
        align-items: center;
        gap: 14px;
        border-bottom: 1px solid #e2e8f0;
        padding-bottom: 12px;
        margin-bottom: 14px;
      }
      .logo {
        width: 44px;
        height: 44px;
        object-fit: contain;
      }
      .clinic-name {
        font-size: 18px;
        font-weight: 700;
        letter-spacing: 0.01em;
      }
      .meta {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px 14px;
        margin-bottom: 14px;
      }
      .meta-row { font-size: 14px; }
      .meta-row b { color: #334155; }
      .section {
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 12px 14px;
        margin-bottom: 10px;
        page-break-inside: avoid;
      }
      .section-title {
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: #334155;
        margin-bottom: 8px;
      }
      .text { white-space: pre-wrap; min-height: 44px; }
      .services { margin: 0; padding-left: 18px; }
      .services li { margin: 0 0 4px 0; }
      .footer {
        margin-top: 20px;
        padding-top: 8px;
        border-top: 1px solid #e2e8f0;
        font-size: 13px;
        color: #64748b;
      }
    </style>
  </head>
  <body>
    <main class="sheet">
      <header class="header">
        <img src="${clinic.logoUrl}" alt="${t("doctorWorkspace.print.clinicLogo")}" class="logo" />
        <div class="clinic-name">${safeClinicName}</div>
      </header>

      <section class="meta">
        <div class="meta-row"><b>${t("doctorWorkspace.print.patient")}:</b> ${patientName}</div>
        <div class="meta-row"><b>${t("doctorWorkspace.print.date")}:</b> ${dateLabel}</div>
        <div class="meta-row"><b>${t("doctorWorkspace.print.doctor")}:</b> #${targetAppointment.doctorId}</div>
        <div class="meta-row"><b>${t("doctorWorkspace.print.appointment")}:</b> #${targetAppointment.id}</div>
      </section>

      <section class="section">
        <div class="section-title">${t("doctorWorkspace.print.diagnosis")}</div>
        <div class="text">${form.diagnosis || "—"}</div>
      </section>

      <section class="section">
        <div class="section-title">${t("doctorWorkspace.print.treatment")}</div>
        <div class="text">${form.treatment || "—"}</div>
      </section>

      <section class="section">
        <div class="section-title">${t("doctorWorkspace.print.prescription")}</div>
        <div class="text">${form.notes || "—"}</div>
      </section>

      <section class="section">
        <div class="section-title">${t("doctorWorkspace.print.services")}</div>
        <ul class="services">${serviceLines}</ul>
      </section>

      <footer class="footer">${t("doctorWorkspace.print.footer")}</footer>
    </main>
  </body>
</html>`;

    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    return <div className="p-4 text-sm text-rose-600">{t("doctorWorkspace.errors.invalidAppointmentId")}</div>;
  }

  return (
    <div className="min-h-full overflow-x-hidden bg-[#f8fafc] max-md:[&_button]:min-h-[44px] md:mx-auto md:max-w-3xl md:rounded-2xl md:border md:border-slate-200 md:bg-white md:p-6">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-[#f8fafc] px-4 py-3 md:static md:border-0 md:bg-transparent md:px-0 md:py-0">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700"
          aria-label={t("common.actions.back")}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-slate-900">{patientName}</h1>
          <p className="truncate text-xs text-slate-500">{serviceName}</p>
        </div>
      </header>

      <div className="space-y-3 px-4 pb-28 pt-3 md:px-0 md:pb-0 md:pt-5">
        {loading ? <p className="text-sm text-slate-500">{t("common.states.loading")}</p> : null}
        {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        {notice ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p> : null}

        <section className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("doctorWorkspace.form.diagnosis")}</label>
          <textarea
            value={form.diagnosis}
            onChange={(e) => setForm((prev) => ({ ...prev, diagnosis: e.target.value }))}
            className={`${fieldClass} min-h-[120px]`}
            placeholder={t("doctorWorkspace.form.diagnosisPlaceholder")}
            disabled={loading || submitting}
          />
        </section>

        <section className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("doctorWorkspace.form.treatment")}</label>
          <textarea
            value={form.treatment}
            onChange={(e) => setForm((prev) => ({ ...prev, treatment: e.target.value }))}
            className={`${fieldClass} min-h-[120px]`}
            placeholder={t("doctorWorkspace.form.treatmentPlaceholder")}
            disabled={loading || submitting}
          />
        </section>

        <section className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("doctorWorkspace.form.prescription")}</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
            className={`${fieldClass} min-h-[120px]`}
            placeholder={t("doctorWorkspace.form.prescriptionPlaceholder")}
            disabled={loading || submitting}
          />
        </section>

        <div className="my-2 border-t border-slate-200" />

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-900">{t("doctorWorkspace.actions.title")}</h2>

          <button
            type="button"
            onClick={() => setServicePickerOpen((v) => !v)}
            disabled={loading || submitting || !appointment || noServicesForDoctor}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700"
          >
            {t("doctorWorkspace.actions.addService")}
          </button>
          {noServicesForDoctor ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">
              {t("doctorWorkspace.errors.noServicesForDoctor")}
            </p>
          ) : null}
          {servicePickerOpen ? (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
              <select
                value={selectedServiceId}
                onChange={(e) => setSelectedServiceId(e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none"
              >
                <option value="">{t("doctorWorkspace.actions.selectService")}</option>
                {servicesCatalog.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void addService()}
                disabled={!selectedServiceId || submitting}
                className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {t("doctorWorkspace.actions.saveService")}
              </button>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => void createInvoice()}
            disabled={loading || submitting || !appointment}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700"
          >
            {t("doctorWorkspace.actions.createInvoice")}
          </button>

          <button
            type="button"
            onClick={() => appointment && printPrescription(appointment)}
            disabled={loading || submitting || !appointment}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700"
          >
            {t("doctorWorkspace.actions.printPrescription")}
          </button>
        </section>
      </div>

      <div className="mx-4 border-t border-slate-200 md:mx-0" />

      <footer className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white px-4 py-3 md:static md:mt-6 md:border-0 md:p-0">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void saveDraft()}
            disabled={loading || submitting || !appointment}
            className="inline-flex min-h-[46px] flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-50"
          >
            {t("common.actions.save")}
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
            {t("doctorWorkspace.actions.completeVisit")}
          </button>
        </div>
      </footer>
    </div>
  );
};

