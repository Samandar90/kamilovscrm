import React from "react";

/** Reload delay after a crash; while the device reports no network the reload waits another minute. */
export const CRASH_RELOAD_MS = 60_000;
const RESTARTING_TEXT = "Экран перезагружается…";

type Props = { children: React.ReactNode };
type State = { failed: boolean };

/**
 * Last line of defence for the hall screen. A TV chunk that fails to load (flaky Wi-Fi, a deploy in progress) or a
 * render crash (malformed payload) would otherwise unmount the whole TV tree, 04:00 reload included, and leave the
 * screen black for good. Shows a short bilingual notice and reloads the page a minute later.
 * Styled inline (hex only): tv.css ships in the TV chunk, which may be the very thing that failed to load.
 */
export class TvErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false };
  private timer: number | undefined;

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(): void {
    if (this.timer === undefined) this.scheduleReload();
  }

  componentWillUnmount(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
  }

  private scheduleReload(): void {
    this.timer = window.setTimeout(() => {
      // A reload without network would leave the TV on the browser's error page, with no script left to retry.
      if (typeof navigator !== "undefined" && navigator.onLine === false) this.scheduleReload();
      else window.location.reload();
    }, CRASH_RELOAD_MS);
  }

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="status"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100vw",
          height: "100vh",
          margin: 0,
          padding: "4vw",
          boxSizing: "border-box",
          background: "#070b14",
          color: "#94a3b8",
          fontFamily: '"Inter", "Roboto", "Segoe UI", Arial, sans-serif',
          fontSize: "clamp(20px, 3.2vw, 100px)",
          fontWeight: 700,
          textAlign: "center",
        }}
      >
        {RESTARTING_TEXT}
      </div>
    );
  }
}
