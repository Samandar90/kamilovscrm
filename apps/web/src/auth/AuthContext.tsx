import React from "react";
import { authApi } from "../api/authApi";
import type { PublicUser } from "./types";

const TOKEN_KEY = "crm_access_token";
const REMEMBER_KEY = "crm_remember_me";

type AuthState = {
  token: string | null;
  user: PublicUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
};

type AuthContextValue = AuthState & {
  login: (username: string, password: string, rememberMe?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  bootstrapAuth: () => Promise<void>;
  clearError: () => void;
};

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

const normalizeAuthError = (error: unknown, t?: (key: string) => string): string => {
  const message = error instanceof Error ? error.message : (t?.("authContext.loginError") ?? "Unknown error");
  const normalized = message.toLowerCase();
  if (
    normalized.includes("invalid credentials") ||
    normalized.includes("invalid username or password") ||
    normalized.includes("password")
  ) {
    return t?.("authContext.invalidCredentials") ?? "Invalid credentials";
  }
  if (normalized.includes("full_name") || normalized.includes("column")) {
    return t?.("authContext.authError") ?? "Authorization error";
  }
  if (normalized.includes("inactive")) {
    return t?.("authContext.userDisabled") ?? "User disabled";
  }
  if (normalized.includes("too many login attempts")) {
    return t?.("authContext.tooManyAttempts") ?? "Too many attempts";
  }
  return t?.("authContext.loginFailed") ?? "Login failed";
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [state, setState] = React.useState<AuthState>({
    token: null,
    user: null,
    isAuthenticated: false,
    isLoading: true,
    error: null,
  });

  const clearError = React.useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  const login = React.useCallback(async (username: string, password: string, rememberMe = false) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const response = await authApi.login({ username, password });
      if (!response.accessToken || !response.user) {
        throw new Error("Invalid auth response");
      }
      if (rememberMe) {
        localStorage.setItem(TOKEN_KEY, response.accessToken);
        sessionStorage.removeItem(TOKEN_KEY);
      } else {
        sessionStorage.setItem(TOKEN_KEY, response.accessToken);
        localStorage.removeItem(TOKEN_KEY);
      }
      localStorage.setItem(REMEMBER_KEY, rememberMe ? "1" : "0");
      setState({
        token: response.accessToken,
        user: response.user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        isAuthenticated: false,
        token: null,
        user: null,
        error: normalizeAuthError(error),
      }));
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
    }
  }, []);

  const logout = React.useCallback(async () => {
    const currentToken = state.token;
    try {
      if (currentToken) {
        await authApi.logout(currentToken);
      }
    } catch (_error) {
      // best effort logout in stateless JWT mode
    } finally {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REMEMBER_KEY);
      setState({
        token: null,
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
      });
    }
  }, [state.token]);

  const bootstrapAuth = React.useCallback(async () => {
    const localToken = localStorage.getItem(TOKEN_KEY);
    const sessionToken = sessionStorage.getItem(TOKEN_KEY);
    const storedToken = localToken ?? sessionToken;
    if (!storedToken) {
      setState({
        token: null,
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
      });
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const user = await authApi.getMe(storedToken);
      setState({
        token: storedToken,
        user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (_error) {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      setState({
        token: null,
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
      });
    }
  }, []);

  React.useEffect(() => {
    void bootstrapAuth();
  }, [bootstrapAuth]);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      ...state,
      login,
      logout,
      bootstrapAuth,
      clearError,
    }),
    [state, login, logout, bootstrapAuth, clearError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
};
