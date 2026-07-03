import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bot,
  CalendarDays,
  CreditCard,
  DollarSign,
  FileText,
  Landmark,
  LayoutDashboard,
  Network,
  Stethoscope,
  Users,
  UsersRound,
  Wallet,
} from "lucide-react";
import type { UserRole } from "../auth/types";
import {
  APPOINTMENTS_PAGE_ROUTE_ROLES,
  BILLING_ROLES,
  CLINIC_STAFF,
  DASHBOARD_NAV_ROLES,
  DOCTORS_DIRECTORY_ROLES,
  EXPENSES_READ_ROLES,
  PATIENTS_PAGE_ROUTE_ROLES,
  PAYMENTS_READ_PAGE_ROLES,
  REPORT_ROLES,
  SERVICES_DIRECTORY_ROLES,
  SYSTEM_ARCH_ROLES,
  USERS_PAGE_ROLES,
} from "../auth/roleGroups";

export type NavigationItem = {
  label: string;
  path?: string;
  roles: UserRole[];
  icon?: LucideIcon;
  children?: NavigationItem[];
};

export type NavigationSection = {
  section: string;
  items: NavigationItem[];
};

export const navigationConfig: NavigationSection[] = [
  {
    section: "Основное",
    items: [
      { label: "Панель управления", path: "/dashboard", roles: DASHBOARD_NAV_ROLES, icon: LayoutDashboard },
      { label: "Пациенты", path: "/patients", roles: PATIENTS_PAGE_ROUTE_ROLES, icon: Users },
      { label: "Записи", path: "/appointments", roles: APPOINTMENTS_PAGE_ROUTE_ROLES, icon: CalendarDays },
      { label: "Врачи", path: "/doctors", roles: DOCTORS_DIRECTORY_ROLES, icon: Stethoscope },
      { label: "Услуги", path: "/services", roles: SERVICES_DIRECTORY_ROLES, icon: FileText },
      { label: "AI Ассистент", path: "/ai-assistant", roles: CLINIC_STAFF, icon: Bot },
    ],
  },
  {
    section: "Отчеты",
    items: [{ label: "Отчеты", path: "/reports", roles: REPORT_ROLES, icon: BarChart3 }],
  },
  {
    section: "Финансы",
    items: [
      {
        label: "Биллинг",
        roles: BILLING_ROLES,
        icon: CreditCard,
        children: [
          { label: "Счета", path: "/billing/invoices", roles: BILLING_ROLES, icon: FileText },
          { label: "Платежи", path: "/billing/payments", roles: PAYMENTS_READ_PAGE_ROLES, icon: Wallet },
          { label: "Расходы", path: "/billing/expenses", roles: EXPENSES_READ_ROLES, icon: DollarSign },
          { label: "Касса", path: "/billing/cash-desk", roles: BILLING_ROLES, icon: Landmark },
        ],
      },
    ],
  },
  {
    section: "Администрирование",
    items: [
      { label: "Пользователи", path: "/users", roles: USERS_PAGE_ROLES, icon: UsersRound },
      { label: "Архитектура системы", path: "/system/architecture", roles: SYSTEM_ARCH_ROLES, icon: Network },
    ],
  },
];
