import React from "react";
import { useLocation, Link } from "react-router-dom";
import { Sidebar } from "../components/Sidebar";
import { useAuth } from "../auth/AuthContext";
import { Button } from "../ui/Button";
import { cn } from "../ui/utils/cn";
import { MobileBottomNav } from "../shared/ui/MobileBottomNav";

const routeTitleMap: Record<string, string> = {
  "/": "Панель управления",
  "/patients": "Пациенты",
  "/appointments": "Записи",
  "/doctor-workspace": "Рабочее место врача",
  "/billing/invoices": "Счета",
  "/billing/cash-desk": "Касса",
  "/reports": "Отчеты",
  "/ai-assistant": "AI Ассистент",
  "/users": "Пользователи",
  "/system/architecture": "Архитектура системы",
};

const getTitleForPath = (path: string): string => {
  if (routeTitleMap[path]) return routeTitleMap[path];
  // simple prefix matching for nested paths if needed later
  const match = Object.entries(routeTitleMap).find(
    ([key]) => key !== "/" && path.startsWith(key)
  );
  return match ? match[1] : "Панель управления";
};

type MainLayoutProps = {
  children: React.ReactNode;
};

export const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const location = useLocation();
  const { user, logout } = useAuth();
  const title = getTitleForPath(location.pathname);
  const lockMainScroll = location.pathname === "/ai-assistant";
  const isDoctorWorkspaceScreen = location.pathname.startsWith("/doctor-workspace/");

  return (
    <div className="flex h-screen min-w-0 overflow-x-hidden bg-[#f8fafc] text-[#0f172a]">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header
          className={cn(
            "sticky top-0 z-30 flex h-12 max-md:h-11 shrink-0 items-center justify-between gap-2 border-b border-slate-200/80 bg-white/95 px-3 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur-sm md:gap-4 md:px-5",
            isDoctorWorkspaceScreen && "hidden md:flex"
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">
            <Link
              to="/"
              className="hidden truncate text-sm font-semibold tracking-tight text-slate-900 transition-colors hover:text-emerald-700 md:inline"
            >
              Kamilovs clinic
            </Link>
            <span className="hidden shrink-0 text-slate-300 md:inline">/</span>
            <h1 className="min-w-0 truncate text-xs font-medium text-slate-800 md:text-sm md:text-slate-500">
              {title}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2 md:gap-4">
            <div className="hidden max-w-[220px] truncate text-xs text-slate-500 sm:block">
              {user ? `${user.fullName ?? user.username} · ${user.role}` : "Гость"}
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void logout()}
              className="shrink-0 border-slate-200 px-2.5 text-xs shadow-sm max-md:h-8 max-md:py-0 md:px-3"
            >
              Выйти
            </Button>
          </div>
        </header>
        <main
          className={cn(
            "min-h-0 flex-1 bg-[#f8fafc]",
            !isDoctorWorkspaceScreen && "max-md:pb-16",
            lockMainScroll ? "overflow-hidden" : "overflow-auto"
          )}
        >
          {children}
        </main>
        {!isDoctorWorkspaceScreen ? <MobileBottomNav /> : null}
      </div>
    </div>
  );
};

