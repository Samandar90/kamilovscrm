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
import { repositories } from "./repositories";

export const services = {
  patients: new PatientsService(repositories.patients, repositories.appointments),
  doctors: new DoctorsService(repositories.doctors, repositories.services),
  services: new ServicesService(repositories.services),
  appointments: new AppointmentsService(repositories.appointments),
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
};
