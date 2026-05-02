import type { AuthTokenPayload } from "../../repositories/interfaces/userTypes";
import type { ValidatedAction } from "./ai.validation";

export type AIExecutorDependencies = {
  patientsService: {
    create: (
      auth: AuthTokenPayload,
      payload: { fullName: string; phone: string | null; gender: "male" | "female" | "other" | "unknown" | null; birthDate: string | null }
    ) => Promise<{ id: number }>;
  };
  appointmentsService: {
    create: (
      auth: AuthTokenPayload,
      payload: {
        patientId: number;
        doctorId: number;
        serviceId: number;
        startAt: string;
        endAt: string;
        status: "scheduled";
        diagnosis: null;
        treatment: null;
        notes: null;
      }
    ) => Promise<{ id: number; startAt: string }>;
  };
  invoicesService: {
    create: (
      auth: AuthTokenPayload,
      payload: {
        patientId: number;
        appointmentId: number | null;
        status: "issued";
        items: Array<{ serviceId: number; quantity: number }>;
      }
    ) => Promise<{ id: number; number: string }>;
  };
  paymentsService: {
    create: (
      auth: AuthTokenPayload,
      payload: { invoiceId: number; amount: number; method: "cash" | "card" },
      clinicId: number
    ) => Promise<{ id: number; amount: number }>;
  };
  cashRegisterService: {
    closeShift: (
      auth: AuthTokenPayload,
      shiftId: number,
      payload: { closedBy?: number | null; notes?: string | null }
    ) => Promise<{ id: number }>;
  };
};

const formatSum = (value: number): string => `${Math.round(value).toLocaleString("ru-RU")} сум`;

export class AIExecutorService {
  constructor(private readonly deps: AIExecutorDependencies) {}

  async executeAction(action: ValidatedAction, auth: AuthTokenPayload): Promise<string> {
    if (action.type === "CREATE_PATIENT") {
      await this.deps.patientsService.create(auth, {
        fullName: action.payload.fullName,
        phone: null,
        gender: null,
        birthDate: null,
      });
      return `Пациент ${action.payload.fullName} успешно создан`;
    }

    if (action.type === "CREATE_APPOINTMENT") {
      const created = await this.deps.appointmentsService.create(auth, {
        patientId: action.payload.patientId,
        doctorId: action.payload.doctorId,
        serviceId: action.payload.serviceId,
        startAt: action.payload.startAt,
        endAt: action.payload.startAt,
        status: "scheduled",
        diagnosis: null,
        treatment: null,
        notes: null,
      });
      const time = created.startAt.slice(11, 16);
      return `✔ Запись создана на ${time}`;
    }

    if (action.type === "CREATE_INVOICE") {
      await this.deps.invoicesService.create(auth, {
        patientId: action.payload.patientId,
        appointmentId: action.payload.appointmentId,
        status: "issued",
        items: [{ serviceId: action.payload.serviceId, quantity: 1 }],
      });
      return "✔ Счет создан";
    }

    if (action.type === "CREATE_PAYMENT") {
      const payment = await this.deps.paymentsService.create(
        auth,
        {
          invoiceId: action.payload.invoiceId,
          amount: action.payload.amount,
          method: action.payload.method,
        },
        auth.clinicId
      );
      return `✔ Оплата проведена: ${formatSum(payment.amount)}`;
    }

    await this.deps.cashRegisterService.closeShift(auth, action.payload.shiftId, {
      closedBy: auth.userId,
      notes: "Closed by AI action",
    });
    return "✔ Смена закрыта";
  }
}

