/**
 * The browser's own text-to-speech (Web Speech API), used for the doctor's name: names are data, so they cannot be
 * recorded in advance like the number clips. Needs a Russian voice on the TV device (Windows: Microsoft Irina/Pavel,
 * Chrome: "Google русский"); without one `isAvailable()` is false and the announcement skips the doctor sentence.
 */
export type SpeechVoice = {
  /** True when a Russian voice is installed. Voices load asynchronously, so the first call may wait up to 1.5 s. */
  isAvailable(): Promise<boolean>;
  /**
   * Speaks `text` in Russian and resolves when it has ended, failed, was cancelled by `signal` or after 15 s.
   * Never rejects; a missing voice or a blocked speech engine simply says nothing.
   */
  speak(text: string, options?: { signal?: AbortSignal }): Promise<void>;
};

export const VOICES_WAIT_MS = 1500;
export const SPEAK_TIMEOUT_MS = 15_000;
const SPEECH_RATE = 0.9; // a little slower than default: names are heard once, in a hall

type Engine = {
  synth: SpeechSynthesis | null;
  Utterance: typeof SpeechSynthesisUtterance | null;
};

function browserEngine(): Engine {
  if (typeof window === "undefined") return { synth: null, Utterance: null };
  return {
    synth: "speechSynthesis" in window ? window.speechSynthesis : null,
    Utterance: typeof window.SpeechSynthesisUtterance === "function" ? window.SpeechSynthesisUtterance : null,
  };
}

function langOf(voice: SpeechSynthesisVoice): string {
  return voice.lang.replace("_", "-").toLowerCase();
}

/** `engine` is injectable for tests; the TV passes nothing. */
export function createSpeechVoice(engine: Engine = browserEngine()): SpeechVoice {
  const { synth, Utterance } = engine;
  // Chrome may garbage-collect an utterance that nobody references and then never fires "end".
  let speaking: SpeechSynthesisUtterance | null = null;

  const russianVoice = (): SpeechSynthesisVoice | null => {
    const voices = synth ? synth.getVoices() : [];
    return voices.find((voice) => langOf(voice) === "ru-ru") ?? voices.find((voice) => langOf(voice).startsWith("ru")) ?? null;
  };

  const voicesLoaded = (): Promise<void> =>
    new Promise((resolve) => {
      if (!synth || synth.getVoices().length > 0) {
        resolve();
        return;
      }
      const done = () => {
        clearTimeout(timer);
        synth.removeEventListener("voiceschanged", done);
        resolve();
      };
      const timer = setTimeout(done, VOICES_WAIT_MS);
      synth.addEventListener("voiceschanged", done);
    });

  const isAvailable = async (): Promise<boolean> => {
    if (!synth || !Utterance) return false;
    await voicesLoaded();
    return russianVoice() !== null;
  };

  const speak = (text: string, options?: { signal?: AbortSignal }): Promise<void> =>
    new Promise<void>((resolve) => {
      const signal = options?.signal;
      const voice = russianVoice();
      if (!synth || !Utterance || !voice || signal?.aborted) {
        resolve();
        return;
      }
      const finish = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        speaking = null;
        resolve();
      };
      const cancel = () => {
        try {
          synth.cancel();
        } catch {
          // nothing to cancel
        }
        finish();
      };
      const utterance = new Utterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = SPEECH_RATE;
      utterance.volume = 1;
      utterance.onend = finish;
      utterance.onerror = finish; // e.g. "not-allowed" when the browser wants a click first: the number was already said
      const timer = setTimeout(cancel, SPEAK_TIMEOUT_MS);
      signal?.addEventListener("abort", cancel);
      speaking = utterance;
      try {
        if (synth.speaking || synth.pending) synth.cancel(); // a stuck earlier utterance would block this one
        if (synth.paused) synth.resume();
        synth.speak(utterance);
      } catch {
        finish();
      }
    });

  return { isAvailable, speak };
}
