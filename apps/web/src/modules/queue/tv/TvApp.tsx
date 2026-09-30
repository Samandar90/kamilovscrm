import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { TvDisplayPage } from "./TvDisplayPage";
import { TvLaunchPage } from "./TvLaunchPage";
import "./tv.css";

/**
 * Public TV app, rendered by App.tsx for /tv and /tv/* OUTSIDE AuthProvider: no staff token is ever sent and a
 * stale token in this browser can never redirect the TV to /login. Lazy-loaded, so audio code stays out of the main bundle.
 */
export function TvApp() {
  React.useEffect(() => {
    const previousTitle = document.title;
    document.title = "Navbat / Очередь";
    document.body.classList.add("qtv-body");
    return () => {
      document.title = previousTitle;
      document.body.classList.remove("qtv-body");
    };
  }, []);

  return (
    <Routes>
      <Route path="/tv" element={<TvLaunchPage />} />
      <Route path="/tv/:code" element={<TvDisplayPage />} />
      <Route path="*" element={<Navigate to="/tv" replace />} />
    </Routes>
  );
}
