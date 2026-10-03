import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ available: false, reloadToNewVersion: vi.fn() }));
vi.mock("./appUpdate", () => ({ useUpdateAvailable: () => mocks.available, reloadToNewVersion: mocks.reloadToNewVersion }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => `t:${key}` }) }));
import { AppUpdateBanner } from "./AppUpdateBanner";

let view: ReactTestRenderer;
const render = (available: boolean) => {
  mocks.available = available;
  act(() => {
    view = create(<AppUpdateBanner />);
  });
};

beforeEach(() => mocks.reloadToNewVersion.mockReset());
afterEach(() => {
  act(() => view.unmount());
  vi.unstubAllGlobals();
});

describe("AppUpdateBanner", () => {
  it("renders nothing while the tab runs the deployed version", () => {
    render(false);
    expect(view.toJSON()).toBeNull();
  });

  it("says that a new version is available and offers a reload", () => {
    render(true);
    expect(JSON.stringify(view.toJSON())).toContain("t:appUpdate.available");
    expect(view.root.findByType("button").children).toEqual(["t:common.actions.refresh"]);
    expect(mocks.reloadToNewVersion).not.toHaveBeenCalled();
  });

  it("reloads on the button, with a question to ask if work would be lost", () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("window", { confirm });
    render(true);
    view.root.findByType("button").props.onClick();
    expect(mocks.reloadToNewVersion).toHaveBeenCalledTimes(1);
    const ask = mocks.reloadToNewVersion.mock.calls[0][0] as () => boolean;
    expect(confirm).not.toHaveBeenCalled();
    expect(ask()).toBe(false);
    expect(confirm).toHaveBeenCalledWith("t:appUpdate.unsavedConfirm");
  });
});
