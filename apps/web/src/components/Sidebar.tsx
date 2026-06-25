import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronRight, Building2 } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import type { UserRole } from "../auth/types";
import { useNavigation } from "../navigation/useNavigation";
import type { NavigationItem } from "../navigation/navigationConfig";
import { usePlatformAccess } from "../hooks/usePlatformAccess";
import { Logo } from "../shared/ui/Logo";

const ICON_STROKE = 1.65;
const iconClass = "h-[18px] w-[18px] shrink-0 transition-transform duration-200 ease-out";

const roleLabelRu: Record<UserRole, string> = {
  superadmin: "Суперадмин",
  reception: "Регистратура",
  doctor: "Врач",
  nurse: "Медсестра",
  cashier: "Кассир",
  operator: "Оператор",
  accountant: "Бухгалтер",
  manager: "Менеджер",
  director: "Директор",
};

function initialsFromUsername(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  const p = parts[0] ?? "?";
  return p.slice(0, 2).toUpperCase();
}

const isPathActive = (pathname: string, itemPath: string): boolean =>
  pathname === itemPath || (itemPath !== "/" && pathname.startsWith(itemPath));

const navLinkClass = (isActive: boolean): string =>
  [
    "group relative flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
    "border-l-[3px] transition-all duration-300 ease-out",
    isActive
      ? "border-l-emerald-500 bg-emerald-50/90 text-emerald-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]"
      : "border-l-transparent text-slate-600 hover:border-l-slate-200 hover:bg-slate-100/90 hover:text-slate-900",
  ].join(" ");

const NavIcon: React.FC<{ active: boolean; Icon: NonNullable<NavigationItem["icon"]> }> = ({
  active,
  Icon,
}) => (
  <Icon
    className={`${iconClass} ${
      active ? "text-emerald-600" : "text-slate-400 group-hover:text-slate-600"
    }`}
    strokeWidth={ICON_STROKE}
    aria-hidden
  />
);

type SidebarItemProps = {
  item: NavigationItem;
  pathname: string;
  depth?: number;
  animationDelayMs?: number;
  billingOpen: boolean;
  setBillingOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

const SidebarItem: React.FC<SidebarItemProps> = ({
  item,
  pathname,
  depth = 0,
  animationDelayMs,
  billingOpen,
  setBillingOpen,
}) => {
  const hasChildren = Boolean(item.children && item.children.length > 0);
  const childActive =
    hasChildren &&
    item.children!.some((c) => c.path && isPathActive(pathname, c.path));
  const isBillingParent = item.label === "Биллинг";

  const wrapEnter = (node: React.ReactNode) =>
    animationDelayMs !== undefined ? (
      <div className="crm-sidebar-enter" style={{ animationDelay: `${animationDelayMs}ms` }}>
        {node}
      </div>
    ) : (
      node
    );

  if (hasChildren && item.children) {
    const ParentIcon = item.icon;
    const isOpen = isBillingParent ? billingOpen : true;
    return wrapEnter(
      <div className="space-y-0.5">
        <button
          type="button"
          onClick={isBillingParent ? () => setBillingOpen((prev) => !prev) : undefined}
          className={`group flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left text-sm font-medium transition-all duration-300 ease-out ${
            childActive
              ? "text-[#0f172a] bg-[#f1f5f9]"
              : "text-[#64748b] hover:bg-[#f1f5f9] hover:text-[#0f172a]"
          }`}
          style={{ paddingLeft: depth ? `${12 + depth * 8}px` : undefined }}
        >
          {ParentIcon ? (
            <ParentIcon
              className={`${iconClass} text-[#64748b] group-hover:scale-110`}
              strokeWidth={ICON_STROKE}
              aria-hidden
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {isBillingParent ? (
            <ChevronRight
              className={`h-4 w-4 shrink-0 text-[#94a3b8] transition-transform duration-300 ${isOpen ? "rotate-90" : ""}`}
              strokeWidth={2}
              aria-hidden
            />
          ) : null}
        </button>
        <div
          className={`overflow-hidden transition-all duration-300 ease-in-out ${
            isOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <div className="ml-1 space-y-0.5 border-l border-[#e2e8f0] pl-2">
            {item.children.map((child, idx) => (
              <SidebarItem
                key={child.path ?? child.label}
                item={child}
                pathname={pathname}
                depth={depth + 1}
                animationDelayMs={
                  animationDelayMs !== undefined ? animationDelayMs + 80 + idx * 45 : undefined
                }
                billingOpen={billingOpen}
                setBillingOpen={setBillingOpen}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!item.path) {
    return null;
  }

  const Icon = item.icon;
  const isActive = isPathActive(pathname, item.path);

  return wrapEnter(
    <NavLink
      to={item.path}
      end={item.path === "/"}
      className={navLinkClass(isActive)}
      style={{ paddingLeft: depth ? `${8 + depth * 10}px` : undefined }}
    >
      {Icon ? <NavIcon active={isActive} Icon={Icon} /> : null}
      <span className="min-w-0 truncate">{item.label}</span>
    </NavLink>
  );
};

export const Sidebar: React.FC = () => {
  const sections = useNavigation();
  const location = useLocation();
  const { user } = useAuth();
  const { isPlatformAdmin } = usePlatformAccess();
  const [billingOpen, setBillingOpen] = React.useState(true);

  const platformItem: NavigationItem = {
    label: "Платформа",
    path: "/platform",
    roles: [],
    icon: Building2,
  };

  let stagger = 0;
  const nextDelay = () => stagger++ * 52;

  return (
    <aside className="z-20 hidden h-full w-[260px] shrink-0 flex-col overflow-x-hidden border-r border-slate-200/80 bg-gradient-to-b from-slate-50 to-slate-100/90 md:flex">
      <div
        className="crm-sidebar-enter border-b border-gray-100 px-4 py-4"
        style={{ animationDelay: `${nextDelay()}ms` }}
      >
        <div className="inline-flex transition-transform duration-300 ease-out hover:scale-[1.02]">
          <Logo size={34} withText />
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-3 pt-1">
        {sections.map((section) => (
          <div key={section.section}>
            <div
              className="crm-sidebar-enter mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#94a3b8]"
              style={{ animationDelay: `${nextDelay()}ms` }}
            >
              {section.section}
            </div>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <SidebarItem
                  key={`${section.section}-${item.label}`}
                  item={item}
                  pathname={location.pathname}
                  animationDelayMs={nextDelay()}
                  billingOpen={billingOpen}
                  setBillingOpen={setBillingOpen}
                />
              ))}
            </div>
          </div>
        ))}

        {isPlatformAdmin ? (
          <div>
            <div
              className="crm-sidebar-enter mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#94a3b8]"
              style={{ animationDelay: `${nextDelay()}ms` }}
            >
              Платформа
            </div>
            <div className="space-y-0.5">
              <SidebarItem
                item={platformItem}
                pathname={location.pathname}
                animationDelayMs={nextDelay()}
                billingOpen={billingOpen}
                setBillingOpen={setBillingOpen}
              />
            </div>
          </div>
        ) : null}
      </nav>

      {user ? (
        <div className="p-3 pt-1">
          <div
            className="crm-sidebar-enter rounded-xl border border-[#e2e8f0] bg-white/75 p-3 shadow-[0_1px_3px_rgba(15,23,42,0.06)] backdrop-blur-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-[#cbd5e1] hover:bg-white hover:shadow-[0_8px_24px_-12px_rgba(15,23,42,0.12)]"
            style={{ animationDelay: `${nextDelay()}ms` }}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#dcfce7] text-[13px] font-semibold text-[#166534] shadow-sm"
                aria-hidden
              >
                {initialsFromUsername(user.username)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[#0f172a]">
                  {user.fullName ?? user.username}
                </p>
                <p className="truncate text-xs font-normal text-[#64748b]">{roleLabelRu[user.role]}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
};
