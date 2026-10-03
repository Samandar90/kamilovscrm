/**
 * Whether a reload would take something from the user. Asked before every automatic reload to a new version: the page
 * is left alone while a dialog is open, while a field differs from what it held before the user touched it, while a
 * block asks to be held, and while the page itself objects.
 * Errs on the side of "busy": a wrong "busy" costs a banner that waits, a wrong "free" costs lost work.
 */

/**
 * What on the page holds a reload back by merely being there.
 * - Every modal of the app (ui/Modal, ModalShell, ChangePasswordModal, the mobile "more" sheet, the subscription
 *   notice) renders a full-screen `fixed inset-0` layer; the next three catch a dialog built in the standard way.
 * - `data-reload-hold` is for what lives only in the memory of the tab and is not a field: a one-time code or
 *   password shown after it was created. Put it on the block for as long as the block is shown.
 */
export const HOLD_SELECTOR = '.fixed.inset-0, [role="dialog"], [aria-modal="true"], dialog[open], [data-reload-hold]';
/**
 * A search box or a filter: what is typed there is a view of a list, not work to lose. A filter opts out with
 * `data-reload-ignore` on itself or on any ancestor, a search box with `type="search"`.
 */
const IGNORE_ATTRIBUTE = "data-reload-ignore";
/** Controls whose state can be read back and compared. An editable block counts as changed once it is edited. */
const FORM_CONTROLS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
/** The set of edited fields is cleared of the ones that left the page when it grows past this. */
const PRUNE_AT = 64;

type PageElement = {
  tagName: string;
  isConnected: boolean;
  parentElement: PageElement | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  type?: unknown;
  value?: unknown;
  checked?: unknown;
  textContent?: string | null;
};
type EditListener = (event: { target: unknown }) => void;
type EditSource = {
  addEventListener(type: string, listener: EditListener, capture: boolean): void;
  removeEventListener(type: string, listener: EditListener, capture: boolean): void;
};
type PageDocument = { querySelector(selector: string): unknown };
type PageWindow = { dispatchEvent(event: Event): boolean };

export type EditTracker = {
  /** True while a field on the page holds something else than before the user touched it. */
  hasUnsavedInput(): boolean;
  stop(): void;
};

const isElement = (target: unknown): target is PageElement =>
  typeof target === "object" && target !== null && typeof (target as PageElement).tagName === "string";

/** What a field holds, as text; surrounding spaces are not a change. */
function fieldState(field: PageElement): string {
  if (field.type === "checkbox" || field.type === "radio") return field.checked === true ? "checked" : "unchecked";
  return (typeof field.value === "string" ? field.value : (field.textContent ?? "")).trim();
}

function isFilter(field: PageElement): boolean {
  if ((field.getAttribute("type") ?? "").toLowerCase() === "search") return true;
  for (let element: PageElement | null = field; element; element = element.parentElement) {
    if (element.hasAttribute(IGNORE_ATTRIBUTE)) return true;
  }
  return false;
}

/**
 * Follows what the user edits from now on. A field counts as unsaved while it is on the page and holds something
 * else than it did before the user touched it: typed text, and equally a loaded text the user erased. Values the page
 * fills in itself are not the user's input; a form that was saved or closed takes its fields away with it.
 */
export function trackEdits(doc: EditSource): EditTracker {
  /** State of a control when the user first reached for it: a focus, a press or a key always comes before the change. */
  const before = new WeakMap<PageElement, string>();
  const edited = new Set<PageElement>();

  const rememberBefore: EditListener = ({ target }) => {
    if (isElement(target) && FORM_CONTROLS.has(target.tagName) && !before.has(target)) before.set(target, fieldState(target));
  };
  const rememberEdit: EditListener = ({ target }) => {
    if (!isElement(target)) return;
    if (edited.size >= PRUNE_AT) edited.forEach((field) => !field.isConnected && edited.delete(field));
    edited.add(target);
  };
  const listeners: Array<[string, EditListener]> = [
    ["focusin", rememberBefore],
    ["pointerdown", rememberBefore],
    ["keydown", rememberBefore],
    ["input", rememberEdit],
    // `change` as well: selects and checkboxes do not report `input` in every engine.
    ["change", rememberEdit],
  ];
  listeners.forEach(([type, listener]) => doc.addEventListener(type, listener, true));

  return {
    hasUnsavedInput() {
      for (const field of edited) {
        if (!field.isConnected) edited.delete(field);
        // An edit whose starting state was never seen (autofill, a drop) counts as a change: there is nothing to compare with.
        else if (!isFilter(field) && before.get(field) !== fieldState(field)) return true;
      }
      return false;
    },
    stop() {
      listeners.forEach(([type, listener]) => doc.removeEventListener(type, listener, true));
      edited.clear();
    },
  };
}

/**
 * Asks the page the question the browser asks before unloading it. A page that keeps a draft outside its fields
 * answers "no" through its own `beforeunload` guard (the call center does), and is then left alone here too.
 * As with the browser's own question, an answer does not mean the page is going away.
 */
function pageGuardsUnload(win: PageWindow): boolean {
  const question = new Event("beforeunload", { cancelable: true });
  win.dispatchEvent(question);
  return question.defaultPrevented;
}

/** `edits` is null before the watch has started. */
export function isPageBusy(doc: PageDocument, win: PageWindow, edits: EditTracker | null): boolean {
  return doc.querySelector(HOLD_SELECTOR) !== null || (edits !== null && edits.hasUnsavedInput()) || pageGuardsUnload(win);
}
