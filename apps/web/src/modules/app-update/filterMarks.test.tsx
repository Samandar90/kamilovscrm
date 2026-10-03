import { act, create, type ReactTestRenderer, type ReactTestRendererJSON } from "react-test-renderer";
import { afterEach, describe, expect, it } from "vitest";
import appointmentsPageSource from "../appointments/pages/AppointmentsPage.tsx?raw";
import cashDeskPageSource from "../billing/pages/CashDeskPage.tsx?raw";
import callCenterPageSource from "../call-center/pages/CallCenterPage.tsx?raw";
import patientsPageSource from "../patients/pages/PatientsPage.tsx?raw";
import { FiltersBar } from "../../shared/ui/FiltersBar";

let view: ReactTestRenderer | undefined;
afterEach(() => {
  if (view) act(() => view!.unmount());
  view = undefined;
});

// What is typed into a filter is not unsaved work (reloadSafety.ts). Without the mark a tab whose user once picked
// a date or searched for a patient would never reload by itself, and would stay on the old version behind a banner.
describe("filters marked with data-reload-ignore", () => {
  it("marks every FiltersBar (invoices, payments, expenses)", () => {
    act(() => {
      view = create(
        <FiltersBar>
          <input />
        </FiltersBar>,
      );
    });
    const bar = view!.toJSON() as ReactTestRendererJSON;
    expect(bar.props).toHaveProperty("data-reload-ignore");
  });

  it("marks the filters of the pages staff keep open all day", () => {
    // Search boxes with type="search" need no mark; these are the date pickers, the selects and one plain search input.
    expect(appointmentsPageSource).toContain('<SectionCard className="hidden p-4 md:block" data-reload-ignore>');
    expect(patientsPageSource).toMatch(/<input\s+data-reload-ignore\s+value=\{searchInput\}/);
    expect(cashDeskPageSource).toMatch(/<input\s+data-reload-ignore\s+type="date"/);
    expect(callCenterPageSource).toContain('<div className="cc-filters" data-reload-ignore>');
  });
});
