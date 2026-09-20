import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bot,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  CreditCard,
  DollarSign,
  FileText,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Network,
  PhoneCall,
  Stethoscope,
  Users,
  UsersRound,
  Wallet,
} from "lucide-react";
import type { UserRole } from "../auth/types";
import {
  APPOINTMENTS_PAGE_ROUTE_ROLES,
  ATTENDANCE_ROLES,
  BILLING_ROLES,
  CALL_CENTER_ROLES,
  CLINIC_STAFF,
  DASHBOARD_NAV_ROLES,
  DOCTORS_DIRECTORY_ROLES,
  EXPENSES_READ_ROLES,
  MY_SERVICES_ROLES,
  PATIENTS_PAGE_ROUTE_ROLES,
  PAYMENTS_READ_PAGE_ROLES,
  QUESTIONNAIRE_ROLES,
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
  /** i18n key of the section heading; also its React key, so it must be unique. */
  sectionKey: string;
  items: NavigationItem[];
};

export const navigationConfig: NavigationSection[] = [
  {
    sectionKey: "nav.main",
    items: [
      { label: "", labelKey: "pages.dashboard", path: "/dashboard", roles: DASHBOARD_NAV_ROLES, icon: LayoutDashboard },
      { label: "", labelKey: "pages.patients", path: "/patients", roles: PATIENTS_PAGE_ROUTE_ROLES, icon: Users },
      { label: "", labelKey: "pages.appointments", path: "/appointments", roles: APPOINTMENTS_PAGE_ROUTE_ROLES, icon: CalendarDays },
      { label: "", labelKey: "pages.questionnaires", path: "/questionnaires", roles: QUESTIONNAIRE_ROLES, icon: ClipboardList },
      { label: "", labelKey: "pages.myServices", path: "/my-services", roles: MY_SERVICES_ROLES, icon: ListChecks },
      { label: "", labelKey: "pages.callCenter", path: "/call-center", roles: CALL_CENTER_ROLES, icon: PhoneCall },
      { label: "", labelKey: "pages.doctors", path: "/doctors", roles: DOCTORS_DIRECTORY_ROLES, icon: Stethoscope },
      { label: "", labelKey: "pages.services", path: "/services", roles: SERVICES_DIRECTORY_ROLES, icon: FileText },
      { label: "", labelKey: "pages.aiAssistant", path: "/ai-assistant", roles: CLINIC_STAFF, icon: Bot },
    ],
  },
  {
    sectionKey: "nav.reports",
    items: [{ label: "", labelKey: "pages.reports", path: "/reports", roles: REPORT_ROLES, icon: BarChart3 }],
  },
  {
    sectionKey: "nav.billing",
    items: [
      {
        label: "",
        labelKey: "nav.billing",
        roles: BILLING_ROLES,
        icon: CreditCard,
        children: [
          { label: "", labelKey: "pages.invoices", path: "/billing/invoices", roles: BILLING_ROLES, icon: FileText },
          { label: "", labelKey: "nav.payments", path: "/billing/payments", roles: PAYMENTS_READ_PAGE_ROLES, icon: Wallet },
          { label: "", labelKey: "nav.expenses", path: "/billing/expenses", roles: EXPENSES_READ_ROLES, icon: DollarSign },
          { label: "", labelKey: "pages.cashDesk", path: "/billing/cash-desk", roles: BILLING_ROLES, icon: Landmark },
        ],
      },
    ],
  },
  {
    sectionKey: "nav.admin",
    items: [
      { label: "", labelKey: "pages.users", path: "/users", roles: USERS_PAGE_ROLES, icon: UsersRound },
      { label: "", labelKey: "pages.attendance", path: "/attendance", roles: ATTENDANCE_ROLES, icon: CalendarCheck },
      { label: "", labelKey: "pages.systemArchitecture", path: "/system/architecture", roles: SYSTEM_ARCH_ROLES, icon: Network },
    ],
  },
];
