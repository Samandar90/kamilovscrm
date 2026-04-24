import React from "react";
import { Link } from "react-router-dom";
import { MoreVertical } from "lucide-react";

export type PatientCardModel = {
  id: number;
  fullName: string;
  phone: string;
  birthDate: string;
};

type PatientCardProps = {
  patient: PatientCardModel;
  birthLabel: string | null;
  onOpen: () => void;
  onEdit?: () => void;
  onArchive?: (e: React.MouseEvent) => void;
  canBookAppointment: boolean;
  canEdit: boolean;
  canArchive: boolean;
  archivePending?: boolean;
  savePending?: boolean;
};

const stop = (e: React.SyntheticEvent) => {
  e.stopPropagation();
};

export function PatientCard({
  patient,
  birthLabel,
  onOpen,
  onEdit,
  onArchive,
  canBookAppointment,
  canEdit,
  canArchive,
  archivePending,
  savePending,
}: PatientCardProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("click", close, true);
    return () => window.removeEventListener("click", close, true);
  }, [menuOpen]);

  const menuDisabled = Boolean(savePending || archivePending);
  const metaLine = birthLabel ? `Д.р. ${birthLabel}` : "Пациент";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="relative cursor-pointer rounded-xl border border-slate-100/90 bg-white p-3 shadow-sm transition-transform duration-150 ease-out active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-bold leading-snug tracking-tight text-slate-900">{patient.fullName}</h3>
          <p className="mt-1 truncate text-sm tabular-nums text-slate-600">{patient.phone}</p>
          <p className="mt-1 text-xs text-slate-400">{metaLine}</p>
        </div>
        {(canEdit || canArchive) && (
          <div className="relative shrink-0" ref={menuRef} onClick={stop}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
              aria-expanded={menuOpen}
              aria-haspopup="true"
              aria-label="Меню"
            >
              <MoreVertical className="h-5 w-5" strokeWidth={1.75} />
            </button>
            {menuOpen ? (
              <div
                className="absolute right-0 top-full z-30 mt-0.5 min-w-[10rem] overflow-hidden rounded-xl border border-slate-100 bg-white py-1 shadow-lg"
                role="menu"
              >
                {canEdit && onEdit ? (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={menuDisabled}
                    className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    onClick={() => {
                      setMenuOpen(false);
                      onEdit();
                    }}
                  >
                    Изменить
                  </button>
                ) : null}
                {canArchive && onArchive ? (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={menuDisabled}
                    className="block w-full px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                    onClick={(e) => {
                      setMenuOpen(false);
                      onArchive(e);
                    }}
                  >
                    Архивировать
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
      <div className="mt-2.5 flex gap-2" onClick={stop}>
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            onOpen();
          }}
          className="inline-flex min-h-[38px] flex-1 items-center justify-center rounded-lg border border-slate-200/90 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          Открыть
        </button>
        {canBookAppointment ? (
          <Link
            to={`/appointments/new?patientId=${patient.id}`}
            onClick={stop}
            className="inline-flex min-h-[38px] flex-1 items-center justify-center rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
          >
            Запись
          </Link>
        ) : (
          <span className="inline-flex min-h-[38px] flex-1 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-2 text-center text-[11px] font-medium text-slate-400">
            Нет записи
          </span>
        )}
      </div>
    </div>
  );
}
