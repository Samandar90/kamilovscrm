import { describe, expect, it } from "vitest";
import { QUEUE_ROLES } from "../auth/roleGroups";
import { navigationConfig } from "./navigationConfig";

describe("queue menu item", () => {
  it("sits in the main section right after appointments, for the queue roles, with a translated label", () => {
    const main = navigationConfig.find((section) => section.sectionKey === "nav.main");
    const paths = main?.items.map((item) => item.path) ?? [];
    expect(paths.indexOf("/queue")).toBe(paths.indexOf("/appointments") + 1);
    const item = main?.items.find((entry) => entry.path === "/queue");
    expect(item?.labelKey).toBe("pages.queue");
    expect(item?.roles).toEqual(QUEUE_ROLES);
    expect(item?.icon).toBeDefined();
  });
});
