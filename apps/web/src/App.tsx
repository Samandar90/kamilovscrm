import React from "react";
import { useLocation } from "react-router-dom";
import { AppRouter } from "./router/AppRouter";
import { AuthProvider } from "./auth/AuthContext";
import { isTvPath } from "./modules/queue/tv/tvPath";

// Public TV screen (/tv, /tv/:code): rendered outside AuthProvider so a stale staff token in the TV browser can never
// redirect it to /login, and lazy-loaded so its audio code stays out of the staff bundle.
const TvApp = React.lazy(() => import("./modules/queue/tv/TvApp").then((module) => ({ default: module.TvApp })));

export default function App() {
  const { pathname } = useLocation();
  if (isTvPath(pathname)) {
    return (
      <React.Suspense fallback={<div style={{ minHeight: "100vh", background: "#070b14" }} />}>
        <TvApp />
      </React.Suspense>
    );
  }
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}
