import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnnouncer } from "./announcer";
import voiceClips from "./voiceClips.json";

/**
 * Minimal fake of the Web Audio API. A fake "mp3" is raw float32 samples at 1000 Hz, so a clip of
 * 100 silent + 400 loud + 100 silent samples decodes to 0.6 s and is trimmed to 400 + 2 × 15 padding = 0.43 s.
 */
const SAMPLE_RATE = 1000;
type Scheduled = { kind: "tone" | "clip"; at: number; frequency?: number; duration?: number };
let scheduled: Scheduled[];
let resumeBehaviour: "resolve" | "hang";

class FakeBuffer {
  private readonly channels: Float32Array[];
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData(channel: number) {
    return this.channels[channel];
  }
}

class FakeParam {
  readonly values: number[] = [];
  setValueAtTime(value: number) { this.values.push(value); return this; }
  linearRampToValueAtTime(value: number) { this.values.push(value); return this; }
  exponentialRampToValueAtTime(value: number) { this.values.push(value); return this; }
}

class FakeAudioContext {
  state: "suspended" | "running" = "suspended";
  currentTime = 0;
  sampleRate = SAMPLE_RATE;
  destination = {};
  resume = vi.fn(() => {
    if (resumeBehaviour === "hang") return new Promise<void>(() => undefined);
    this.state = "running";
    return Promise.resolve();
  });
  createOscillator() {
    const oscillator = {
      type: "",
      frequency: new FakeParam(),
      connect: () => undefined,
      stop: () => undefined,
      start: (at: number) => { scheduled.push({ kind: "tone", at, frequency: oscillator.frequency.values[0] }); },
    };
    return oscillator;
  }
  createGain() {
    return { gain: new FakeParam(), connect: () => undefined };
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return new FakeBuffer(channels, length, sampleRate);
  }
  createBufferSource() {
    const source = {
      buffer: null as FakeBuffer | null,
      connect: () => undefined,
      start: (at: number) => {
        // The 1-sample unlock buffer is not a clip.
        if (source.buffer && source.buffer.length > 1) scheduled.push({ kind: "clip", at, duration: source.buffer.duration });
      },
    };
    return source;
  }
  decodeAudioData(bytes: ArrayBuffer, ok: (buffer: FakeBuffer) => void, fail: (error: Error) => void) {
    // Like a real decoder, refuse anything that is not audio (here: HTML served by the SPA fallback).
    if (bytes.byteLength === 0 || bytes.byteLength % 4 !== 0 || new Uint8Array(bytes)[0] === 0x3c) {
      fail(new Error("EncodingError"));
      return undefined;
    }
    const samples = new Float32Array(bytes);
    const buffer = new FakeBuffer(1, samples.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);
    ok(buffer);
    return undefined;
  }
}

const clipBytes = (): ArrayBuffer => {
  const samples = new Float32Array(600);
  samples.fill(0.5, 100, 500);
  return samples.buffer;
};

let missing: Set<string>;
let htmlFallback: Set<string>;
const fetchMock = vi.fn(async (url: string) => {
  if (missing.has(url)) return new Response("not found", { status: 404 });
  if (htmlFallback.has(url)) return new Response("<!doctype html><html></html>", { status: 200 });
  return new Response(clipBytes(), { status: 200 });
});

beforeEach(() => {
  vi.useFakeTimers();
  scheduled = [];
  resumeBehaviour = "resolve";
  missing = new Set();
  htmlFallback = new Set();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  // Delegate lazily so the fake timers installed above are the ones used.
  vi.stubGlobal("window", {
    AudioContext: FakeAudioContext,
    setTimeout: (handler: () => void, ms?: number) => setTimeout(handler, ms),
    clearTimeout: (id?: number) => clearTimeout(id),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const UZ = ["navbat_raqami", "20", "7", "xona_raqami", "5"];
const RU = ["nomer", "20", "7", "proydite_v_kabinet_nomer", "5"];

async function announce(announcer: ReturnType<typeof createAnnouncer>, groups: string[][], langs: Array<"uz" | "ru">) {
  const done = announcer.announce(groups, langs);
  await vi.advanceTimersByTimeAsync(20_000);
  await done;
}

describe("createAnnouncer", () => {
  it("unlocks by resuming the audio context", async () => {
    const announcer = createAnnouncer();
    expect(announcer.isUnlocked()).toBe(false);
    await expect(announcer.unlock()).resolves.toBe(true);
    expect(announcer.isUnlocked()).toBe(true);
  });

  it("gives up after a short wait when resume() never settles (no user gesture)", async () => {
    resumeBehaviour = "hang";
    const announcer = createAnnouncer();
    const result = announcer.unlock();
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toBe(false);
    expect(announcer.isUnlocked()).toBe(false);
  });

  it("reports failure and stays silent without Web Audio", async () => {
    vi.stubGlobal("window", { setTimeout: (handler: () => void, ms?: number) => setTimeout(handler, ms) });
    const announcer = createAnnouncer();
    await expect(announcer.unlock()).resolves.toBe(false);
    await announce(announcer, [UZ], ["uz"]);
    await announcer.preload(["uz", "ru"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("plays the ding-dong, then the Uzbek phrase, then the Russian phrase back to back", async () => {
    const announcer = createAnnouncer();
    await announcer.unlock();
    await announce(announcer, [UZ, RU], ["uz", "ru"]);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      ...UZ.map((id) => `/queue-voice/uz/${id}.mp3`),
      ...RU.map((id) => `/queue-voice/ru/${id}.mp3`),
    ]);
    const tones = scheduled.filter((item) => item.kind === "tone");
    expect(tones.map((tone) => tone.frequency)).toEqual([659.25, 523.25]);
    expect(tones[0].at).toBeCloseTo(0.05);
    expect(tones[1].at).toBeCloseTo(0.4);

    const starts = scheduled.filter((item) => item.kind === "clip").map((item) => item.at);
    expect(starts).toHaveLength(10);
    // chime ends at 0.05 + 0.35 + 0.9 = 1.3 s, speech starts 0.25 s later; trimmed clips last 0.43 s
    const expected = [1.55, 2.04, 2.53, 3.26, 3.75, 4.88, 5.37, 5.86, 6.59, 7.08];
    starts.forEach((at, index) => expect(at).toBeCloseTo(expected[index], 5));
  });

  it("skips the speech of a language with a missing clip and keeps the other language", async () => {
    missing.add("/queue-voice/ru/proydite_v_kabinet_nomer.mp3");
    htmlFallback.add("/queue-voice/uz/xona_raqami.mp3");
    const announcer = createAnnouncer();
    await announcer.unlock();
    await announce(announcer, [UZ, RU], ["uz", "ru"]);
    expect(scheduled.filter((item) => item.kind === "tone")).toHaveLength(2);
    expect(scheduled.filter((item) => item.kind === "clip")).toHaveLength(0);

    htmlFallback.clear();
    scheduled = [];
    await announce(announcer, [UZ, RU], ["uz", "ru"]);
    expect(scheduled.filter((item) => item.kind === "clip")).toHaveLength(5);
  });

  it("plays only the chime for an empty phrase (number above 999)", async () => {
    const announcer = createAnnouncer();
    await announcer.unlock();
    await announce(announcer, [[], []], ["uz", "ru"]);
    expect(scheduled.map((item) => item.kind)).toEqual(["tone", "tone"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("downloads each clip once and reuses the decoded audio", async () => {
    const announcer = createAnnouncer("/voice");
    await announcer.unlock();
    await announce(announcer, [RU], ["ru"]);
    await announce(announcer, [RU], ["ru"]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[0][0]).toBe("/voice/ru/nomer.mp3");
    expect(scheduled.filter((item) => item.kind === "clip")).toHaveLength(10);
  });

  it("preloads every clip of the display languages, one by one, and announcements reuse them", async () => {
    const announcer = createAnnouncer();
    await announcer.unlock();
    const preloading = announcer.preload(["ru"]);
    await vi.advanceTimersByTimeAsync(1000);
    await preloading;
    const ruIds = Object.keys(voiceClips.ru);
    expect(ruIds).toHaveLength(39);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(ruIds.map((id) => `/queue-voice/ru/${id}.mp3`));
    await announce(announcer, [RU], ["ru"]);
    expect(fetchMock).toHaveBeenCalledTimes(39); // nothing downloaded again
    expect(scheduled.filter((item) => item.kind === "clip")).toHaveLength(5);
  });

  it("ignores clips that fail to preload and fetches them again for the announcement", async () => {
    missing.add("/queue-voice/uz/navbat_raqami.mp3");
    const announcer = createAnnouncer();
    await announcer.unlock();
    const preloading = announcer.preload(["uz"]);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(preloading).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(30);
    missing.clear();
    await announce(announcer, [UZ], ["uz"]);
    expect(fetchMock.mock.calls.slice(30).map(([url]) => url)).toEqual(["/queue-voice/uz/navbat_raqami.mp3"]);
    expect(scheduled.filter((item) => item.kind === "clip")).toHaveLength(5);
  });

  it("never makes an announcement wait for the background preload", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The preload's first download ("1") hangs until released.
    fetchMock.mockImplementationOnce(async () => {
      await held;
      return new Response(clipBytes(), { status: 200 });
    });
    const announcer = createAnnouncer();
    await announcer.unlock();
    const preloading = announcer.preload(["ru"]);
    await announce(announcer, [RU], ["ru"]);
    expect(scheduled.filter((item) => item.kind === "clip")).toHaveLength(5);
    release();
    await vi.advanceTimersByTimeAsync(1000);
    await preloading;
    expect(fetchMock).toHaveBeenCalledTimes(39); // the announced clips were not downloaded twice
  });
});
