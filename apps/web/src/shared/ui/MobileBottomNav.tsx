import React from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation } from "react-router-dom";
import { CalendarDays, Landmark, LayoutDashboard, Menu, Users, X } from "lucide-react";
import { cn } from "../../ui/utils/cn";
import { useNavigation } from "../../navigation/useNavigation";
import type { NavigationItem, NavigationSection } from "../../navigation/navigationConfig";

const BAR_PATHS = new Set(["/", "/dashboard", "/appointments", "/patients", "/billing/cash-desk"]);

const pathActive = (pathname: string, href: string): boolean => {
  if (href === "/dashboard") return pathname === "/" || pathname === "/dashboard";
  if (pathname === href) return true;
  return href !== "/" && pathname.startsWith(`${href}/`);
};

const flattenMoreLinks = (sections: NavigationSection[]): Array<{ label: string; path: string; Icon?: NavigationItem["icon"] }> => {
  const seen = new Set<string>();
  const out: Array<{ label: string; path: string; Icon?: NavigationItem["icon"] }> = [];

  const push = (path: string | undefined, label: string, Icon?: NavigationItem["icon"]) => {
    if (!path || BAR_PATHS.has(path) || seen.has(path)) return;
    seen.add(path);
    out.push({ path, label, Icon });
  };

  for (const sec of sections) {
    for (const item of sec.items) {
      if (item.children?.length) {
        for (const child of item.children) {
          push(child.path, child.label, child.icon);
        }
      } else {
        push(item.path, item.label, item.icon);
      }
    }
  }
  return out;
};

const tabClass = (active: boolean) =>
  cn(
    "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 text-[11px] font-medium leading-tight text-slate-500 transition-colors",
    active && "text-emerald-700"
  );

const iconWrap = (active: boolean) =>
  cn(
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors",
    active ? "bg-emerald-500/15 text-emerald-600" : "text-slate-400"
  );

export const MobileBottomNav: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const sections = useNavigation();
  const [moreOpen, setMoreOpen] = React.useState(false);
  const moreLinks = React.useMemo(() => flattenMoreLinks(sections), [sections]);
  const pathname = location.pathname;

  const moreRouteActive = React.useMemo(
    () => moreLinks.some((l) => pathActive(pathname, l.path)),
    [moreLinks, pathname]
  );

  React.useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  React.useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-[100] flex h-16 border-t border-slate-200/90 bg-white/90 shadow-[0_-1px_0_rgba(15,23,42,0.04)] backdrop-blur-md md:hidden"
        aria-label={t("mobileNav.mainNav")}
      >
        <NavLink
          to="/dashboard"
          className={({ isActive }) => tabClass(isActive || pathActive(pathname, "/dashboard"))}
        >
          {({ isActive }) => (
            <>
              <span className={iconWrap(isActive || pathActive(pathname, "/dashboard"))}>
                <LayoutDashboard className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="max-w-[4.5rem] truncate">{t("mobileNav.home")}</span>
            </>
          )}
        </NavLink>
        <NavLink
          to="/appointments"
          className={({ isActive }) => tabClass(isActive || pathActive(pathname, "/appointments"))}
        >
          {({ isActive }) => (
            <>
              <span className={iconWrap(isActive || pathActive(pathname, "/appointments"))}>
                <CalendarDays className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="max-w-[4.5rem] truncate">{t("mobileNav.appointment")}</span>
            </>
          )}
        </NavLink>
        <NavLink
          to="/patients"
          className={({ isActive }) => tabClass(isActive || pathActive(pathname, "/patients"))}
        >
          {({ isActive }) => (
            <>
              <span className={iconWrap(isActive || pathActive(pathname, "/patients"))}>
                <Users className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="max-w-[4.5rem] truncate">{t("common.patient")}</span>
            </>
          )}
        </NavLink>
        <NavLink
          to="/billing/cash-desk"
          className={({ isActive }) => tabClass(isActive || pathActive(pathname, "/billing/cash-desk"))}
        >
          {({ isActive }) => (
            <>
              <span className={iconWrap(isActive || pathActive(pathname, "/billing/cash-desk"))}>
                <Landmark className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="max-w-[4.5rem] truncate">{t("mobileNav.cash")}</span>
            </>
          )}
        </NavLink>
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={tabClass(moreOpen || moreRouteActive)}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
        >
          <span className={iconWrap(moreOpen || moreRouteActive)}>
            <Menu className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </span>
          <span className="max-w-[4.5rem] truncate">{t("mobileNav.more")}</span>
        </button>
      </nav>

      {moreOpen ? (
        <div className="fixed inset-0 z-[95] md:hidden" role="dialog" aria-modal="true" aria-labelledby="mobile-more-title">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
            aria-label={t("mobileNav.closeMenu")}
            onClick={() => setMoreOpen(false)}
          />
          <div className="absolute bottom-16 left-0 right-0 max-h-[min(72vh,calc(100vh-5rem))] overflow-hidden rounded-t-2xl border border-slate-200/90 bg-white shadow-[0_-12px_40px_-12px_rgba(15,23,42,0.2)]">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 id="mobile-more-title" className="text-sm font-semibold text-slate-900">
                {t("mobileNav.sections")}
              </h2>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                aria-label={t("common.close")}
              >
                <X className="h-5 w-5" strokeWidth={1.75} />
              </button>
            </div>
            <div className="max-h-[min(60vh,calc(100vh-11rem))] overflow-y-auto px-2 py-2 pb-4">
              {moreLinks.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-slate-500">{t("mobileNav.noSections")}</p>
              ) : (
                <ul className="space-y-0.5">
                  {moreLinks.map(({ path, label, Icon }) => {
                    const active = pathActive(pathname, path);
                    return (
                      <li key={path}>
                        <NavLink
                          to={path}
                          onClick={() => setMoreOpen(false)}
                          className={cn(
                            "flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                            active ? "bg-emerald-50 text-emerald-900" : "text-slate-700 hover:bg-slate-50"
                          )}
                        >
                          {Icon ? (
                            <Icon
                              className={cn("h-5 w-5 shrink-0", active ? "text-emerald-600" : "text-slate-400")}
                              strokeWidth={1.65}
                              aria-hidden
                            />
                          ) : null}
                          <span className="min-w-0 truncate">{label}</span>
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};
