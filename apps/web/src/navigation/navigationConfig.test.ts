import { describe, expect, it } from "vitest";
import { LEADS_ROLES, QUEUE_ROLES } from "../auth/roleGroups";
import ru from "../locales/ru.json";
import uz from "../locales/uz.json";
import { navigationConfig, type NavigationItem } from "./navigationConfig";

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

describe("leads menu item", () => {
  it("sits in the main section right after the call center, for the leads roles, with a translated label", () => {
    const main = navigationConfig.find((section) => section.sectionKey === "nav.main");
    const paths = main?.items.map((item) => item.path) ?? [];
    expect(paths).toContain("/leads");
    expect(paths.indexOf("/leads")).toBe(paths.indexOf("/call-center") + 1);
    const item = main?.items.find((entry) => entry.path === "/leads");
    expect(item?.labelKey).toBe("pages.leads");
    expect(item?.roles).toEqual(LEADS_ROLES);
    expect([...(item?.roles ?? [])].sort()).toEqual(["manager", "operator", "reception", "superadmin"]);
    expect(item?.icon).toBeDefined();
    expect(ru.pages.leads).toBe("Лиды");
    expect(uz.pages.leads).toBe("Lidlar");
  });
});

describe("external contractor", () => {
  it("is listed in no menu item, children included", () => {
    const withChildren = (items: NavigationItem[]): NavigationItem[] =>
      items.flatMap((item) => [item, ...withChildren(item.children ?? [])]);
    const all = withChildren(navigationConfig.flatMap((section) => section.items));
    expect(all.map((item) => item.path)).toContain("/billing/payments");
    expect(all.filter((item) => item.roles.includes("marketer")).map((item) => item.path ?? item.labelKey)).toEqual([]);
  });
});
