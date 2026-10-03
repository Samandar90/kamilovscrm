import { describe, expect, it } from "vitest";
import changePasswordModalSource from "../../components/ChangePasswordModal.tsx?raw";
import modalShellSource from "../../shared/ui/ModalShell.tsx?raw";
import modalSource from "../../ui/Modal.tsx?raw";
import platformPageSource from "../platform/pages/PlatformPage.tsx?raw";
import displaysPanelSource from "../queue/components/DisplaysPanel.tsx?raw";
import { HOLD_SELECTOR, isPageBusy, trackEdits } from "./reloadSafety";

type Listener = (event: { target: unknown }) => void;

/** An element as the browser exposes it to the tracker: tag, attributes, parent, and the state of a form control. */
type FakeElement = {
  tagName: string;
  isConnected: boolean;
  parentElement: FakeElement | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  type?: string;
  value?: string;
  checked?: boolean;
  textContent?: string;
};

function element(
  tagName: string,
  state: Partial<Pick<FakeElement, "type" | "value" | "checked" | "textContent">> = {},
  attributes: Record<string, string> = {},
  parentElement: FakeElement | null = null,
): FakeElement {
  return {
    tagName,
    isConnected: true,
    parentElement,
    getAttribute: (name) => attributes[name] ?? null,
    hasAttribute: (name) => name in attributes,
    ...state,
  };
}
const textarea = (value: string, parent: FakeElement | null = null) => element("TEXTAREA", { value }, {}, parent);
const input = (value: string, attributes: Record<string, string> = {}, parent: FakeElement | null = null) =>
  element("INPUT", { type: attributes.type ?? "text", value }, attributes, parent);

/** A page with edits tracked, no dialog and no beforeunload guard; the methods are what a user does. */
function openPage() {
  const listeners = new Map<string, Listener>();
  const fire = (type: string, target: unknown) => listeners.get(type)?.({ target });
  const page = {
    /** What `querySelector(HOLD_SELECTOR)` finds: an open dialog or a block marked `data-reload-hold`. */
    held: null as object | null,
    selectors: [] as string[],
    doc: {
      addEventListener: (type: string, listener: Listener) => void listeners.set(type, listener),
      removeEventListener: (type: string) => void listeners.delete(type),
      querySelector: (selector: string) => {
        page.selectors.push(selector);
        return page.held;
      },
    },
    win: new EventTarget(),
    listenerTypes: () => Array.from(listeners.keys()).sort(),
    /** Clicks into a field. */
    focus: (field: FakeElement) => fire("focusin", field),
    /** Replaces the text of a field, the way typing, erasing or pasting does. */
    type: (field: FakeElement, value: string) => {
      fire("focusin", field);
      fire("keydown", field);
      field.value = value;
      fire("input", field);
    },
    /** Clicks a checkbox or a radio button. */
    toggle: (field: FakeElement) => {
      fire("pointerdown", field);
      field.checked = !field.checked;
      fire("change", field);
    },
    /** Picks another option of a select. */
    pick: (field: FakeElement, value: string) => {
      fire("pointerdown", field);
      field.value = value;
      fire("change", field);
    },
    fire,
  };
  const edits = trackEdits(page.doc);
  return { page, edits, busy: () => isPageBusy(page.doc, page.win, edits) };
}

describe("isPageBusy: unsaved input", () => {
  it("is false on a page nobody touched, whatever its fields hold", () => {
    const { busy } = openPage();
    textarea("Амоксициллин 500 мг");
    expect(busy()).toBe(false);
  });

  it("is false for a field the user only clicked into", () => {
    const { page, busy } = openPage();
    page.focus(textarea("Амоксициллин 500 мг"));
    expect(busy()).toBe(false);
  });

  it("is true after the user typed into a field", () => {
    const { page, busy } = openPage();
    page.type(textarea(""), "Жалобы на боль в горле");
    expect(busy()).toBe(true);
  });

  it("is true after the user erased what the page had loaded: an emptied field is a change too", () => {
    const { page, busy } = openPage();
    page.type(textarea("Амоксициллин 500 мг"), "");
    expect(busy()).toBe(true);
  });

  it("is false once the field is back to what it held before the user touched it", () => {
    const { page, busy } = openPage();
    const typedAndCleared = textarea("");
    page.type(typedAndCleared, "черновик");
    page.type(typedAndCleared, "  ");
    const changedAndRestored = textarea("ОРВИ");
    page.type(changedAndRestored, "ОРВИ, лёгкое течение");
    page.type(changedAndRestored, "ОРВИ");
    expect(busy()).toBe(false);
  });

  it("counts a checkbox and a select by their state, not by the fact of a click", () => {
    const { page, busy } = openPage();
    const checkbox = element("INPUT", { type: "checkbox", value: "on", checked: false });
    page.toggle(checkbox);
    expect(busy()).toBe(true);
    page.toggle(checkbox);
    expect(busy()).toBe(false);

    const select = element("SELECT", { value: "" });
    page.pick(select, "3");
    expect(busy()).toBe(true);
    page.pick(select, "");
    expect(busy()).toBe(false);
  });

  it("counts an edit whose starting value it never saw, even if the field is empty now", () => {
    const { page, busy } = openPage();
    const field = input("");
    page.fire("input", field); // autofill or a drop: no click, no key before the change
    expect(busy()).toBe(true);
  });

  it("counts the text typed into an editable block", () => {
    const { page, busy } = openPage();
    const protocol = element("DIV", { textContent: "Печень не увеличена" }, { contenteditable: "true" });
    page.fire("focusin", protocol);
    page.fire("input", protocol);
    expect(busy()).toBe(true);
  });

  it("forgets a field that left the page: its form was saved or closed", () => {
    const { page, busy } = openPage();
    const amount = input("");
    page.type(amount, "150000");
    amount.isConnected = false;
    expect(busy()).toBe(false);
  });

  it("does not count a search box", () => {
    const { page, busy } = openPage();
    page.type(input("", { type: "search" }), "Каримов");
    expect(busy()).toBe(false);
  });

  it("does not count a field marked data-reload-ignore, or one inside a marked filter bar", () => {
    const { page, busy } = openPage();
    page.type(input("", { "data-reload-ignore": "" }), "Каримов");
    const bar = element("SECTION", {}, { "data-reload-ignore": "" });
    const label = element("LABEL", {}, {}, bar);
    page.type(input("", { type: "date" }, label), "2026-10-05");
    page.pick(element("SELECT", { value: "" }, {}, label), "paid");
    expect(busy()).toBe(false);
  });

  it("still counts a field next to a filter bar", () => {
    const { page, busy } = openPage();
    const form = element("DIV");
    element("SECTION", {}, { "data-reload-ignore": "" }, form);
    page.type(textarea("", form), "Рекомендации");
    expect(busy()).toBe(true);
  });

  it("stops counting edits once tracking is stopped, and removes every listener", () => {
    const { page, edits, busy } = openPage();
    expect(page.listenerTypes()).toEqual(["change", "focusin", "input", "keydown", "pointerdown"]);
    edits.stop();
    expect(page.listenerTypes()).toEqual([]);
    page.type(textarea(""), "после остановки");
    expect(busy()).toBe(false);
  });

  it("works without a tracker: before the watch has started nothing was typed under it", () => {
    const { page } = openPage();
    expect(isPageBusy(page.doc, page.win, null)).toBe(false);
  });
});

describe("isPageBusy: dialogs, held blocks and page guards", () => {
  it("is true while the page shows a dialog or a block that asks to be held", () => {
    const { page, busy } = openPage();
    page.held = {};
    expect(busy()).toBe(true);
    expect(page.selectors).toEqual([HOLD_SELECTOR]);
  });

  it("is true when the page guards its draft with a beforeunload listener", () => {
    const { page, busy } = openPage();
    const asked: boolean[] = [];
    page.win.addEventListener("beforeunload", (event) => {
      asked.push(event.cancelable);
      event.preventDefault();
    });
    expect(busy()).toBe(true);
    expect(asked).toEqual([true]);
  });
});

describe("HOLD_SELECTOR", () => {
  const selectors = HOLD_SELECTOR.split(", ");

  // Nothing renders these in a test (they are portals into document.body), so the classes are pinned by their source:
  // a modal that drops the full-screen layer would silently stop holding the reload back.
  it("matches the full-screen layer every shared modal renders", () => {
    expect(selectors).toContain(".fixed.inset-0");
    for (const source of [modalSource, modalShellSource, changePasswordModalSource]) {
      expect(source).toMatch(/className="fixed inset-0\b/);
    }
  });

  it("matches a block marked data-reload-hold", () => {
    expect(selectors).toContain("[data-reload-hold]");
  });

  // Shown once and kept only in the memory of the tab: the server stores a hash of the TV code, and nobody stores
  // the password typed for a new clinic. A reload while the admin walks to the TV would lose them.
  it("is asked for by the blocks that show a one-time secret", () => {
    expect(displaysPanelSource).toMatch(/\{revealed \? \(\s*<div data-reload-hold /);
    expect(platformPageSource).toMatch(/\{created \? \(\s*<div data-reload-hold /);
  });
});
