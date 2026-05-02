import {
  APPOINTMENT_STATUSES,
  type AppointmentBillingStatus,
  type AppointmentStatus,
  type PatientGender,
  type PatientSource,
} from "./interfaces/coreTypes";
import type {
  CashEntryMethod,
  CashEntryType,
  InvoiceStatus,
  PaymentMethod,
} from "./interfaces/billingTypes";
import type { UserRole } from "./interfaces/userTypes";
import { hashPasswordSync } from "../utils/password";

export type PatientRecord = {
  id: number;
  fullName: string;
  phone: string | null;
  gender: PatientGender | null;
  birthDate: string | null;
  source: PatientSource | null;
  notes: string | null;
  createdAt: string;
  deletedAt: string | null;
};

export type DoctorRecord = {
  id: number;
  name: string;
  speciality: string;
  percent: number;
  phone?: string | null;
  birth_date?: string | null;
  active: boolean;
  createdAt: string;
};

export type ServiceRecord = {
  id: number;
  name: string;
  category: string;
  price: number;
  duration: number;
  active: boolean;
  createdAt: string;
};

export type DoctorServiceRecord = {
  doctorId: number;
  serviceId: number;
};

export type AppointmentRecord = {
  id: number;
  patientId: number;
  doctorId: number;
  serviceId: number;
  price: number | null;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  billingStatus: AppointmentBillingStatus;
  cancelReason: string | null;
  cancelledAt: string | null;
  cancelledBy: number | null;
  diagnosis: string | null;
  treatment: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AppointmentServiceRecord = {
  id: number;
  appointmentId: number;
  serviceId: number;
  price: number;
  quantity: number;
  createdBy: number | null;
  createdAt: string;
};

export type InvoiceRecord = {
  id: number;
  number: string;
  patientId: number;
  appointmentId: number | null;
  status: InvoiceStatus;
  subtotal: number;
  discount: number;
  total: number;
  paidAmount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type InvoiceItemRecord = {
  id: number;
  invoiceId: number;
  serviceId: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type PaymentRecord = {
  id: number;
  invoiceId: number;
  amount: number;
  refundedAmount: number;
  method: PaymentMethod;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  voidReason: string | null;
  idempotencyKey: string;
  idempotencyKeyClientSupplied: boolean;
  createdBy: number | null;
};

export type CashRegisterShiftRecord = {
  id: number;
  openedBy: number | null;
  closedBy: number | null;
  openedAt: string;
  closedAt: string | null;
  openingBalance: number;
  closingBalance: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CashRegisterEntryRecord = {
  id: number;
  shiftId: number;
  paymentId: number | null;
  type: CashEntryType;
  amount: number;
  method: CashEntryMethod;
  note: string | null;
  createdAt: string;
};

export type ExpenseRecord = {
  id: number;
  amount: number;
  category: string;
  description: string | null;
  paidAt: string;
  createdAt: string;
  deletedAt: string | null;
};

export type UserRecord = {
  id: number;
  clinicId: number;
  username: string;
  password: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt?: string | null;
  failedLoginAttempts?: number;
  lockedUntil?: string | null;
  /** Только для role doctor → JWT `doctorId`. У медсестры привязка в таблице `nurses`. */
  doctorId?: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

type MockDatabase = {
  patients: PatientRecord[];
  doctors: DoctorRecord[];
  services: ServiceRecord[];
  doctorServices: DoctorServiceRecord[];
  appointments: AppointmentRecord[];
  appointmentServices: AppointmentServiceRecord[];
  invoices: InvoiceRecord[];
  invoiceItems: InvoiceItemRecord[];
  payments: PaymentRecord[];
  expenses: ExpenseRecord[];
  cashRegisterShifts: CashRegisterShiftRecord[];
  cashRegisterEntries: CashRegisterEntryRecord[];
  users: UserRecord[];
  /** Связь user (nurse) → врач. */
  nurses: { id: number; userId: number; doctorId: number }[];
};

const nowIso = (): string => new Date().toISOString();

const createId = (): number => Date.now() + Math.floor(Math.random() * 1000);

const mockDb: MockDatabase = {
  patients: [],
  doctors: [],
  services: [],
  doctorServices: [],
  appointments: [],
  appointmentServices: [],
  invoices: [],
  invoiceItems: [],
  payments: [],
  expenses: [],
  cashRegisterShifts: [],
  cashRegisterEntries: [],
  users: [],
  nurses: [],
};

let seeded = false;

/** Только первый вход в режиме mock; клинические сущности — пустые до действий пользователя. */
export const ensureMockSeedData = (): void => {
  if (seeded) return;
  seeded = true;

  const createdAt = nowIso();
  mockDb.users = [
    {
      id: createId(),
      clinicId: 1,
      username: "admin",
      password: hashPasswordSync("admin123"),
      fullName: "Administrator",
      role: "superadmin",
      isActive: true,
      lastLoginAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      doctorId: null,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    },
  ];
};

export const nextId = (): number => createId();
export const getMockDb = (): MockDatabase => mockDb;
