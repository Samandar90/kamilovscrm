import React from "react";
import { authApi } from "../api/authApi";
import { HttpError } from "../api/http";
import { clearImpersonation } from "./impersonation";
import type { PublicUser } from "./types";

const TOKEN_KEY = "crm_access_token";
const REMEMBER_KEY = "crm_remember_me";
/** Pauses before asking again who the user is, when the API gave no answer at start; the last one repeats. */
export const BOOTSTRAP_RETRY_DELAYS_MS = [2000, 5000, 10000];
/** What the gateway in front of the API answers while the API restarts. */
const GATEWAY_STATUSES = new Set([502, 503, 504]);

/** No answer at all, or the gateway answering in the API's place: neither says anything about the token. */
const isNoAnswer = (error: unknown): boolean => !(error instanceof HttpError) || GATEWAY_STATUSES.has(error.status);

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

  const mounted = React.useRef(false);
  const bootstrapRetry = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const unansweredBootstraps = React.useRef(0);

  const login = React.useCallback(async (username: string, password: string, rememberMe = false) => {
    clearTimeout(bootstrapRetry.current);
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const response = await authApi.login({ username, password });
      if (!response.accessToken || !response.user) {
        throw new Error("Invalid auth response");
      }
      // Свежий вход = новая личность: отложенный админский токен больше не актуален.
      clearImpersonation();
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
    clearTimeout(bootstrapRetry.current);
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
      clearImpersonation();
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
    clearTimeout(bootstrapRetry.current);
    const localToken = localStorage.getItem(TOKEN_KEY);
    const sessionToken = sessionStorage.getItem(TOKEN_KEY);
    const storedToken = localToken ?? sessionToken;
    if (!storedToken) {
      unansweredBootstraps.current = 0;
      setState({
        token: null,
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
      });
      return;
    }

    // While the API stays silent the reason shown on the loading screen stays too.
    setState((prev) => ({ ...prev, isLoading: true, error: unansweredBootstraps.current > 0 ? prev.error : null }));
    try {
      const user = await authApi.getMe(storedToken);
      unansweredBootstraps.current = 0;
      setState({
        token: storedToken,
        user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      if (isNoAnswer(error)) {
        // The token may be perfectly good: a page that loads while the API restarts (a tab reloading to a new
        // version does) would otherwise sign the user out. Keep the token, stay in the loading state and ask again.
        if (!mounted.current) return;
        // The loading screen shows this text, so that a long wait does not look like a frozen page.
        setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : null }));
        const delays = BOOTSTRAP_RETRY_DELAYS_MS;
        const delay = delays[Math.min(unansweredBootstraps.current, delays.length - 1)];
        unansweredBootstraps.current += 1;
        bootstrapRetry.current = setTimeout(() => void bootstrapAuth(), delay);
        return;
      }
      unansweredBootstraps.current = 0;
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
    mounted.current = true;
    void bootstrapAuth();
    return () => {
      mounted.current = false;
      clearTimeout(bootstrapRetry.current);
    };
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
