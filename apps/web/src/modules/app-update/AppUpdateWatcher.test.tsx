import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { MemoryRouter, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ stop: vi.fn(), start: vi.fn(), notifyPageChanged: vi.fn() }));
vi.mock("./appUpdate", () => ({ startAppUpdateWatch: mocks.start, notifyPageChanged: mocks.notifyPageChanged }));
import { AppUpdateWatcher } from "./AppUpdateWatcher";

let view: ReactTestRenderer | undefined;
let navigate: NavigateFunction;
function Navigator() {
  navigate = useNavigate();
  return null;
}
const mount = (path: string) => {
  act(() => {
    view = create(
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppUpdateWatcher />
        <Navigator />
      </MemoryRouter>,
    );
  });
};
const go = (path: string) => act(() => navigate(path));

beforeEach(() => {
  mocks.stop.mockReset();
  mocks.start.mockReset().mockReturnValue(mocks.stop);
  mocks.notifyPageChanged.mockReset();
});
afterEach(() => {
  if (view) act(() => view!.unmount());
  view = undefined;
});

describe("AppUpdateWatcher", () => {
  it("watches for a new version while mounted", () => {
    mount("/appointments");
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.stop).not.toHaveBeenCalled();
    act(() => view!.unmount());
    view = undefined;
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it("reports a move to another page, not the first render", () => {
    mount("/appointments");
    expect(mocks.notifyPageChanged).not.toHaveBeenCalled();
    go("/patients");
    expect(mocks.notifyPageChanged).toHaveBeenCalledTimes(1);
    go("/billing/cash-desk");
    expect(mocks.notifyPageChanged).toHaveBeenCalledTimes(2);
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it("does not take a new filter in the address for another page", () => {
    mount("/patients");
    go("/patients?search=ali");
    go("/patients#debts");
    expect(mocks.notifyPageChanged).not.toHaveBeenCalled();
  });
});
