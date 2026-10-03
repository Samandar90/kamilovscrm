import React from "react";
import { useLocation } from "react-router-dom";
import { notifyPageChanged, startAppUpdateWatch } from "./appUpdate";

/**
 * Keeps an open staff tab on the deployed version (see appUpdate.ts). Renders nothing.
 * Never mounted on the TV screen: a reload in the middle of the day could leave the hall without sound.
 */
export function AppUpdateWatcher(): null {
  const { pathname } = useLocation();
  React.useEffect(() => startAppUpdateWatch(), []);

  // A move to another page, not a new filter in the query string of the same one.
  const shownPath = React.useRef(pathname);
  React.useEffect(() => {
    if (shownPath.current === pathname) return;
    shownPath.current = pathname;
    notifyPageChanged();
  }, [pathname]);

  return null;
}
