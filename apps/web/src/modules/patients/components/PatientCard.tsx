import React from "react";
import { Link } from "react-router-dom";
import { Calendar, MoreVertical, Phone } from "lucide-react";
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

export const PatientCard: React.FC<PatientCardProps> = ({
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
}) => {
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

  return (
    <article className="relative rounded-xl border border-slate-100/90 bg-white p-4 shadow-sm transition-transform duration-150 ease-out active:scale-[0.98]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-snug tracking-tight text-slate-900">{patient.fullName}</h3>
          <p className="mt-2 flex items-center gap-2 text-sm text-slate-600">
            <Phone className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 truncate tabular-nums">{patient.phone}</span>
          </p>
          {birthLabel ? (
            <p className="mt-1.5 flex items-center gap-2 text-sm text-slate-500">
              <Calendar className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.75} aria-hidden />
              <span>{birthLabel}</span>
            </p>
          ) : null}
        </div>
        {(canEdit || canArchive) && (
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
              aria-expanded={menuOpen}
              aria-haspopup="true"
              aria-label="Меню"
            >
              <MoreVertical className="h-5 w-5" strokeWidth={1.75} />
            </button>
            {menuOpen ? (
              <div
                className="absolute right-0 top-full z-20 mt-1 min-w-[10rem] overflow-hidden rounded-xl border border-slate-100 bg-white py-1 shadow-lg"
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
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex min-h-[40px] flex-1 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50"
        >
          Открыть
        </button>
        {canBookAppointment ? (
          <Link
            to={`/appointments/new?patientId=${patient.id}`}
            className="inline-flex min-h-[40px] flex-1 items-center justify-center rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
          >
            Запись
          </Link>
        ) : (
          <span className="inline-flex min-h-[40px] flex-1 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 text-center text-xs font-medium text-slate-400">
            Нет доступа к записям
          </span>
        )}
      </div>
    </article>
  );
};
