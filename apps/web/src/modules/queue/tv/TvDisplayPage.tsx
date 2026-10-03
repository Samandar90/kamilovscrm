import React from "react";
import { useParams } from "react-router-dom";
import type { QueueDisplayCabinet, QueueDisplayCall, QueueDisplayLanguage, QueueDisplayState } from "../api/queueTypes";
import { createAnnouncer, type Announcer } from "./announcer";
import { createCallTracker } from "./callTracker";
import { normalizeCodeInput } from "./codeInput";
import { readStartedFlag, requestFullscreen, requestWakeLock, writeStartedFlag, type WakeLockHandle } from "./tvDevice";
import { TV_LABELS, tvLabel } from "./tvLabels";
import { CABINETS_PER_PAGE, gridColumns, pageCabinets, waitingRowsShown } from "./tvLayout";
import { formatClock, formatDay, msUntilDailyReload } from "./tvTime";
import { useQueueDisplay } from "./useQueueDisplay";
import { announcementClipIds, voiceLangs } from "./voicePhrases";

export const CALL_OVERLAY_MS = 10_000;
export const PAGE_ROTATE_MS = 10_000;
const SPEECH_TIMEOUT_MS = 20_000;
const RELOAD_RETRY_MS = 5 * 60_000;
const RECENT_CALLS_SHOWN = 5;

/** Resolves when `promise` settles or after `ms`, whichever comes first; never rejects. */
function settleWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    const done = () => {
      window.clearTimeout(timer);
      resolve();
    };
    promise.then(done, done);
  });
}

/**
 * Chime + voice for one call; voice follows the display settings. Never rejects, never hangs longer than 20 s.
 * When it gives up (or the caller aborts `speech`), the announcement is cancelled, so a late one never talks over
 * the next call.
 */
function speakCall(
  announcer: Announcer,
  display: QueueDisplayState["display"],
  call: QueueDisplayCall,
  speech: AbortController | null,
): Promise<void> {
  const langs = display.voiceEnabled ? voiceLangs() : [];
  const groups = langs.map((lang) => announcementClipIds(lang, call.number, call.room));
  const signal = speech ? speech.signal : undefined;
  const run = async () => {
    // After the start button, unlock() only re-resumes a context the browser suspended; without audio → silence.
    if (!announcer.isUnlocked() && !(await announcer.unlock())) return;
    await announcer.announce(groups, langs, { signal });
  };
  return settleWithin(run(), SPEECH_TIMEOUT_MS).then(() => speech?.abort());
}

function TvClock({ skewMs, timeZone }: { skewMs: number; timeZone: string }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const serverNow = now + skewMs;
  return (
    <div className="qtv-clock">
      <div className="qtv-clock-time">{formatClock(serverNow, timeZone)}</div>
      <div className="qtv-clock-day">{formatDay(serverNow, timeZone)}</div>
    </div>
  );
}

function CabinetCard({
  cabinet,
  language,
  maxWaiting,
}: {
  cabinet: QueueDisplayCabinet;
  language: QueueDisplayLanguage;
  maxWaiting: number;
}) {
  const current = cabinet.current;
  const waiting = cabinet.waiting.slice(0, maxWaiting);
  const more = cabinet.waitingCount - waiting.length;
  return (
    <section className="qtv-card">
      <div className="qtv-card-head">
        <div className="qtv-room">
          <span className="qtv-room-label">{tvLabel("cabinet", language)}</span>
          <span className="qtv-room-number">{cabinet.room ?? "—"}</span>
        </div>
        <div className="qtv-doctor">
          <div className="qtv-doctor-name">{cabinet.doctorName}</div>
          {cabinet.specialty ? <div className="qtv-doctor-specialty">{cabinet.specialty}</div> : null}
        </div>
      </div>
      <div className="qtv-card-body">
        {current ? (
          <div className={current.state === "serving" ? "qtv-current qtv-current-serving" : "qtv-current qtv-current-called"}>
            <div className="qtv-current-label">{tvLabel(current.state === "serving" ? "serving" : "called", language)}</div>
            {current.code ? <div className="qtv-current-code">{current.code}</div> : null}
            {current.name ? <div className="qtv-current-name">{current.name}</div> : null}
          </div>
        ) : (
          <div className="qtv-current qtv-current-free">
            <div className="qtv-current-label">{tvLabel("free", language)}</div>
          </div>
        )}
        <div className="qtv-next">
          <div className="qtv-next-head">
            <span className="qtv-next-label">{tvLabel("next", language)}</span>
            {more > 0 ? <span className="qtv-next-more">{`+${more}`}</span> : null}
          </div>
          {waiting.length === 0 ? (
            <span className="qtv-next-empty">{tvLabel("noQueue", language)}</span>
          ) : (
            <div className="qtv-next-list">
              {waiting.map((entry) => (
                <div key={entry.code} className="qtv-next-row">
                  <span className="qtv-next-code">{entry.code}</span>
                  {entry.name ? <span className="qtv-next-name">{entry.name}</span> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CallOverlay({ call, language }: { call: QueueDisplayCall; language: QueueDisplayLanguage }) {
  const target = call.room ? `${tvLabel("cabinet", language)} ${call.room}` : call.doctorName;
  return (
    <div className="qtv-overlay" role="alert">
      <div className="qtv-overlay-card">
        <div className="qtv-overlay-label">{tvLabel("invitation", language)}</div>
        <div className="qtv-overlay-code">{call.code}</div>
        {call.name ? <div className="qtv-overlay-name">{call.name}</div> : null}
        <div className="qtv-overlay-room">{`→ ${target}`}</div>
      </div>
    </div>
  );
}

/** Full-screen notice; the display language is unknown here, so Uzbek and Russian are shown on separate lines. */
function FullMessage({ labelKey }: { labelKey: "notFound" | "inactive" }) {
  return (
    <div className="qtv-root qtv-message">
      <p className="qtv-message-text">{TV_LABELS[labelKey].uz}</p>
      <p className="qtv-message-text">{TV_LABELS[labelKey].ru}</p>
    </div>
  );
}

/** /tv/:code — public hall screen: cabinets, current and next patients, call overlay with chime and voice. */
export function TvDisplayPage() {
  const params = useParams<{ code: string }>();
  const code = normalizeCodeInput(params.code ?? "");
  const { state, error, offline } = useQueueDisplay(code);

  const announcerRef = React.useRef<Announcer | null>(null);
  if (announcerRef.current === null) announcerRef.current = createAnnouncer();
  const trackerRef = React.useRef<ReturnType<typeof createCallTracker> | null>(null);
  if (trackerRef.current === null) trackerRef.current = createCallTracker();

  const [started, setStarted] = React.useState(false);
  const startedRef = React.useRef(started);
  startedRef.current = started;
  const [calls, setCalls] = React.useState<QueueDisplayCall[]>([]);
  const [pageIndex, setPageIndex] = React.useState(0);

  const serverMs = state ? Date.parse(state.serverTime) : Number.NaN;
  const skewMs = React.useMemo(() => (Number.isNaN(serverMs) ? 0 : serverMs - Date.now()), [serverMs]);
  const skewRef = React.useRef(skewMs);
  skewRef.current = skewMs;
  const displayRef = React.useRef<QueueDisplayState["display"] | null>(null);
  displayRef.current = state?.display ?? null;

  // A screen that was started before (flag in localStorage) tries to unlock audio silently after a reload
  // (e.g. the nightly 04:00 one). Chrome allows it after an earlier gesture on this site; if not, the button stays.
  React.useEffect(() => {
    if (!readStartedFlag()) return;
    let alive = true;
    void announcerRef.current?.unlock().then((unlocked) => {
      if (alive && unlocked) setStarted(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const start = React.useCallback(() => {
    requestFullscreen(); // first: it needs the click's transient user activation
    void announcerRef.current?.unlock(); // resume() runs synchronously inside the gesture
    writeStartedFlag();
    setStarted(true);
  }, []);

  // The remote's OK key works even if the button lost focus.
  React.useEffect(() => {
    if (started || typeof window.addEventListener !== "function") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.keyCode === 13) {
        event.preventDefault();
        start();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [started, start]);

  // Keep the TV awake; the browser drops the lock whenever the page is hidden, so take it again when visible.
  React.useEffect(() => {
    if (!started) return;
    let active = true;
    let lock: WakeLockHandle | null = null;
    const acquire = () => {
      void requestWakeLock().then((handle) => {
        if (active) lock = handle;
        else void handle?.release().catch(() => undefined);
      });
    };
    acquire();
    const canListen = typeof document !== "undefined" && typeof document.addEventListener === "function";
    const onVisibility = () => {
      if (document.visibilityState === "visible") acquire();
    };
    if (canListen) document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      if (canListen) document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release().catch(() => undefined);
    };
  }, [started]);

  // Decode all voice clips in the background once audio is unlocked, so the first calls of the day do not wait for
  // downloads. Voice off → nothing to preload. announce() never waits for it.
  const voiceEnabled = state ? state.display.voiceEnabled : false;
  React.useEffect(() => {
    if (!started || !voiceEnabled) return;
    void announcerRef.current?.preload(voiceLangs());
  }, [started, voiceEnabled]);

  // New calls → overlay queue (the tracker keeps the first poll silent and drops stale calls).
  React.useEffect(() => {
    if (!state || !trackerRef.current) return;
    const fresh = trackerRef.current.ingest(state);
    if (fresh.length > 0) setCalls((queue) => [...queue, ...fresh]);
  }, [state]);

  // One overlay at a time: at least 10 s, and until its announcement has finished.
  const activeCall = calls[0] ?? null;
  const activeKey = activeCall ? activeCall.key : null;
  React.useEffect(() => {
    if (!activeCall) return;
    let finished = false;
    let timer: number | undefined;
    const shown = new Promise<void>((resolve) => {
      timer = window.setTimeout(resolve, CALL_OVERLAY_MS);
    });
    const announcer = announcerRef.current;
    const display = displayRef.current;
    const speech = typeof AbortController === "function" ? new AbortController() : null;
    const spoken =
      startedRef.current && announcer && display ? speakCall(announcer, display, activeCall, speech) : Promise.resolve();
    void Promise.all([shown, spoken]).then(() => {
      if (!finished) setCalls((queue) => queue.slice(1));
    });
    return () => {
      finished = true;
      if (timer !== undefined) window.clearTimeout(timer);
      speech?.abort();
    };
    // Re-run only when the call at the head of the queue changes, not on every poll.
  }, [activeKey]);

  const cabinets = state ? state.cabinets : [];
  const { page, pageCount } = pageCabinets(cabinets, pageIndex);
  React.useEffect(() => {
    if (pageCount <= 1) return;
    const id = window.setInterval(() => setPageIndex((index) => index + 1), PAGE_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [pageCount]);

  // Nightly reload at 04:00 clinic time: picks up new app versions and frees memory on long-running TV browsers.
  // Never while offline: a reload without network leaves the TV on the browser's error page for good.
  const timeZone = state ? state.timeZone : null;
  const offlineRef = React.useRef(offline);
  offlineRef.current = offline;
  React.useEffect(() => {
    if (!timeZone) return;
    let id: number | undefined;
    const fire = () => {
      if (offlineRef.current) id = window.setTimeout(fire, RELOAD_RETRY_MS);
      else window.location.reload();
    };
    id = window.setTimeout(fire, msUntilDailyReload(Date.now() + skewRef.current, timeZone));
    return () => {
      if (id !== undefined) window.clearTimeout(id);
    };
  }, [timeZone]);

  if (error === "not_found") return <FullMessage labelKey="notFound" />;
  if (error === "inactive") return <FullMessage labelKey="inactive" />;

  const language: QueueDisplayLanguage = state ? state.display.language : "uz_ru";
  const shownCount = Math.min(cabinets.length, CABINETS_PER_PAGE);
  const columns = gridColumns(shownCount);
  const rows = Math.max(1, Math.ceil(shownCount / columns));
  const recent = state ? state.recentCalls.slice(0, RECENT_CALLS_SHOWN) : [];

  return (
    <div className="qtv-root qtv-display">
      <header className="qtv-header">
        <div className="qtv-clinic">{state ? state.clinicName : ""}</div>
        <div className="qtv-title">{tvLabel("queueTitle", language)}</div>
        {state ? <TvClock skewMs={skewMs} timeZone={state.timeZone} /> : <div className="qtv-clock" />}
      </header>
      <main className="qtv-main">
        {!state ? null : cabinets.length === 0 ? (
          <div className="qtv-empty">{tvLabel("noQueueYet", language)}</div>
        ) : (
          <div
            className={`qtv-grid qtv-cols-${columns}`}
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
          >
            {page.map((cabinet) => (
              <CabinetCard key={cabinet.doctorId} cabinet={cabinet} language={language} maxWaiting={waitingRowsShown(rows)} />
            ))}
          </div>
        )}
        {pageCount > 1 ? <div className="qtv-pages">{`${(pageIndex % pageCount) + 1} / ${pageCount}`}</div> : null}
      </main>
      <footer className="qtv-footer">
        <span className="qtv-footer-label">{tvLabel("recentCalls", language)}</span>
        <span className="qtv-footer-list">
          {recent.map((call) => (
            <span key={call.key} className="qtv-recent">
              <span className="qtv-recent-code">{call.code}</span>
              <span className="qtv-recent-room">{`→ ${call.room ?? call.doctorName}`}</span>
            </span>
          ))}
        </span>
        {state?.display.voiceEnabled ? <span className="qtv-footer-note">{tvLabel("voiceNote", language)}</span> : null}
      </footer>
      {offline ? (
        <div className="qtv-offline" role="status">
          {tvLabel("offline", language)}
        </div>
      ) : null}
      {activeCall ? <CallOverlay call={activeCall} language={language} /> : null}
      {!started ? (
        <div className="qtv-gate">
          <button id="qtv-start" type="button" className="qtv-start-button" autoFocus onClick={start}>
            {tvLabel("startButton", language)}
          </button>
          <p className="qtv-gate-hint">{tvLabel("startHint", language)}</p>
        </div>
      ) : null}
    </div>
  );
}
