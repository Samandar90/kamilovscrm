import React from "react";
import { createPortal } from "react-dom";
import { cn } from "../../ui/utils/cn";

type ModalShellProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  footer?: React.ReactNode;
  maxWidthClassName?: string;
  children: React.ReactNode;
};

export const ModalShell: React.FC<ModalShellProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  footer,
  maxWidthClassName = "max-w-lg",
  children,
}) => {
  const portalTarget = typeof document !== "undefined" ? document.body : null;

  React.useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !portalTarget) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end justify-center p-0 md:items-center md:p-4">
      <div className="modal-backdrop-enter fixed inset-0 bg-slate-900/40" aria-hidden onMouseDown={onClose} />
      <div
        className={cn(
          "modal-dialog-enter relative z-10 w-full rounded-t-2xl border border-gray-200 bg-white shadow-[0_24px_48px_-12px_rgba(15,23,42,0.18)] max-md:max-h-[88dvh] max-md:overflow-y-auto md:rounded-xl",
          maxWidthClassName
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-gray-500">{subtitle}</p> : null}
        </header>
        <div className="px-6 py-5">{children}</div>
        {footer ? <footer className="border-t border-gray-200 bg-gray-50 px-6 py-4">{footer}</footer> : null}
      </div>
    </div>,
    portalTarget
  );
};

