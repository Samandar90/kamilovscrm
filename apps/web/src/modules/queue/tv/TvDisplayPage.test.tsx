import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueDisplayCall, QueueDisplayState } from "../api/queueTypes";

type DisplayResult = { state: QueueDisplayState | null; error: "not_found" | "inactive" | null; offline: boolean };
const mocks = vi.hoisted(() => ({
  display: { state: null, error: null, offline: false } as DisplayResult,
  codes: [] as string[],
  announcer: { unlock: vi.fn(), isUnlocked: vi.fn(), announce: vi.fn(), preload: vi.fn() },
  voice: { isAvailable: vi.fn(), speak: vi.fn() },
}));
vi.mock("react-router-dom", () => ({ useParams: () => ({ code: "k7m2q-9xr4p" }) }));
vi.mock("./useQueueDisplay", () => ({
  useQueueDisplay: (code: string) => {
    mocks.codes.push(code);
    return mocks.display;
  },
}));
vi.mock("./announcer", () => ({ createAnnouncer: () => mocks.announcer }));
vi.mock("./speechVoice", () => ({ createSpeechVoice: () => mocks.voice }));

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
  mocks.voice.isAvailable.mockReset().mockResolvedValue(true);
  mocks.voice.speak.mockReset().mockResolvedValue(undefined);
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
    for (const expected of ["Kamilovs Clinic", "Очередь", "Каримов Бахтиёр", "Терапевт", "К-05", "Алишер К.", "К-06", "К-07", "+2", "Сардор Т.", "На приёме", "Вызван", "Очереди нет", "Последние вызовы", "→ Юсупова Нигора"]) {
      expect(text).toContain(expected);
    }
    expect(view!.root.findAllByProps({ className: "qtv-card" })).toHaveLength(2);
    // calls already present at the first poll are never announced
    expect(view!.root.findAllByProps({ className: "qtv-overlay" })).toHaveLength(0);
    // synthesized announcements are disclosed on screen while the voice is on
    expect(text).toContain("Голос синтезирован ИИ");
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
    expect(html()).toContain("Запустить экран");
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
    expect(html()).toContain("Приглашается");
    expect(html()).toContain("→ Кабинет 3");
    // «Номер шесть.» from the clips; the doctor sentence follows from the browser voice after a short pause
    expect(mocks.announcer.announce).toHaveBeenCalledWith([["nomer", "6"]], ["ru"], { signal: expect.any(AbortSignal) });
  });

  describe("cabinets without a queue", () => {
    const cabinet = (doctorId: number, doctorName: string, patch: Partial<QueueDisplayState["cabinets"][number]> = {}) => ({
      doctorId, doctorName, specialty: "", room: String(doctorId), current: null, waiting: [], waitingCount: 0, ...patch,
    });
    const show = (cabinets: QueueDisplayState["cabinets"]) => {
      mocks.display = { state: { ...sample("2026-09-30T06:00:00.000Z", [oldCall]), cabinets }, error: null, offline: false };
    };

    it("leaves off a doctor who has finished everyone, and one who has nobody today", async () => {
      show([
        cabinet(1, "Каримов Бахтиёр", { current: { code: "К-05", name: null, state: "serving" } }),
        cabinet(2, "Юсупова Нигора"),
        cabinet(3, "Назарова Дилноза"),
      ]);
      await render();
      // the footer «Последние вызовы» still lists past calls of every doctor: look at the cards only
      expect(view!.root.findAllByProps({ className: "qtv-doctor-name" }).map((node) => node.children.join(""))).toEqual(["Каримов Бахтиёр"]);
      expect(html()).not.toContain("Свободно");
    });

    it("keeps a doctor who is free but has patients waiting", async () => {
      show([cabinet(1, "Каримов Бахтиёр", { waiting: [{ code: "К-06", name: "Мадина А." }], waitingCount: 1 })]);
      await render();
      expect(view!.root.findAllByProps({ className: "qtv-card" })).toHaveLength(1);
      expect(html()).toContain("Свободно");
      expect(html()).toContain("К-06");
    });

    it("keeps a doctor whose patient was called but has not come in yet", async () => {
      show([cabinet(1, "Каримов Бахтиёр", { current: { code: "К-06", name: null, state: "called" } })]);
      await render();
      expect(view!.root.findAllByProps({ className: "qtv-card" })).toHaveLength(1);
      expect(html()).toContain("Вызван");
    });

    it("shows «Очереди пока нет» when nobody has a queue", async () => {
      show([cabinet(1, "Каримов Бахтиёр"), cabinet(2, "Юсупова Нигора")]);
      await render();
      expect(view!.root.findAllByProps({ className: "qtv-card" })).toHaveLength(0);
      expect(html()).toContain("Очереди пока нет");
    });

    it("sizes the grid from the visible cabinets, not from all of them", async () => {
      show([cabinet(1, "Каримов Бахтиёр", { current: { code: "К-05", name: null, state: "serving" } }), cabinet(2, "Юсупова Нигора"), cabinet(3, "Назарова Дилноза")]);
      await render();
      expect(view!.root.findAllByProps({ className: "qtv-grid qtv-cols-1" })).toHaveLength(1); // one card fills the screen, not a cell of 2x2
    });

    it("pages by the visible cabinets: eleven doctors with four idle fit one page", async () => {
      const busy = (id: number) => cabinet(id, `Врач ${id}`, { waiting: [{ code: `К-${id}`, name: null }], waitingCount: 1 });
      const ids = Array.from({ length: 11 }, (_, i) => i + 1);
      show(ids.map((id) => (id <= 7 ? busy(id) : cabinet(id, `Врач ${id}`))));
      await render();
      expect(view!.root.findAllByProps({ className: "qtv-card" })).toHaveLength(7);
      expect(view!.root.findAllByProps({ className: "qtv-pages" })).toHaveLength(0);
      show(ids.map(busy)); // control: all eleven busy → two pages
      await rerender();
      expect(view!.root.findAllByProps({ className: "qtv-pages" })).toHaveLength(1);
    });

    it("brings a doctor back when a patient arrives", async () => {
      show([cabinet(1, "Каримов Бахтиёр")]);
      await render();
      expect(view!.root.findAllByProps({ className: "qtv-card" })).toHaveLength(0);
      show([cabinet(1, "Каримов Бахтиёр", { waiting: [{ code: "К-01", name: null }], waitingCount: 1 })]);
      await rerender();
      expect(view!.root.findAllByProps({ className: "qtv-card" })).toHaveLength(1);
    });
  });

  describe("the doctor sentence", () => {
    const start = async () => {
      vi.useFakeTimers({ now: new Date("2026-09-30T06:00:00.000Z") });
      await render();
      await act(async () => {
        startButton()[0].props.onClick();
      });
    };
    const call = async (patch: Partial<QueueDisplayCall> = {}) => {
      const fresh: QueueDisplayCall = {
        key: "15:1", code: "К-06", number: 6, name: "Мадина А.", room: "3", doctorName: "Каримов Бахтиёр", calledAt: "2026-09-30T06:00:01.000Z", ...patch,
      };
      mocks.display = { state: sample("2026-09-30T06:00:02.000Z", [fresh, oldCall]), error: null, offline: false };
      await rerender();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    };

    it("is spoken after the number, in the dative case, by the browser voice", async () => {
      await start();
      await call();
      expect(mocks.voice.speak).toHaveBeenCalledTimes(1);
      expect(mocks.voice.speak).toHaveBeenCalledWith("Пройдите к врачу Каримову Бахтиёру.", { signal: expect.any(AbortSignal) });
      expect(mocks.announcer.announce.mock.invocationCallOrder[0]).toBeLessThan(mocks.voice.speak.mock.invocationCallOrder[0]);
    });

    it("is replaced by «Пройдите на приём.» when the browser has no Russian voice", async () => {
      mocks.voice.isAvailable.mockResolvedValue(false);
      await start();
      await call();
      expect(mocks.announcer.announce).toHaveBeenCalledWith([["nomer", "6", "proydite_na_priyom"]], ["ru"], { signal: expect.any(AbortSignal) });
      expect(mocks.voice.speak).not.toHaveBeenCalled();
    });

    it("is replaced by «Пройдите на приём.» when the doctor has no name", async () => {
      await start();
      await call({ doctorName: "" });
      expect(mocks.announcer.announce).toHaveBeenCalledWith([["nomer", "6", "proydite_na_priyom"]], ["ru"], { signal: expect.any(AbortSignal) });
      expect(mocks.voice.speak).not.toHaveBeenCalled();
    });

    it("is not spoken for a queue number above 999 (chime only)", async () => {
      await start();
      await call({ number: 1000, code: "К-1000" });
      expect(mocks.announcer.announce).toHaveBeenCalledWith([[]], ["ru"], { signal: expect.any(AbortSignal) });
      expect(mocks.voice.speak).not.toHaveBeenCalled();
    });

    it("is not spoken when the screen has the voice turned off", async () => {
      const quiet = sample("2026-09-30T06:00:00.000Z", [oldCall]);
      mocks.display = { state: { ...quiet, display: { ...quiet.display, voiceEnabled: false } }, error: null, offline: false };
      await start();
      const fresh: QueueDisplayCall = { ...oldCall, key: "12:2", calledAt: "2026-09-30T06:00:01.000Z" };
      const next = sample("2026-09-30T06:00:02.000Z", [fresh, oldCall]);
      mocks.display = { state: { ...next, display: { ...next.display, voiceEnabled: false } }, error: null, offline: false };
      await rerender();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(mocks.voice.speak).not.toHaveBeenCalled();
    });

    it("is cut off together with the clips when the announcement is cancelled", async () => {
      mocks.announcer.announce.mockImplementation(() => new Promise<void>(() => undefined));
      await start();
      await call();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(mocks.voice.speak).not.toHaveBeenCalled();
    });
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
    expect(mocks.voice.isAvailable).toHaveBeenCalledTimes(1); // the browser's voices load before the first call
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
    expect(html()).toContain("Нет связи");
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
    expect(html()).toContain("Экран отключён. Попросите администратора выдать новый код.");
    expect(startButton()).toHaveLength(0);
  });

  it("shows a full-screen message for an inactive clinic subscription", async () => {
    mocks.display = { state: null, error: "inactive", offline: false };
    await render();
    expect(html()).toContain("Подписка клиники неактивна.");
  });
});
