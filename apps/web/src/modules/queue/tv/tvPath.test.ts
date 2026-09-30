import { describe, expect, it } from "vitest";
import { isTvPath } from "./tvPath";

describe("isTvPath", () => {
  it("matches the TV launch and display routes", () => {
    expect(isTvPath("/tv")).toBe(true);
    expect(isTvPath("/tv/")).toBe(true);
    expect(isTvPath("/tv/K7M2Q-9XR4P")).toBe(true);
    expect(isTvPath("/TV/K7M2Q9XR4P")).toBe(true);
  });

  it("leaves every staff route to the staff app", () => {
    expect(isTvPath("/")).toBe(false);
    expect(isTvPath("/tvx")).toBe(false);
    expect(isTvPath("/queue")).toBe(false);
    expect(isTvPath("/login")).toBe(false);
  });
});
