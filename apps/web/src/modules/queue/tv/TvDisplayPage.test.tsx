import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueDisplayCall, QueueDisplayState } from "../api/queueTypes";

type DisplayResult = { state: QueueDisplayState | null; error: "not_found" | "inactive" | null; offline: boolean };
const mocks = vi.hoisted(() => ({
  display: { state: null, error: null, offline: false } as DisplayResult,
  codes: [] as string[],
  announcer: { unlock: vi.fn(), isUnlocked: vi.fn(), announce: vi.fn(), preload: vi.fn() },
}));
vi.mock("react-router-dom", () => ({ useParams: () => ({ code: "k7m2q-9xr4p" }) }));
vi.mock("./useQueueDisplay", () => ({
  useQueueDisplay: (code: string) => {
    mocks.codes.push(code);
    return mocks.display;
  },
}));
vi.mock("./announcer", () => ({ createAnnouncer: () => mocks.announcer }));

import { TvDisplayPage } from "./TvDisplayPage";

const oldCall: QueueDisplayCall = {
  key: "12:1", code: "07", number: 7, name: "Сардор Т.", room: null, doctorName: "Юсупова Нигора", calledAt: "2026-09-30T05:59:30.000Z",
};
const sample = (serverTime: string, recentCalls: QueueDisplayCall[]): QueueDisplayState => ({
  serverTime,
  timeZone: "Asia/Tashkent",
  clinicName: "Kamilovs Clinic",
  display: { name: "Холл", language: "uz_ru", voiceEnabled: true, showNames: true },
  cabinets: [
    {
      doctorId: 1, doctorName: "Каримов Бахтиёр", specialty: "Терапевт", room: "3",
      current: { code: "К-05", name: "Алишер К.", state: "serving" },
      waiting: [{ code: "К-06", name: "Мадина А." }, { code: "К-07", name: null }],
      waitingCount: 4,
    },
    {
      doctorId: 2, doctorName: "Юсупова Нигора", specialty: "", room: null,
      current: { code: "07", name: "Сардор Т.", state: "called" },
      waiting: [],
      waitingCount: 0,
    },
  ],
  recentCalls,
});

let storage: Map<string, string>;
const requestFullscreen = vi.fn(() => Promise.resolve());
const wakeLockRequest = vi.fn(() => Promise.resolve({ release: () => Promise.resolve() }));
const reload = vi.fn();
let view: ReactTestRenderer | undefined;

beforeEach(() => {
  mocks.display = { state: sample("2026-09-30T06:00:00.000Z", [oldCall]), error: null, offline: false };
  mocks.codes = [];
  mocks.announcer.unlock.mockReset().mockResolvedValue(true);
  mocks.announcer.isUnlocked.mockReset().mockReturnValue(true);
  mocks.announcer.announce.mockReset().mockResolvedValue(undefined);
  mocks.announcer.preload.mockReset().mockResolvedValue(undefined);
  requestFullscreen.mockClear();
  wakeLockRequest.mockClear();
  reload.mockClear();
  storage = new Map();
  // Timer functions delegate lazily, so a test that calls vi.useFakeTimers() gets the fake ones.
  vi.stubGlobal("window", {
    setTimeout: (handler: () => void, ms?: number) => setTimeout(handler, ms),
    clearTimeout: (id?: number) => clearTimeout(id),
    setInterval: (handler: () => void, ms?: number) => setInterval(handler, ms),
    clearInterval: (id?: number) => clearInterval(id),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value) },
    location: { reload },
  });
  vi.stubGlobal("document", {
    documentElement: { requestFullscreen },
    visibilityState: "visible",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("navigator", { wakeLock: { request: wakeLockRequest } });
});

afterEach(() => {
  if (view) act(() => view!.unmount());
  view = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const render = async () => {
  await act(async () => {
    view = create(<TvDisplayPage />);
  });
};
const rerender = async () => {
  await act(async () => {
    view!.update(<TvDisplayPage />);
  });
};
const html = () => JSON.stringify(view!.toJSON());
const startButton = () => view!.root.findAllByProps({ id: "qtv-start" });

describe("TvDisplayPage", () => {
  it("polls with the canonical code and renders cabinets, current patients and the next codes", async () => {
    await render();
    expect(mocks.codes[0]).toBe("K7M2Q9XR4P");
    const text = html();
    for (const expected of ["Kamilovs Clinic", "Navbat / Очередь", "Каримов Бахтиёр", "Терапевт", "К-05", "Алишер К.", "К-06", "К-07", "+2", "Сардор Т.", "Qabulda / На приёме", "Chaqirildi / Вызван", "Navbat yo‘q / Очереди нет", "So‘nggi chaqiruvlar / Последние вызовы", "→ Юсупова Нигора"]) {
      expect(text).toContain(expected);
    }
    expect(view!.root.findAllByProps({ className: "qtv-card" })).toHaveLength(2);
    // calls already present at the first poll are never announced
    expect(view!.root.findAllByProps({ className: "qtv-overlay" })).toHaveLength(0);
    // synthesized announcements are disclosed on screen while the voice is on
    expect(text).toContain("Ovoz sun’iy intellekt yordamida yaratilgan / Голос синтезирован ИИ");
  });

  it("lists waiting patients one per row with their masked names, and the rest beyond the list as +N", async () => {
    await render();
    const rows = view!.root.findAllByProps({ className: "qtv-next-row" });
    expect(rows.map((row) => row.findAllByType("span").map((span) => span.props.children))).toEqual([
      ["К-06", "Мадина А."],
      ["К-07"],
    ]);
    expect(view!.root.findByProps({ className: "qtv-next-more" }).props.children).toBe("+2");
  });

  it("lists four waiting rows per card when seven or more cabinets share the screen, and counts the rest", async () => {
    const base = sample("2026-09-30T06:00:00.000Z", [oldCall]);
    const waiting = ["К-06", "К-07", "К-08", "К-09", "К-10"].map((code) => ({ code, name: "Мадина А." }));
    const cabinets = Array.from({ length: 7 }, (_, index) => ({ ...base.cabinets[0], doctorId: index + 1, waiting, waitingCount: 6 }));
    mocks.display = { state: { ...base, cabinets }, error: null, offline: false };
    await render();
    const cards = view!.root.findAllByProps({ className: "qtv-card" });
    expect(cards).toHaveLength(7);
    for (const card of cards) {
      expect(card.findAllByProps({ className: "qtv-next-row" })).toHaveLength(4);
      expect(card.findByProps({ className: "qtv-next-more" }).props.children).toBe("+2");
    }
  });

  it("does not show the synthesized-voice note when the display has voice turned off", async () => {
    const quiet = sample("2026-09-30T06:00:00.000Z", [oldCall]);
    mocks.display = { state: { ...quiet, display: { ...quiet.display, voiceEnabled: false } }, error: null, offline: false };
    await render();
    expect(view!.root.findAllByProps({ className: "qtv-footer-note" })).toHaveLength(0);
  });

  it("shows the start gate; pressing it goes fullscreen, unlocks audio and remembers the start", async () => {
    await render();
    expect(startButton()).toHaveLength(1);
    expect(startButton()[0].props.autoFocus).toBe(true);
    expect(html()).toContain("Ekranni ishga tushirish / Запустить экран");
    await act(async () => {
      startButton()[0].props.onClick();
    });
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(mocks.announcer.unlock).toHaveBeenCalledTimes(1);
    expect(storage.get("qtv:started")).toBe("1");
    expect(wakeLockRequest).toHaveBeenCalledWith("screen");
    expect(startButton()).toHaveLength(0);
  });

  it("hides the gate by itself after a reload when audio unlocks silently", async () => {
    storage.set("qtv:started", "1");
    await render();
    expect(mocks.announcer.unlock).toHaveBeenCalledTimes(1);
    expect(startButton()).toHaveLength(0);
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it("keeps the gate after a reload when the browser refuses to unlock audio", async () => {
    storage.set("qtv:started", "1");
    mocks.announcer.unlock.mockResolvedValue(false);
    await render();
    expect(startButton()).toHaveLength(1);
  });

  it("shows a new call in the overlay and announces it in Russian only", async () => {
    await render();
    await act(async () => {
      startButton()[0].props.onClick();
    });
    const fresh: QueueDisplayCall = {
      key: "15:1", code: "К-06", number: 6, name: "Мадина А.", room: "3", doctorName: "Каримов Бахтиёр", calledAt: "2026-09-30T06:00:01.000Z",
    };
    mocks.display = { state: sample("2026-09-30T06:00:02.000Z", [fresh, oldCall]), error: null, offline: false };
    await rerender();
    expect(view!.root.findByProps({ className: "qtv-overlay-code" }).children).toEqual(["К-06"]);
    expect(html()).toContain("Navbatdagi raqam / Приглашается");
    expect(html()).toContain("→ Xona / Кабинет 3");
    expect(mocks.announcer.announce).toHaveBeenCalledWith(
      [["nomer", "6", "proydite_v_kabinet_nomer", "3"]],
      ["ru"],
      { signal: expect.any(AbortSignal) },
    );
  });

  it("cancels an announcement that is still pending after 20 s and moves on to the next call", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-30T06:00:00.000Z") });
    mocks.announcer.announce.mockImplementation(() => new Promise<void>(() => undefined)); // e.g. a stalled clip
    await render();
    await act(async () => {
      startButton()[0].props.onClick();
    });
    const fresh: QueueDisplayCall = { ...oldCall, key: "12:2", calledAt: "2026-09-30T06:00:01.000Z" };
    mocks.display = { state: sample("2026-09-30T06:00:02.000Z", [fresh, oldCall]), error: null, offline: false };
    await rerender();
    expect(view!.root.findAllByProps({ className: "qtv-overlay" })).toHaveLength(1);
    const signal: AbortSignal = mocks.announcer.announce.mock.calls[0][2].signal;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(19_999);
    });
    expect(signal.aborted).toBe(false);
    expect(view!.root.findAllByProps({ className: "qtv-overlay" })).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(signal.aborted).toBe(true); // a late announce() must not start speaking over the next call
    expect(view!.root.findAllByProps({ className: "qtv-overlay" })).toHaveLength(0);
  });

  it("preloads the Russian voice once the screen is started, whatever the display language", async () => {
    await render();
    expect(mocks.announcer.preload).not.toHaveBeenCalled(); // audio is still locked
    await act(async () => {
      startButton()[0].props.onClick();
    });
    expect(mocks.announcer.preload).toHaveBeenCalledTimes(1);
    expect(mocks.announcer.preload).toHaveBeenLastCalledWith(["ru"]);
    mocks.display = { state: sample("2026-09-30T06:00:02.000Z", [oldCall]), error: null, offline: false };
    await rerender();
    expect(mocks.announcer.preload).toHaveBeenCalledTimes(1); // a new poll is no reason to preload again
    const next = sample("2026-09-30T06:00:04.000Z", [oldCall]);
    mocks.display = { state: { ...next, display: { ...next.display, language: "ru" } }, error: null, offline: false };
    await rerender();
    expect(mocks.announcer.preload).toHaveBeenCalledTimes(1); // the voice does not depend on the display language
  });

  it("preloads nothing when the display has voice turned off", async () => {
    const quiet = sample("2026-09-30T06:00:00.000Z", [oldCall]);
    mocks.display = { state: { ...quiet, display: { ...quiet.display, voiceEnabled: false } }, error: null, offline: false };
    storage.set("qtv:started", "1");
    await render();
    expect(startButton()).toHaveLength(0);
    expect(mocks.announcer.preload).not.toHaveBeenCalled();
  });

  it("does not speak before the screen is started", async () => {
    await render();
    const fresh: QueueDisplayCall = { ...oldCall, key: "12:2", calledAt: "2026-09-30T06:00:01.000Z" };
    mocks.display = { state: sample("2026-09-30T06:00:02.000Z", [fresh]), error: null, offline: false };
    await rerender();
    expect(view!.root.findAllByProps({ className: "qtv-overlay" })).toHaveLength(1);
    expect(mocks.announcer.announce).not.toHaveBeenCalled();
  });

  it("shows the offline banner and keeps the last data", async () => {
    mocks.display = { ...mocks.display, offline: true };
    await render();
    expect(html()).toContain("Aloqa yo‘q / Нет связи");
    expect(html()).toContain("К-05");
  });

  it("reloads at 04:00 clinic time, but waits while the screen is offline", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-29T22:58:00.000Z") }); // 03:58 in Tashkent
    mocks.display = { state: sample("2026-09-29T22:58:00.000Z", [oldCall]), error: null, offline: true };
    await render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60_000);
    });
    expect(reload).not.toHaveBeenCalled();
    mocks.display = { ...mocks.display, offline: false };
    await rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("shows a full-screen message for an unknown screen code", async () => {
    mocks.display = { state: null, error: "not_found", offline: false };
    await render();
    expect(html()).toContain("Ekran o‘chirilgan. Administratordan yangi kod so‘rang.");
    expect(html()).toContain("Экран отключён. Попросите администратора выдать новый код.");
    expect(startButton()).toHaveLength(0);
  });

  it("shows a full-screen message for an inactive clinic subscription", async () => {
    mocks.display = { state: null, error: "inactive", offline: false };
    await render();
    expect(html()).toContain("Klinika obunasi faol emas.");
    expect(html()).toContain("Подписка клиники неактивна.");
  });
});
