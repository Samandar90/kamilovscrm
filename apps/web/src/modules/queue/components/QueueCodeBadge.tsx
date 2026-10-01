import type { ReactElement } from "react";

type Props = { code: string | null | undefined };

/** Queue ticket code ("К-05") as a compact pill; renders nothing when the appointment has no number. */
export function QueueCodeBadge({ code }: Props): ReactElement | null {
  const value = code?.trim();
  if (!value) return null;
  return (
    <span className="inline-flex shrink-0 items-center rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-sky-800">
      {value}
    </span>
  );
}
