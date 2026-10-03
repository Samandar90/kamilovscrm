import React from "react";
import { useTranslation } from "react-i18next";
import { PageLoader } from "../../shared/ui/PageLoader";
import { Button } from "../../ui/Button";
import { recoverFromMissingChunk } from "./appUpdate";

/** The chunk of a lazily loaded page could not be fetched or run. */
export class ChunkLoadError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(`Page chunk failed to load: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ChunkLoadError";
    this.cause = cause;
  }
}

/**
 * React.lazy for a page of the staff app. Whatever makes the import fail (each browser words it differently) reaches
 * LazyPageBoundary as a ChunkLoadError.
 */
export function lazyPage<T extends React.ComponentType<any>>(load: () => Promise<{ default: T }>): React.LazyExoticComponent<T> {
  return React.lazy(() =>
    load().catch((cause: unknown) => {
      throw new ChunkLoadError(cause);
    }),
  );
}

function PageLoadFailed() {
  const { t } = useTranslation();
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center text-sm text-slate-600">
      <p>{t("appUpdate.pageLoadFailed")}</p>
      <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
        {t("common.actions.refresh")}
      </Button>
    </div>
  );
}

type Props = { children: React.ReactNode };
type State = { error: unknown; reloading: boolean };

/**
 * Goes around every lazyPage in the router. A tab opened before a deploy asks for a chunk that no longer exists;
 * without this boundary React would unmount the whole app and leave a blank screen. The tab reloads to the deployed
 * version, or, when a reload is not going to help, shows a notice with a button. Other errors pass through untouched.
 */
export class LazyPageBoundary extends React.Component<Props, State> {
  state: State = { error: null, reloading: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error };
  }

  componentDidCatch(error: unknown): void {
    if (error instanceof ChunkLoadError) this.setState({ reloading: recoverFromMissingChunk() });
  }

  render(): React.ReactNode {
    const { error, reloading } = this.state;
    if (error === null) return this.props.children;
    if (!(error instanceof ChunkLoadError)) throw error;
    return reloading ? <PageLoader /> : <PageLoadFailed />;
  }
}
