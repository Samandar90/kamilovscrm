import React from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { DashboardPage } from "../modules/dashboard/pages/DashboardPage";
import { PatientsPage } from "../modules/patients/pages/PatientsPage";
import { AppointmentsPage } from "../modules/appointments/pages/AppointmentsPage";
import { InvoiceDetailsPage } from "../modules/billing/pages/InvoiceDetailsPage";
import { InvoicesPage } from "../modules/billing/pages/InvoicesPage";
import { CashDeskPage } from "../modules/billing/pages/CashDeskPage";
import { CashShiftPage } from "../modules/billing/pages/CashShiftPage";
import { PaymentsReadOnlyPage } from "../modules/billing/pages/PaymentsReadOnlyPage";
import { ExpensesPage } from "../modules/expenses/pages/ExpensesPage";
import { ReportsPage } from "../modules/reports/pages/ReportsPage";
import { ArchitecturePage } from "../modules/system/pages/ArchitecturePage";
import { UsersPage } from "../modules/users/pages/UsersPage";
import { ServicesPage } from "../modules/services/pages/ServicesPage";
import { DoctorsPage } from "../modules/doctors/pages/DoctorsPage";
import { LoginPage } from "../modules/auth/pages/LoginPage";
import { AIAssistantPage } from "../modules/ai-assistant/pages/AIAssistantPage";
import { DoctorWorkspacePage } from "../modules/doctor-workspace/pages/DoctorWorkspacePage";
import { MainLayout } from "../layouts/MainLayout";
import { GuestRoute } from "../auth/guards/GuestRoute";
import { ProtectedRoute } from "../auth/guards/ProtectedRoute";
import { RoleGuard } from "../auth/guards/RoleGuard";
import {
  APPOINTMENTS_PAGE_ROUTE_ROLES,
  BILLING_ROLES,
  CLINIC_STAFF,
  DOCTORS_DIRECTORY_ROLES,
  EXPENSES_READ_ROLES,
  PATIENTS_PAGE_ROUTE_ROLES,
  PAYMENTS_READ_PAGE_ROLES,
  REPORT_ROLES,
  SERVICES_DIRECTORY_ROLES,
  SYSTEM_ARCH_ROLES,
  USERS_PAGE_ROLES,
} from "../auth/roleGroups";

const RoleAwareHomeRedirect: React.FC = () => {
  const { user } = useAuth();
  if (user?.role === "nurse") {
    return <Navigate to="/appointments" replace />;
  }
  if (user?.role === "cashier") {
    return <Navigate to="/billing/cash-desk" replace />;
  }
  if (user?.role === "accountant") {
    return <Navigate to="/reports" replace />;
  }
  return <DashboardPage />;
};

export const AppRouter: React.FC = () => {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <GuestRoute>
            <LoginPage />
          </GuestRoute>
        }
      />
      <Route
        element={
          <ProtectedRoute>
            <MainLayout>
              <Outlet />
            </MainLayout>
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<RoleAwareHomeRedirect />} />
        <Route path="/dashboard" element={<RoleAwareHomeRedirect />} />
        <Route
          path="/ai-assistant"
          element={
            <RoleGuard roles={CLINIC_STAFF}>
              <AIAssistantPage />
            </RoleGuard>
          }
        />
        <Route
          path="/patients"
          element={
            <RoleGuard roles={PATIENTS_PAGE_ROUTE_ROLES}>
              <PatientsPage />
            </RoleGuard>
          }
        />
        <Route
          path="/appointments"
          element={
            <RoleGuard roles={APPOINTMENTS_PAGE_ROUTE_ROLES}>
              <AppointmentsPage />
            </RoleGuard>
          }
        />
        <Route
          path="/appointments/new"
          element={
            <RoleGuard roles={APPOINTMENTS_PAGE_ROUTE_ROLES}>
              <AppointmentsPage />
            </RoleGuard>
          }
        />
        <Route
          path="/doctor-workspace/:appointmentId"
          element={
            <RoleGuard roles={APPOINTMENTS_PAGE_ROUTE_ROLES}>
              <DoctorWorkspacePage />
            </RoleGuard>
          }
        />
        <Route
          path="/doctors"
          element={
            <RoleGuard roles={DOCTORS_DIRECTORY_ROLES}>
              <DoctorsPage />
            </RoleGuard>
          }
        />
        <Route
          path="/services"
          element={
            <RoleGuard roles={SERVICES_DIRECTORY_ROLES}>
              <ServicesPage />
            </RoleGuard>
          }
        />
        <Route
          path="/users"
          element={
            <RoleGuard roles={USERS_PAGE_ROLES}>
              <UsersPage />
            </RoleGuard>
          }
        />
        <Route
          path="/billing"
          element={
            <RoleGuard roles={BILLING_ROLES}>
              <Navigate to="/billing/invoices" replace />
            </RoleGuard>
          }
        />
        <Route
          path="/billing/invoices/:id"
          element={
            <RoleGuard roles={BILLING_ROLES}>
              <InvoiceDetailsPage />
            </RoleGuard>
          }
        />
        <Route
          path="/billing/invoices"
          element={
            <RoleGuard roles={BILLING_ROLES}>
              <InvoicesPage />
            </RoleGuard>
          }
        />
        <Route
          path="/billing/payments"
          element={
            <RoleGuard roles={PAYMENTS_READ_PAGE_ROLES}>
              <PaymentsReadOnlyPage />
            </RoleGuard>
          }
        />
        <Route
          path="/billing/expenses"
          element={
            <RoleGuard roles={EXPENSES_READ_ROLES}>
              <ExpensesPage />
            </RoleGuard>
          }
        />
        <Route
          path="/billing/cash-desk"
          element={
            <RoleGuard roles={BILLING_ROLES}>
              <CashDeskPage />
            </RoleGuard>
          }
        />
        <Route
          path="/billing/cash-desk/shifts/:id"
          element={
            <RoleGuard roles={BILLING_ROLES}>
              <CashShiftPage />
            </RoleGuard>
          }
        />
        <Route
          path="/reports"
          element={
            <RoleGuard roles={REPORT_ROLES}>
              <ReportsPage />
            </RoleGuard>
          }
        />
        <Route
          path="/system/architecture"
          element={
            <RoleGuard roles={SYSTEM_ARCH_ROLES}>
              <ArchitecturePage />
            </RoleGuard>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

