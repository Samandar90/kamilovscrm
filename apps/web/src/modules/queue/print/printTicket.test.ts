import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueTicket } from "../api/queueTypes";
import { printQueueTicket } from "./printTicket";

const ticket: QueueTicket = {
  appointmentId: 42,
  clinicName: "Kamilovs Clinic",
  code: "К-05",
  number: 5,
  doctorName: "Каримов Азиз",
  specialty: "Терапевт",
  room: "12",
  issuedAt: "2026-09-30T06:05:00.000Z",
  aheadCount: 3,
  timeZone: "Asia/Tashkent",
};

/** Minimal stand-in for a same-origin iframe: vitest runs in node, there is no DOM. */
function fakeFrame(readyState: "complete" | "loading") {
  const listeners: Record<string, Array<() => void>> = {};
  const doc = { readyState, open: vi.fn(), write: vi.fn(), close: vi.fn() };
  const win = {
    document: doc,
    addEventListener: vi.fn((type: string, listener: () => void) => {
      (listeners[type] ??= []).push(listener);
    }),
    focus: vi.fn(),
    print: vi.fn(),
  };
  const frame = { style: { cssText: "" }, tabIndex: 0, setAttribute: vi.fn(), contentWindow: win, remove: vi.fn() };
  const fire = (type: string) => (listeners[type] ?? []).forEach((listener) => listener());
  return { frame, win, doc, fire };
}

let fake: ReturnType<typeof fakeFrame>;
let appendChild: ReturnType<typeof vi.fn>;

function setup(readyState: "complete" | "loading") {
  fake = fakeFrame(readyState);
  appendChild = vi.fn();
  vi.stubGlobal("document", { createElement: vi.fn(() => fake.frame), body: { appendChild } });
}

beforeEach(() => {
  vi.useFakeTimers();
  // Delegate at call time so the fake timers installed above are used.
  vi.stubGlobal("window", {
    setTimeout: (handler: () => void, ms?: number) => setTimeout(handler, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("printQueueTicket", () => {
  it("writes the ticket into a hidden frame and prints once when the document is ready at once (Chrome)", () => {
    setup("complete");
    printQueueTicket(ticket);
    expect(appendChild).toHaveBeenCalledWith(fake.frame);
    expect(fake.frame.style.cssText).toContain("visibility:hidden");
    expect(fake.doc.write).toHaveBeenCalledTimes(1);
    expect(fake.doc.write.mock.calls[0][0]).toContain('<div class="code">К-05</div>');
    expect(fake.doc.close).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(99);
    expect(fake.win.print).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fake.win.print).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(fake.win.print).toHaveBeenCalledTimes(1);
  });

  it("waits for load when the document is still loading", () => {
    setup("loading");
    printQueueTicket(ticket);
    vi.advanceTimersByTime(200);
    expect(fake.win.print).not.toHaveBeenCalled();
    fake.fire("load");
    vi.advanceTimersByTime(100);
    expect(fake.win.print).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(fake.win.print).toHaveBeenCalledTimes(1);
  });

  it("still prints after 500 ms when load never fires", () => {
    setup("loading");
    printQueueTicket(ticket);
    vi.advanceTimersByTime(499);
    expect(fake.win.print).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fake.win.print).toHaveBeenCalledTimes(1);
  });

  it("removes the frame after the print dialog closes", () => {
    setup("complete");
    printQueueTicket(ticket);
    vi.advanceTimersByTime(100);
    expect(fake.frame.remove).not.toHaveBeenCalled();
    fake.fire("afterprint");
    vi.advanceTimersByTime(0);
    expect(fake.frame.remove).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(fake.frame.remove).toHaveBeenCalledTimes(1);
  });

  it("removes the frame after 60 s when afterprint never fires", () => {
    setup("complete");
    printQueueTicket(ticket);
    vi.advanceTimersByTime(59_999);
    expect(fake.frame.remove).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fake.frame.remove).toHaveBeenCalledTimes(1);
  });
});
