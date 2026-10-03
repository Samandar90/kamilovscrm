import { describe, expect, it } from "vitest";
import changePasswordModalSource from "../../components/ChangePasswordModal.tsx?raw";
import modalShellSource from "../../shared/ui/ModalShell.tsx?raw";
import modalSource from "../../ui/Modal.tsx?raw";
import { isPageBusy, OPEN_OVERLAY_SELECTOR, trackEditedFields } from "./reloadSafety";

type Listener = (event: { target: unknown }) => void;
type FakeField = { value?: string; textContent?: string; matches(selector: string): boolean };

/** A field as the page sees it; `filter` marks one that sits in a search box or a filter bar. */
const field = (value: string, filter = false): FakeField => ({
  value,
  matches: (selector: string) => filter && selector.includes("data-reload-ignore") && selector.includes('type="search"'),
});

/** A stand-in for `document`: the fields on the page, an optional open dialog and real input listeners. */
function fakePage() {
  const listeners = new Map<string, Listener>();
  const page = {
    fields: [] as FakeField[],
    dialogOpen: false,
    overlaySelectors: [] as string[],
    doc: {
      addEventListener: (type: string, listener: Listener) => void listeners.set(type, listener),
      removeEventListener: (type: string) => void listeners.delete(type),
      querySelector: (selector: string) => {
        page.overlaySelectors.push(selector);
        return page.dialogOpen ? {} : null;
      },
      querySelectorAll: () => page.fields,
    },
    /** The user types into (or switches) a field. */
    edit: (target: object, type = "input") => listeners.get(type)?.({ target }),
  };
  return page;
}

/** A page with edits tracked and no beforeunload guard. */
const trackedPage = () => {
  const page = fakePage();
  const stop = trackEditedFields(page.doc);
  return { page, stop, win: new EventTarget() };
};

describe("isPageBusy", () => {
  it("is false on a page nobody touched", () => {
    const { page, win } = trackedPage();
    page.fields = [field("Иванов"), field("")];
    expect(isPageBusy(page.doc, win)).toBe(false);
  });

  it("is true while a dialog is open, even an empty one", () => {
    const { page, win } = trackedPage();
    page.dialogOpen = true;
    expect(isPageBusy(page.doc, win)).toBe(true);
    expect(page.overlaySelectors).toEqual([OPEN_OVERLAY_SELECTOR]);
  });

  it("is true after the user typed into a field", () => {
    const { page, win } = trackedPage();
    const notes = field("Жалобы на боль в горле");
    page.fields = [notes];
    page.edit(notes);
    expect(isPageBusy(page.doc, win)).toBe(true);
  });

  it("counts a field that only reports `change` (a select, a checkbox)", () => {
    const { page, win } = trackedPage();
    const checkbox = field("on");
    page.fields = [checkbox];
    page.edit(checkbox, "change");
    expect(isPageBusy(page.doc, win)).toBe(true);
  });

  it("counts the text typed into an editable block", () => {
    const { page, win } = trackedPage();
    const protocol: FakeField = { textContent: "Печень не увеличена", matches: () => false };
    page.fields = [protocol];
    page.edit(protocol);
    expect(isPageBusy(page.doc, win)).toBe(true);
  });

  it("is false for a field the user typed into and cleared", () => {
    const { page, win } = trackedPage();
    const comment = field("черновик");
    page.fields = [comment];
    page.edit(comment);
    comment.value = "  ";
    expect(isPageBusy(page.doc, win)).toBe(false);
  });

  it("forgets a field that left the page (its form was saved or closed)", () => {
    const { page, win } = trackedPage();
    const amount = field("150000");
    page.fields = [amount];
    page.edit(amount);
    page.fields = [];
    expect(isPageBusy(page.doc, win)).toBe(false);
  });

  it("does not count a search box or a filter", () => {
    const { page, win } = trackedPage();
    const search = field("Каримов", true);
    page.fields = [search];
    page.edit(search);
    expect(isPageBusy(page.doc, win)).toBe(false);
  });

  it("is true when the page guards its draft with a beforeunload listener", () => {
    const { page, win } = trackedPage();
    const asked: boolean[] = [];
    win.addEventListener("beforeunload", (event) => {
      asked.push(event.cancelable);
      event.preventDefault();
    });
    expect(isPageBusy(page.doc, win)).toBe(true);
    expect(asked).toEqual([true]);
  });

  it("stops counting edits once tracking is stopped", () => {
    const { page, stop, win } = trackedPage();
    const notes = field("после остановки");
    page.fields = [notes];
    stop();
    page.edit(notes);
    expect(isPageBusy(page.doc, win)).toBe(false);
  });
});

describe("OPEN_OVERLAY_SELECTOR", () => {
  // Nothing renders these in a test (they are portals into document.body), so the classes are pinned by their source:
  // a modal that drops the full-screen layer would silently stop holding the reload back.
  it("matches the full-screen layer every shared modal renders", () => {
    expect(OPEN_OVERLAY_SELECTOR.split(", ")).toContain(".fixed.inset-0");
    for (const source of [modalSource, modalShellSource, changePasswordModalSource]) {
      expect(source).toMatch(/className="fixed inset-0\b/);
    }
  });
});
