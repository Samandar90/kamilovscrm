import React from "react";
import { useTranslation } from "react-i18next";

type Props = {
  clinicName: string;
  patientName: string;
  doctorName: string;
  visitDate: string;
  diagnosis: string;
  treatment: string;
  notes?: string | null;
};

export const PrescriptionTemplate: React.FC<Props> = ({
  clinicName,
  patientName,
  doctorName,
  visitDate,
  diagnosis,
  treatment,
  notes,
}) => {
  const { t } = useTranslation();
  return (
    <div style={{ fontFamily: "Arial, sans-serif", padding: 24, color: "#111" }}>
      <h1 style={{ marginBottom: 8 }}>{clinicName}</h1>
      <div style={{ marginBottom: 16, fontSize: 14 }}>
        <div>{t("appointments.date")}: {visitDate}</div>
        <div>{t("appointments.patient")}: {patientName}</div>
        <div>{t("appointments.doctor")}: {doctorName}</div>
      </div>
      <h2 style={{ marginBottom: 6, fontSize: 18 }}>{t("appointments.diagnosis")}</h2>
      <p style={{ whiteSpace: "pre-wrap", marginBottom: 12 }}>{diagnosis}</p>
      <h2 style={{ marginBottom: 6, fontSize: 18 }}>{t("appointments.treatment")}</h2>
      <p style={{ whiteSpace: "pre-wrap", marginBottom: 12 }}>{treatment}</p>
      {notes && (
        <>
          <h3 style={{ marginBottom: 6, fontSize: 16 }}>{t("appointments.notes")}</h3>
          <p style={{ whiteSpace: "pre-wrap" }}>{notes}</p>
        </>
      )}
    </div>
  );
};
