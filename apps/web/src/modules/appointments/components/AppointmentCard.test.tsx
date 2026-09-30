import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { Appointment, AppointmentStatus } from "../api/appointmentsFlowApi";
import type { UserRole } from "../../../auth/types";
import { canIssueQueue, canReadQueue } from "../../../auth/roleGroups";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
// shared/ui (Logo -> useClinic) imports api/http, which imports ../i18n and initialises i18next at import time.
vi.mock("../../../i18n", () => ({ default: { t: (key: string) => key } }));
import { AppointmentCard } from "./AppointmentCard";

const appointment = (status: AppointmentStatus, queueCode: string | null = null): Appointment => ({
  id: 7,
  patientId: 1,
  doctorId: 2,
  serviceId: 3,
  price: null,
  startAt: "2026-09-30 10:00:00",
  endAt: "2026-09-30 10:30:00",
  status,
  billingStatus: "draft",
  cancelReason: null,
  cancelledAt: null,
  cancelledBy: null,
  diagnosis: null,
  treatment: null,
  notes: null,
  createdAt: "2026-09-30 09:00:00",
  updatedAt: "2026-09-30 09:00:00",
  queueNumber: queueCode ? 5 : null,
  queueCode,
});

const render = (item: Appointment, canPrintQueueTicket = true, canIssueQueueNumber = false) => {
  const onPrintTicket = vi.fn();
  const onIssueQueueNumber = vi.fn();
  const view: ReactTestRenderer = create(
    <AppointmentCard
      appointment={item}
      invoice={null}
      patientName="Test patient"
      doctorName="Test doctor"
      service={undefined}
      timeLabel="10:00"
      glassPanelClass=""
      isSubmitting={false}
      canManageAppointmentFlow
      showFinancialDetails={false}
      canCreateInvoice={false}
      onMarkArrived={vi.fn()}
      onCompleteConsultation={vi.fn()}
      onCreateInvoice={vi.fn()}
      onCancelAppointment={vi.fn()}
      onEditPrice={vi.fn()}
      canHardDeleteAppointment={false}
      onDeleteAppointment={vi.fn()}
      showCancelButton={false}
      canEditAppointmentPrice={false}
      onOpenDoctorWorkspace={vi.fn()}
      onCardClick={vi.fn()}
      canPrintQueueTicket={canPrintQueueTicket}
      isPrintingTicket={false}
      onPrintTicket={onPrintTicket}
      canIssueQueueNumber={canIssueQueueNumber}
      isIssuingQueueNumber={false}
      onIssueQueueNumber={onIssueQueueNumber}
    />
  );
  const button = (label: string) => view.root.findAllByType("button").find((b) => b.props.children === label);
  const texts = (): string[] =>
    view.root.findAll((node) => typeof node.type === "string").flatMap((node) =>
      node.children.filter((child): child is string => typeof child === "string")
    );
  return { view, button, texts, onPrintTicket, onIssueQueueNumber };
};
/** The page passes canReadQueue(role) / canIssueQueue(role); the card only sees the booleans. */
const renderAs = (item: Appointment, role: UserRole) => render(item, canReadQueue(role), canIssueQueue(role));

describe("AppointmentCard queue details", () => {
  it("shows the real status label for every status", () => {
    const statuses: AppointmentStatus[] = ["scheduled", "confirmed", "arrived", "in_consultation", "completed", "cancelled", "no_show"];
    for (const status of statuses) {
      expect(render(appointment(status)).texts()).toContain(`appointments.statusLabels.${status}`);
    }
  });

  it("shows the queue code and a «Талон» button for an arrived patient with a number", () => {
    const card = render(appointment("arrived", "К-05"));
    expect(card.texts()).toContain("К-05");
    card.button("appointments.queue.ticket")!.props.onClick();
    expect(card.onPrintTicket).toHaveBeenCalledTimes(1);
  });

  it("hides «Талон» without a number, after arrival, or without queue access", () => {
    expect(render(appointment("arrived")).button("appointments.queue.ticket")).toBeUndefined();
    expect(render(appointment("in_consultation", "К-05")).button("appointments.queue.ticket")).toBeUndefined();
    expect(render(appointment("arrived", "К-05"), false).button("appointments.queue.ticket")).toBeUndefined();
  });

  it("labels the first step «Отметить приход» for a booked visit", () => {
    expect(render(appointment("scheduled")).button("appointment.markArrived")).toBeDefined();
  });
});

describe("AppointmentCard «Выдать номер»", () => {
  it("offers reception «Выдать номер» for an arrived patient without a number", () => {
    const card = renderAs(appointment("arrived"), "reception");
    card.button("appointments.queue.issue")!.props.onClick();
    expect(card.onIssueQueueNumber).toHaveBeenCalledTimes(1);
    expect(card.button("appointments.queue.ticket")).toBeUndefined();
  });

  it("shows «Талон» instead once the visit has a number", () => {
    const card = renderAs(appointment("arrived", "К-05"), "reception");
    expect(card.button("appointments.queue.issue")).toBeUndefined();
    expect(card.button("appointments.queue.ticket")).toBeDefined();
  });

  it("hides it from read-only queue roles and for visits that are not waiting", () => {
    expect(renderAs(appointment("arrived"), "manager").button("appointments.queue.issue")).toBeUndefined();
    expect(renderAs(appointment("arrived"), "doctor").button("appointments.queue.issue")).toBeUndefined();
    expect(renderAs(appointment("scheduled"), "reception").button("appointments.queue.issue")).toBeUndefined();
    expect(renderAs(appointment("in_consultation"), "reception").button("appointments.queue.issue")).toBeUndefined();
  });
});
