import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSpeechVoice, SPEAK_TIMEOUT_MS, VOICES_WAIT_MS } from "./speechVoice";

class FakeUtterance {
  voice: unknown = null;
  lang = "";
  rate = 1;
  volume = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

function fakeEngine(voices: Array<{ name: string; lang: string }>) {
  const listeners = new Set<() => void>();
  const spoken: FakeUtterance[] = [];
  const synth = {
    speaking: false,
    pending: false,
    paused: false,
    voices,
    getVoices: vi.fn(() => synth.voices),
    speak: vi.fn((utterance: FakeUtterance) => {
      spoken.push(utterance);
    }),
    cancel: vi.fn(),
    resume: vi.fn(),
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
  };
  return {
    synth,
    spoken,
    fireVoicesChanged: () => [...listeners].forEach((listener) => listener()),
    engine: { synth: synth as unknown as SpeechSynthesis, Utterance: FakeUtterance as unknown as typeof SpeechSynthesisUtterance },
  };
}

const IRINA = { name: "Microsoft Irina - Russian (Russia)", lang: "ru-RU" };
const DAVID = { name: "Microsoft David - English (United States)", lang: "en-US" };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createSpeechVoice: availability", () => {
  it("is available when a Russian voice is installed", async () => {
    const { engine } = fakeEngine([DAVID, IRINA]);
    await expect(createSpeechVoice(engine).isAvailable()).resolves.toBe(true);
  });

  it("is not available with English voices only", async () => {
    const { engine } = fakeEngine([DAVID]);
    await expect(createSpeechVoice(engine).isAvailable()).resolves.toBe(false);
  });

  it("is not available without the speech API", async () => {
    await expect(createSpeechVoice({ synth: null, Utterance: null }).isAvailable()).resolves.toBe(false);
  });

  it("waits for voices that load late", async () => {
    const fake = fakeEngine([]);
    const pending = createSpeechVoice(fake.engine).isAvailable();
    fake.synth.voices = [IRINA];
    fake.fireVoicesChanged();
    await expect(pending).resolves.toBe(true);
    expect(fake.synth.removeEventListener).toHaveBeenCalled();
  });

  it("gives up waiting for voices after 1.5 s", async () => {
    const fake = fakeEngine([]);
    const pending = createSpeechVoice(fake.engine).isAvailable();
    await vi.advanceTimersByTimeAsync(VOICES_WAIT_MS);
    await expect(pending).resolves.toBe(false);
  });
});

describe("createSpeechVoice: speak", () => {
  it("speaks the text with the Russian voice and resolves when it ends", async () => {
    const fake = fakeEngine([DAVID, IRINA]);
    const done = vi.fn();
    const promise = createSpeechVoice(fake.engine).speak("Пройдите к врачу Каримову.").then(done);
    expect(fake.spoken).toHaveLength(1);
    const utterance = fake.spoken[0];
    expect(utterance.text).toBe("Пройдите к врачу Каримову.");
    expect(utterance.voice).toBe(IRINA);
    expect(utterance.lang).toBe("ru-RU");
    expect(utterance.rate).toBeLessThan(1);
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    utterance.onend!();
    await promise;
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("accepts a voice whose language is written ru_RU", () => {
    const fake = fakeEngine([{ name: "Android ru", lang: "ru_RU" }]);
    void createSpeechVoice(fake.engine).speak("Текст");
    expect(fake.spoken).toHaveLength(1);
  });

  it("resolves quietly when the engine reports an error", async () => {
    const fake = fakeEngine([IRINA]);
    const promise = createSpeechVoice(fake.engine).speak("Текст");
    fake.spoken[0].onerror!();
    await expect(promise).resolves.toBeUndefined();
  });

  it("says nothing without a Russian voice or when already aborted", async () => {
    const english = fakeEngine([DAVID]);
    await createSpeechVoice(english.engine).speak("Текст");
    expect(english.spoken).toHaveLength(0);
    const fake = fakeEngine([IRINA]);
    const controller = new AbortController();
    controller.abort();
    await createSpeechVoice(fake.engine).speak("Текст", { signal: controller.signal });
    expect(fake.spoken).toHaveLength(0);
  });

  it("cancels the speech and resolves when the signal aborts", async () => {
    const fake = fakeEngine([IRINA]);
    const controller = new AbortController();
    const promise = createSpeechVoice(fake.engine).speak("Текст", { signal: controller.signal });
    controller.abort();
    await promise;
    expect(fake.synth.cancel).toHaveBeenCalled();
  });

  it("gives up after 15 s if the engine never reports the end", async () => {
    const fake = fakeEngine([IRINA]);
    const promise = createSpeechVoice(fake.engine).speak("Текст");
    await vi.advanceTimersByTimeAsync(SPEAK_TIMEOUT_MS);
    await promise;
    expect(fake.synth.cancel).toHaveBeenCalled();
  });

  it("clears a stuck earlier utterance and a paused engine before speaking", () => {
    const fake = fakeEngine([IRINA]);
    fake.synth.speaking = true;
    fake.synth.paused = true;
    void createSpeechVoice(fake.engine).speak("Текст");
    expect(fake.synth.cancel).toHaveBeenCalledTimes(1);
    expect(fake.synth.resume).toHaveBeenCalledTimes(1);
    expect(fake.spoken).toHaveLength(1);
  });

  it("resolves when speak() throws", async () => {
    const fake = fakeEngine([IRINA]);
    fake.synth.speak.mockImplementation(() => {
      throw new Error("blocked");
    });
    await expect(createSpeechVoice(fake.engine).speak("Текст")).resolves.toBeUndefined();
  });
});
