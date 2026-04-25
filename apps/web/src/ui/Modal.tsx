import React from "react";
import { createPortal } from "react-dom";
import { cn } from "./utils/cn";

export type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  closeOnOverlay?: boolean;
  closeOnEsc?: boolean;
};

const defaultPanelClass =
  "relative z-10 w-full max-w-lg rounded-t-2xl border border-slate-200/90 bg-white p-6 shadow-[0_24px_48px_-12px_rgba(15,23,42,0.18)] max-md:max-h-[88dvh] max-md:overflow-y-auto md:rounded-2xl";

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  children,
  className,
  closeOnOverlay = true,
  closeOnEsc = true,
}) => {
  const portalTarget = typeof document !== "undefined" ? document.body : null;

  React.useEffect(() => {
    if (!isOpen || !closeOnEsc) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, closeOnEsc, onClose]);

  if (!isOpen || !portalTarget) return null;

  const panelClass = className ? cn("relative z-10", className) : defaultPanelClass;

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end justify-center p-0 md:items-center md:p-4">
      <div
        className="modal-backdrop-enter fixed inset-0 bg-slate-900/35 backdrop-blur-sm"
        aria-hidden
        onMouseDown={() => {
          if (closeOnOverlay) onClose();
        }}
      />
      <div
        className={cn("modal-dialog-enter max-md:w-full", panelClass)}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    portalTarget
  );
};
