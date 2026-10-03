import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../AuthContext";

type GuestRouteProps = {
  children: React.ReactNode;
};

export const GuestRoute: React.FC<GuestRouteProps> = ({ children }) => {
  const { isAuthenticated, isLoading, error } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-slate-950 px-4 text-center text-slate-200">
        Loading...
        {/* Set while the API does not answer at start: AuthProvider keeps asking. */}
        {error ? <p className="max-w-sm text-sm text-slate-400">{error}</p> : null}
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};
