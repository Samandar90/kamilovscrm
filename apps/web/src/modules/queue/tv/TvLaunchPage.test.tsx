import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));

import { TvLaunchPage } from "./TvLaunchPage";

let view: ReactTestRenderer | undefined;
const input = () => view!.root.findByProps({ id: "qtv-code" });
const type = (value: string) => act(() => input().props.onChange({ target: { value } }));
const submit = () => {
  const preventDefault = vi.fn();
  act(() => view!.root.findByType("form").props.onSubmit({ preventDefault }));
  return preventDefault;
};

beforeEach(async () => {
  mocks.navigate.mockReset();
  await act(async () => {
    view = create(<TvLaunchPage />);
  });
});

afterEach(() => {
  if (view) act(() => view!.unmount());
  view = undefined;
});

describe("TvLaunchPage", () => {
  it("focuses the code field so the remote can type right away", () => {
    expect(input().props.autoFocus).toBe(true);
    expect(JSON.stringify(view!.toJSON())).toContain("Ekran kodini kiriting / Введите код экрана");
  });

  it("normalizes a typed code and opens /tv/<canonical code>", () => {
    type("k7m2q-9xr4p");
    expect(input().props.value).toBe("K7M2Q-9XR4P");
    const preventDefault = submit();
    expect(preventDefault).toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith("/tv/K7M2Q9XR4P");
  });

  it("keeps the open button disabled until all 10 characters are typed", () => {
    type("K7M2Q");
    expect(view!.root.findByType("button").props.disabled).toBe(true);
    submit();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
