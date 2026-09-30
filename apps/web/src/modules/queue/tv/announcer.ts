import { silenceBounds } from "./audioTrim";
import voiceClips from "./voiceClips.json";
import { gapBeforeClipMs, type VoiceLang } from "./voicePhrases";

export type Announcer = {
  /** Call from a click/keydown handler (autoplay policy). Resolves true when audio can play. */
  unlock(): Promise<boolean>;
  isUnlocked(): boolean;
  /**
   * Chime, then clipGroups[i] spoken in langs[i]; resolves when playback has ended. Never rejects on missing clips.
   * Once `signal` is aborted no speech is scheduled any more (an already aborted signal plays nothing at all).
   */
  announce(clipGroups: string[][], langs: VoiceLang[], options?: { signal?: AbortSignal }): Promise<void>;
  /**
   * Downloads, decodes and trims every clip of `langs` in the background, one at a time; failures are ignored (and
   * retried by the next announcement). Never rejects. Announcements never wait for it: they fetch what they need.
   */
  preload(langs: VoiceLang[]): Promise<void>;
};

type AudioContextConstructor = new () => AudioContext;

/** Every clip id per language (the texts Task 13 voices); the JSON's literal keys are widened for indexing. */
const CLIP_IDS: Record<VoiceLang, string[]> = {
  uz: Object.keys((voiceClips as Record<VoiceLang, Record<string, string>>).uz),
  ru: Object.keys((voiceClips as Record<VoiceLang, Record<string, string>>).ru),
};

const CHIME_TONES_HZ = [659.25, 523.25]; // E5 then C5: "ding-dong"
const CHIME_STEP_S = 0.35;
const CHIME_TONE_S = 0.9;
const START_DELAY_S = 0.05;
const AFTER_CHIME_S = 0.25;
const LANGUAGE_GAP_S = 0.7;
const TRIM_PAD_S = 0.015;
const RESUME_WAIT_MS = 400;
/** A clip download (or decode) taking longer than this is given up, so one stalled socket cannot mute every call. */
export const CLIP_TIMEOUT_MS = 8000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, ms));
  });
}

function isRunning(audio: AudioContext): boolean {
  return audio.state === "running";
}

function decodeAudio(audio: AudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    // The callback form works on every engine; newer engines also return a promise, which is caught so that
    // an undecodable file never surfaces as an unhandled rejection.
    const maybePromise = audio.decodeAudioData(bytes, resolve, reject) as Promise<AudioBuffer> | undefined;
    if (maybePromise && typeof maybePromise.catch === "function") maybePromise.catch(reject);
  });
}

function trimSilence(audio: AudioContext, buffer: AudioBuffer): AudioBuffer {
  const [start, end] = silenceBounds(buffer.getChannelData(0));
  if (end <= start) return buffer;
  const pad = Math.round(buffer.sampleRate * TRIM_PAD_S);
  const from = Math.max(0, start - pad);
  const to = Math.min(buffer.length, end + pad);
  if (from === 0 && to === buffer.length) return buffer;
  const trimmed = audio.createBuffer(buffer.numberOfChannels, to - from, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    trimmed.getChannelData(channel).set(buffer.getChannelData(channel).subarray(from, to));
  }
  return trimmed;
}

function playSilence(audio: AudioContext): void {
  // Starting a 1-sample silent buffer inside the user gesture fully unlocks older WebKit-based TV engines.
  const source = audio.createBufferSource();
  source.buffer = audio.createBuffer(1, 1, audio.sampleRate);
  source.connect(audio.destination);
  source.start(0);
}

/** Schedules the synthesized chime at `at` (context time) and returns the time it ends. */
function scheduleChime(audio: AudioContext, at: number): number {
  CHIME_TONES_HZ.forEach((frequency, index) => {
    const start = at + index * CHIME_STEP_S;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.35, start + 0.01);
    // An exponential ramp cannot reach 0: fade to 0.001 (about −60 dB) instead.
    gain.gain.exponentialRampToValueAtTime(0.001, start + CHIME_TONE_S);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + CHIME_TONE_S + 0.05);
  });
  return at + (CHIME_TONES_HZ.length - 1) * CHIME_STEP_S + CHIME_TONE_S;
}

/**
 * Web Audio announcer: a synthesized chime plus pre-recorded clips `${baseUrl}/<lang>/<id>.mp3` played back to back
 * (60 ms between words, 300 ms before a new sentence, 700 ms between languages). Clips are fetched once, decoded,
 * trimmed of edge silence and cached; `preload()` warms that cache in the background. A language with any missing clip is
 * skipped, so without clips only the chime plays.
 */
export function createAnnouncer(baseUrl = "/queue-voice"): Announcer {
  let ctx: AudioContext | null = null;
  const clips = new Map<string, Promise<AudioBuffer | null>>();

  const context = (): AudioContext | null => {
    if (ctx) return ctx;
    if (typeof window === "undefined") return null;
    const w = window as unknown as { AudioContext?: AudioContextConstructor; webkitAudioContext?: AudioContextConstructor };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      ctx = null;
    }
    return ctx;
  };

  const loadClip = (audio: AudioContext, lang: VoiceLang, id: string): Promise<AudioBuffer | null> => {
    const key = `${lang}/${id}`;
    const cached = clips.get(key);
    if (cached) return cached;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const download = (async (): Promise<AudioBuffer | null> => {
      try {
        const response = await fetch(
          `${baseUrl}/${lang}/${encodeURIComponent(id)}.mp3`,
          controller ? { signal: controller.signal } : undefined,
        );
        if (!response.ok) return null;
        const bytes = await response.arrayBuffer();
        // decodeAudioData detaches (empties) the ArrayBuffer it receives: always hand it a copy.
        return trimSilence(audio, await decodeAudio(audio, bytes.slice(0)));
      } catch {
        // Network error, abort, or a missing file: the SPA fallback answers with index.html, which fails to decode.
        return null;
      }
    })();
    // Race against a timer as well as aborting: the timeout must hold even if the engine ignores the signal.
    let timer: number | undefined;
    const timedOut = new Promise<null>((resolve) => {
      timer = window.setTimeout(() => {
        controller?.abort();
        resolve(null);
      }, CLIP_TIMEOUT_MS);
    });
    const loading = Promise.race([download, timedOut]).then((buffer) => {
      window.clearTimeout(timer);
      return buffer;
    });
    clips.set(key, loading);
    void loading.then((buffer) => {
      if (!buffer) clips.delete(key); // retry on the next announcement
    });
    return loading;
  };

  const unlock = async (): Promise<boolean> => {
    const audio = context();
    if (!audio) return false;
    if (isRunning(audio)) return true;
    let resumed: Promise<void>;
    try {
      // Both calls must happen synchronously inside the click/keydown handler.
      resumed = Promise.resolve(audio.resume());
      playSilence(audio);
    } catch {
      return false;
    }
    // Without a user gesture Chrome keeps the resume() promise pending forever: never await it unbounded.
    await Promise.race([resumed.catch(() => undefined), wait(RESUME_WAIT_MS)]);
    return isRunning(audio);
  };

  const announce = async (clipGroups: string[][], langs: VoiceLang[], options?: { signal?: AbortSignal }): Promise<void> => {
    const audio = ctx;
    const signal = options?.signal;
    if (!audio || !isRunning(audio) || signal?.aborted) return;
    // Start downloading the speech now, so it loads while the chime plays.
    const phrases = langs.map(async (lang, index) => {
      const ids = clipGroups[index] ?? [];
      if (ids.length === 0) return null;
      const buffers = await Promise.all(ids.map((id) => loadClip(audio, lang, id)));
      if (buffers.some((buffer) => buffer === null)) return null;
      return ids.map((id, k) => ({ id, buffer: buffers[k] as AudioBuffer }));
    });
    const chimeEnd = scheduleChime(audio, audio.currentTime + START_DELAY_S);
    const loaded = await Promise.all(phrases);
    // The caller gave up on this call (its overlay has ended): speaking now would talk over the next call.
    if (signal?.aborted) return;
    let at =Math.max(chimeEnd + AFTER_CHIME_S, audio.currentTime + START_DELAY_S);
    let end = chimeEnd;
    let spokenBefore = false;
    for (const phrase of loaded) {
      if (!phrase) continue;
      if (spokenBefore) at += LANGUAGE_GAP_S;
      phrase.forEach(({ id, buffer }, k) => {
        if (k > 0) at += gapBeforeClipMs(id) / 1000;
        const source = audio.createBufferSource();
        source.buffer = buffer;
        source.connect(audio.destination);
        source.start(at);
        at += buffer.duration;
      });
      spokenBefore = true;
      end = at;
    }
    await wait((end - audio.currentTime) * 1000 + 50);
  };

  const preload = async (langs: VoiceLang[]): Promise<void> => {
    // Decoding also works on a context that is still suspended; without Web Audio there is nothing to prepare.
    const audio = context();
    if (!audio) return;
    for (const lang of langs) {
      for (const id of CLIP_IDS[lang] ?? []) {
        // One at a time, so a TV on a slow line keeps bandwidth for its 2-second polls. loadClip never rejects and
        // shares the cache with announce(), so a clip that is already loading is not downloaded twice.
        await loadClip(audio, lang, id);
      }
    }
  };

  return {
    unlock,
    isUnlocked: () => ctx !== null && isRunning(ctx),
    announce,
    preload,
  };
}
