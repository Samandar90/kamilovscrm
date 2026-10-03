import { AppointmentsService } from "../services/appointmentsService";
import { AuthService } from "../services/authService";
import { CashRegisterService } from "../services/cashRegisterService";
import { DoctorsService } from "../services/doctorsService";
import { ExpensesService } from "../services/expensesService";
import { InvoicesService } from "../services/invoicesService";
import { PatientsService } from "../services/patientsService";
import { PaymentsService } from "../services/paymentsService";
import { ReportsService } from "../services/reportsService";
import { ServicesService } from "../services/servicesService";
import { AIService } from "../services/aiService";
import { AIAssistantService } from "../services/aiAssistantService";
import { AIRecommendationsService } from "../services/aiRecommendationsService";
import { UsersService } from "../services/usersService";
import { UziTemplatesService } from "../services/uziTemplatesService";
import { AttendanceService } from "../services/attendanceService";
import { CallCenterService } from "../services/callCenterService";
import { CallCenterWorkspaceService } from "../services/callCenterWorkspaceService";
import { PostgresCallCenterWorkspaceRepository } from "../repositories/postgres/PostgresCallCenterWorkspaceRepository";
import { QuestionnairesService } from "../services/questionnairesService";
import { PostgresQuestionnairesRepository } from "../repositories/postgres/PostgresQuestionnairesRepository";
import { QueueService } from "../services/queueService";
import { PostgresQueueRepository } from "../repositories/postgres/PostgresQueueRepository";
import { QueueDisplaysService } from "../services/queueDisplaysService";
import { PostgresQueueDisplaysRepository } from "../repositories/postgres/PostgresQueueDisplaysRepository";
import { LeadsService } from "../services/leadsService";
import { PostgresLeadsRepository } from "../repositories/postgres/PostgresLeadsRepository";
import { dbPool } from "../config/database";
import { env } from "../config/env";
import { repositories } from "./repositories";

// Один репозиторий очереди на сотрудников и публичный ТВ-экран.
const queueRepository = new PostgresQueueRepository(dbPool);

export const services = {
  patients: new PatientsService(repositories.patients, repositories.appointments),
  doctors: new DoctorsService(repositories.doctors, repositories.services),
  services: new ServicesService(repositories.services),
  appointments: new AppointmentsService(repositories.appointments, env.reportsTimezone),
  invoices: new InvoicesService(
    repositories.invoices,
    repositories.services,
    repositories.appointments
  ),
  payments: new PaymentsService(
    repositories.payments,
    repositories.cashRegister,
    repositories.appointments
  ),
  expenses: new ExpensesService(repositories.expenses),
  cashRegister: new CashRegisterService(repositories.cashRegister),
  reports: new ReportsService(repositories.reports),
  users: new UsersService(repositories.users, repositories.doctors, repositories.nurses),
  auth: new AuthService(repositories.users, repositories.nurses),
  aiAssistant: new AIAssistantService(),
  aiService: new AIService(repositories.users),
  aiRecommendations: new AIRecommendationsService(repositories.reports),
  uziTemplates: new UziTemplatesService(repositories.doctors),
  attendance: new AttendanceService(repositories.attendance, repositories.users),
  callCenter: new CallCenterService(repositories.callCenter),
  callCenterWorkspace: new CallCenterWorkspaceService(new PostgresCallCenterWorkspaceRepository(dbPool, env.reportsTimezone)),
  questionnaires: new QuestionnairesService(
    new PostgresQuestionnairesRepository(dbPool, env.reportsTimezone),
    repositories.appointments
  ),
  queue: new QueueService(queueRepository, env.reportsTimezone),
  queueDisplays: new QueueDisplaysService(
    new PostgresQueueDisplaysRepository(dbPool),
    queueRepository,
    env.reportsTimezone
  ),
  leads: new LeadsService(new PostgresLeadsRepository(dbPool)),
};
