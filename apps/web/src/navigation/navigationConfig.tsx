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
  labelKey?: string;
  path?: string;
  roles: UserRole[];
  icon?: LucideIcon;
  children?: NavigationItem[];
};

export type NavigationSection = {
  section: string;
  sectionKey?: string;
  items: NavigationItem[];
};

export const navigationConfig: NavigationSection[] = [
  {
    section: "Основное",
    sectionKey: "nav.main",
    items: [
      { label: "Панель управления", labelKey: "pages.dashboard", path: "/dashboard", roles: DASHBOARD_NAV_ROLES, icon: LayoutDashboard },
      { label: "Пациенты", labelKey: "pages.patients", path: "/patients", roles: PATIENTS_PAGE_ROUTE_ROLES, icon: Users },
      { label: "Записи", labelKey: "pages.appointments", path: "/appointments", roles: APPOINTMENTS_PAGE_ROUTE_ROLES, icon: CalendarDays },
      { label: "Врачи", labelKey: "pages.doctors", path: "/doctors", roles: DOCTORS_DIRECTORY_ROLES, icon: Stethoscope },
      { label: "Услуги", labelKey: "pages.services", path: "/services", roles: SERVICES_DIRECTORY_ROLES, icon: FileText },
      { label: "AI Ассистент", labelKey: "pages.aiAssistant", path: "/ai-assistant", roles: CLINIC_STAFF, icon: Bot },
    ],
  },
  {
    section: "Отчеты",
    sectionKey: "nav.reports",
    items: [{ label: "Отчеты", labelKey: "pages.reports", path: "/reports", roles: REPORT_ROLES, icon: BarChart3 }],
  },
  {
    section: "Финансы",
    sectionKey: "nav.billing",
    items: [
      {
        label: "Биллинг",
        labelKey: "nav.billing",
        roles: BILLING_ROLES,
        icon: CreditCard,
        children: [
          { label: "Счета", labelKey: "pages.invoices", path: "/billing/invoices", roles: BILLING_ROLES, icon: FileText },
          { label: "Платежи", labelKey: "nav.payments", path: "/billing/payments", roles: PAYMENTS_READ_PAGE_ROLES, icon: Wallet },
          { label: "Расходы", labelKey: "nav.expenses", path: "/billing/expenses", roles: EXPENSES_READ_ROLES, icon: DollarSign },
          { label: "Касса", labelKey: "pages.cashDesk", path: "/billing/cash-desk", roles: BILLING_ROLES, icon: Landmark },
        ],
      },
    ],
  },
  {
    section: "Администрирование",
    sectionKey: "nav.admin",
    items: [
      { label: "Пользователи", labelKey: "pages.users", path: "/users", roles: USERS_PAGE_ROLES, icon: UsersRound },
      { label: "Архитектура системы", labelKey: "pages.systemArchitecture", path: "/system/architecture", roles: SYSTEM_ARCH_ROLES, icon: Network },
    ],
  },
];
