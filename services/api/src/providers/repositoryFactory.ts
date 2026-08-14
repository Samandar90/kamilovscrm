import { env } from "../config/env";
import type { IAppointmentsRepository } from "../repositories/interfaces/IAppointmentsRepository";
import type { ICashRegisterRepository } from "../repositories/interfaces/ICashRegisterRepository";
import type { IDoctorsRepository } from "../repositories/interfaces/IDoctorsRepository";
import type { IExpensesRepository } from "../repositories/interfaces/IExpensesRepository";
import type { IInvoicesRepository } from "../repositories/interfaces/IInvoicesRepository";
import type { IPatientsRepository } from "../repositories/interfaces/IPatientsRepository";
import type { IPaymentsRepository } from "../repositories/interfaces/IPaymentsRepository";
import type { IReportsRepository } from "../repositories/interfaces/IReportsRepository";
import type { IServicesRepository } from "../repositories/interfaces/IServicesRepository";
import type { INursesRepository } from "../repositories/interfaces/INursesRepository";
import type { IUsersRepository } from "../repositories/interfaces/IUsersRepository";
import type { IAttendanceRepository } from "../repositories/interfaces/IAttendanceRepository";
import type { ICallCenterRepository } from "../repositories/interfaces/ICallCenterRepository";
import { MockAppointmentsRepository } from "../repositories/appointmentsRepository";
import { MockCashRegisterRepository } from "../repositories/cashRegisterRepository";
import { MockDoctorsRepository } from "../repositories/doctorsRepository";
import { MockExpensesRepository } from "../repositories/expensesRepository";
import { MockInvoicesRepository } from "../repositories/invoicesRepository";
import { MockPatientsRepository } from "../repositories/patientsRepository";
import { MockPaymentsRepository } from "../repositories/paymentsRepository";
import { MockReportsRepository } from "../repositories/reportsRepository";
import { MockServicesRepository } from "../repositories/servicesRepository";
import { MockNursesRepository } from "../repositories/nursesRepository";
import { MockUsersRepository } from "../repositories/usersRepository";
import { MockAttendanceRepository } from "../repositories/attendanceRepository";
import { MockCallCenterRepository } from "../repositories/callCenterRepository";
import { PostgresAppointmentsRepository } from "../repositories/postgres/PostgresAppointmentsRepository";
import { PostgresCashRegisterRepository } from "../repositories/postgres/PostgresCashRegisterRepository";
import { PostgresDoctorsRepository } from "../repositories/postgres/PostgresDoctorsRepository";
import { PostgresExpensesRepository } from "../repositories/postgres/PostgresExpensesRepository";
import { PostgresInvoicesRepository } from "../repositories/postgres/PostgresInvoicesRepository";
import { PostgresPatientsRepository } from "../repositories/postgres/PostgresPatientsRepository";
import { PostgresPaymentsRepository } from "../repositories/postgres/PostgresPaymentsRepository";
import { PostgresReportsRepository } from "../repositories/postgres/PostgresReportsRepository";
import { PostgresServicesRepository } from "../repositories/postgres/PostgresServicesRepository";
import { PostgresNursesRepository } from "../repositories/postgres/PostgresNursesRepository";
import { PostgresUsersRepository } from "../repositories/postgres/PostgresUsersRepository";
import { PostgresAttendanceRepository } from "../repositories/postgres/PostgresAttendanceRepository";
import { PostgresCallCenterRepository } from "../repositories/postgres/PostgresCallCenterRepository";

export type CoreRepositories = {
  patients: IPatientsRepository;
  doctors: IDoctorsRepository;
  services: IServicesRepository;
  appointments: IAppointmentsRepository;
  invoices: IInvoicesRepository;
  payments: IPaymentsRepository;
  expenses: IExpensesRepository;
  cashRegister: ICashRegisterRepository;
  reports: IReportsRepository;
  users: IUsersRepository;
  attendance: IAttendanceRepository;
  callCenter: ICallCenterRepository;
  nurses: INursesRepository;
};

export const createRepositories = (): CoreRepositories => {
  if (env.dataProvider === "postgres") {
    return {
      patients: new PostgresPatientsRepository(),
      doctors: new PostgresDoctorsRepository(),
      services: new PostgresServicesRepository(),
      appointments: new PostgresAppointmentsRepository(),
      invoices: new PostgresInvoicesRepository(),
      payments: new PostgresPaymentsRepository(),
      expenses: new PostgresExpensesRepository(),
      cashRegister: new PostgresCashRegisterRepository(),
      reports: new PostgresReportsRepository(),
      users: new PostgresUsersRepository(),
      attendance: new PostgresAttendanceRepository(),
      callCenter: new PostgresCallCenterRepository(),
      nurses: new PostgresNursesRepository(),
    };
  }

  return {
    patients: new MockPatientsRepository(),
    doctors: new MockDoctorsRepository(),
    services: new MockServicesRepository(),
    appointments: new MockAppointmentsRepository(),
    invoices: new MockInvoicesRepository(),
    payments: new MockPaymentsRepository(),
    expenses: new MockExpensesRepository(),
    cashRegister: new MockCashRegisterRepository(),
    reports: new MockReportsRepository(),
    users: new MockUsersRepository(),
    attendance: new MockAttendanceRepository(),
    callCenter: new MockCallCenterRepository(),
    nurses: new MockNursesRepository(),
  };
};
