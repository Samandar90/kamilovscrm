import type { QueueTicket } from "../api/queueTypes";
import { buildTicketHtml } from "./ticketHtml";

/** Remove the frame even when the browser never fires afterprint. */
const CLEANUP_AFTER_MS = 60_000;
/** Let the written document lay out before the print dialog snapshots it. */
const PRINT_DELAY_MS = 100;
/** Safety net: print even if the frame's load event was missed. */
const PRINT_FALLBACK_MS = 500;

/**
 * Prints one queue ticket through a hidden same-origin iframe. Unlike window.open this is not a popup,
 * so it still works after an awaited API call (popup blockers only allow window.open inside the click).
 */
export function printQueueTicket(ticket: QueueTicket): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  // Zero-size but rendered: some browsers print a blank page for a display:none frame.
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(frame);

  let removed = false;
  let printed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    window.clearTimeout(cleanupTimer);
    frame.remove();
  };
  const cleanupTimer = window.setTimeout(cleanup, CLEANUP_AFTER_MS);

  const frameWindow = frame.contentWindow;
  if (!frameWindow) {
    cleanup();
    throw new Error("Print frame is not available");
  }

  const runPrint = () => {
    if (printed || removed) return;
    printed = true;
    frameWindow.addEventListener("afterprint", () => window.setTimeout(cleanup, 0));
    frameWindow.focus();
    frameWindow.print();
  };

  const frameDocument = frameWindow.document;
  frameDocument.open();
  frameDocument.write(buildTicketHtml(ticket));
  frameDocument.close();
  // Chrome finishes a written document synchronously (readyState "complete", no load event follows);
  // other engines may still fire load. document.open() drops listeners added before it, so listen only now.
  if (frameDocument.readyState === "complete") {
    window.setTimeout(runPrint, PRINT_DELAY_MS);
  } else {
    frameWindow.addEventListener("load", () => window.setTimeout(runPrint, PRINT_DELAY_MS));
  }
  window.setTimeout(runPrint, PRINT_FALLBACK_MS);
}
