/**
 * Whether a reload would take something from the user. Used before every automatic reload to a new version: the page
 * is left alone while a dialog is open, while a field holds what the user typed, and while the page itself objects.
 * Errs on the side of "busy": the cost of a wrong "busy" is a banner that waits, the cost of a wrong "free" is lost work.
 */

/**
 * Every modal of the app (ui/Modal, ModalShell, ChangePasswordModal, the mobile "more" sheet, the subscription notice)
 * renders a full-screen `fixed inset-0` layer; the other selectors catch a dialog built in the standard way.
 */
export const OPEN_OVERLAY_SELECTOR = '.fixed.inset-0, [role="dialog"], [aria-modal="true"], dialog[open]';
const FIELDS = "input, textarea, select, [contenteditable]";
/**
 * Search boxes and filters: what is typed there is a view of a list, not work to lose. A filter bar opts out with
 * `data-reload-ignore` on itself or any ancestor.
 */
const NOT_WORK = 'input[type="search"], [data-reload-ignore], [data-reload-ignore] *';

type Field = { value?: unknown; textContent?: string | null; matches(selector: string): boolean };
type EditListener = (event: { target: unknown }) => void;
type EditSource = {
  addEventListener(type: string, listener: EditListener, capture: boolean): void;
  removeEventListener(type: string, listener: EditListener, capture: boolean): void;
};
type PageDocument = {
  querySelector(selector: string): unknown;
  querySelectorAll(selector: string): ArrayLike<Field>;
};
type PageWindow = { dispatchEvent(event: Event): boolean };

/** Fields the user has edited. Values the page filled in itself (a loaded record) are not the user's input. */
const edited = new WeakSet<object>();

/** Remembers every field the user edits from now on; returns a function that stops listening. */
export function trackEditedFields(doc: EditSource): () => void {
  const remember: EditListener = (event) => {
    if (typeof event.target === "object" && event.target !== null) edited.add(event.target);
  };
  // `change` as well: selects and checkboxes do not report `input` in every engine.
  doc.addEventListener("input", remember, true);
  doc.addEventListener("change", remember, true);
  return () => {
    doc.removeEventListener("input", remember, true);
    doc.removeEventListener("change", remember, true);
  };
}

const fieldText = (field: Field): string => (typeof field.value === "string" ? field.value : (field.textContent ?? ""));

/** A field still on the page that the user edited and that is not empty. A saved or closed form takes its fields away. */
function hasUnsavedInput(doc: PageDocument): boolean {
  return Array.from(doc.querySelectorAll(FIELDS)).some(
    (field) => edited.has(field) && !field.matches(NOT_WORK) && fieldText(field).trim() !== "",
  );
}

/**
 * Asks the page the question the browser asks before unloading it. A page that keeps a draft outside its fields
 * answers "no" through its own `beforeunload` guard (the call center does), and is then left alone here too.
 */
function pageGuardsUnload(win: PageWindow): boolean {
  const question = new Event("beforeunload", { cancelable: true });
  win.dispatchEvent(question);
  return question.defaultPrevented;
}

export function isPageBusy(doc: PageDocument, win: PageWindow): boolean {
  return doc.querySelector(OPEN_OVERLAY_SELECTOR) !== null || hasUnsavedInput(doc) || pageGuardsUnload(win);
}
