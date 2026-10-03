import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser } from "./types";

const mocks = vi.hoisted(() => ({ getMe: vi.fn() }));
vi.mock("../api/http", () => ({
  HttpError: class HttpError extends Error {
    constructor(
      message: string,
      public readonly status: number,
    ) {
      super(message);
    }
  },
}));
vi.mock("../api/authApi", () => ({ authApi: { getMe: mocks.getMe } }));
import { HttpError } from "../api/http";
import { AuthProvider, BOOTSTRAP_RETRY_DELAYS_MS, useAuth } from "./AuthContext";

const TOKEN_KEY = "crm_access_token";
const user: PublicUser = { id: 2, username: "reception", role: "reception", isActive: true, createdAt: "2026-01-01T00:00:00Z" };
/** What requestJson throws when no attempt of a read got an answer. */
const noAnswer = () => new Error("http.networkError");

const storage = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
};

let view: ReactTestRenderer | undefined;
let auth: ReturnType<typeof useAuth>;
function Probe() {
  auth = useAuth();
  return null;
}
/** Opens the app in a tab that has a token from an earlier visit. */
const openWithToken = async () => {
  localStorage.setItem(TOKEN_KEY, "stored-token");
  await act(async () => {
    view = create(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
  });
};
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.getMe.mockReset();
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("sessionStorage", storage());
});
afterEach(() => {
  if (view) act(() => view!.unmount());
  view = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AuthProvider at start", () => {
  it("signs the user in with the stored token", async () => {
    mocks.getMe.mockResolvedValue(user);
    await openWithToken();
    expect(mocks.getMe).toHaveBeenCalledWith("stored-token");
    expect(auth).toMatchObject({ isAuthenticated: true, isLoading: false, token: "stored-token", user });
  });

  it.each([401, 402, 403, 404, 500])("signs out and forgets the token when the server answers %i", async (status) => {
    mocks.getMe.mockRejectedValue(new HttpError("No", status));
    await openWithToken();
    expect(auth).toMatchObject({ isAuthenticated: false, isLoading: false, token: null });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    await advance(60_000);
    expect(mocks.getMe).toHaveBeenCalledTimes(1);
  });

  // A page that reloads while the API restarts (the automatic reload to a new version does) must not sign the
  // user out: no answer says nothing about the token.
  it("keeps the token when the API does not answer, and signs in as soon as it does", async () => {
    mocks.getMe.mockRejectedValueOnce(noAnswer()).mockRejectedValueOnce(noAnswer()).mockResolvedValue(user);
    await openWithToken();
    // The loading screen says why it is taking long (guards/ProtectedRoute, GuestRoute).
    expect(auth).toMatchObject({ isAuthenticated: false, isLoading: true, error: "http.networkError" });
    expect(localStorage.getItem(TOKEN_KEY)).toBe("stored-token");

    await advance(BOOTSTRAP_RETRY_DELAYS_MS[0] - 1);
    expect(mocks.getMe).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(mocks.getMe).toHaveBeenCalledTimes(2);
    expect(auth).toMatchObject({ isAuthenticated: false, isLoading: true });

    await advance(BOOTSTRAP_RETRY_DELAYS_MS[1]);
    expect(mocks.getMe).toHaveBeenCalledTimes(3);
    expect(auth).toMatchObject({ isAuthenticated: true, isLoading: false, token: "stored-token", user, error: null });
    expect(localStorage.getItem(TOKEN_KEY)).toBe("stored-token");
  });

  it.each([502, 503, 504])("takes a gateway answer %i for no answer", async (status) => {
    mocks.getMe.mockRejectedValueOnce(new HttpError("Bad gateway", status)).mockResolvedValue(user);
    await openWithToken();
    expect(auth).toMatchObject({ isAuthenticated: false, isLoading: true });
    expect(localStorage.getItem(TOKEN_KEY)).toBe("stored-token");
    await advance(BOOTSTRAP_RETRY_DELAYS_MS[0]);
    expect(auth).toMatchObject({ isAuthenticated: true, isLoading: false });
  });

  it("keeps saying why it waits while the next attempt is on its way", async () => {
    let answer!: (user: PublicUser) => void;
    mocks.getMe.mockRejectedValueOnce(noAnswer()).mockImplementationOnce(() => new Promise<PublicUser>((resolve) => (answer = resolve)));
    await openWithToken();
    await advance(BOOTSTRAP_RETRY_DELAYS_MS[0]);
    expect(mocks.getMe).toHaveBeenCalledTimes(2);
    expect(auth).toMatchObject({ isLoading: true, error: "http.networkError" });
    await act(async () => answer(user));
    expect(auth).toMatchObject({ isAuthenticated: true, isLoading: false, error: null });
  });

  it("goes on asking at the longest pause while the API stays silent", async () => {
    mocks.getMe.mockRejectedValue(noAnswer());
    await openWithToken();
    const longest = BOOTSTRAP_RETRY_DELAYS_MS[BOOTSTRAP_RETRY_DELAYS_MS.length - 1];
    await advance(BOOTSTRAP_RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0));
    const asked = mocks.getMe.mock.calls.length;
    expect(asked).toBe(1 + BOOTSTRAP_RETRY_DELAYS_MS.length);
    await advance(longest * 3);
    expect(mocks.getMe).toHaveBeenCalledTimes(asked + 3);
    expect(auth).toMatchObject({ isAuthenticated: false, isLoading: true });
    expect(localStorage.getItem(TOKEN_KEY)).toBe("stored-token");
  });

  it("signs out when a later answer rejects the token", async () => {
    mocks.getMe.mockRejectedValueOnce(noAnswer()).mockRejectedValue(new HttpError("Unauthorized", 401));
    await openWithToken();
    await advance(BOOTSTRAP_RETRY_DELAYS_MS[0]);
    expect(auth).toMatchObject({ isAuthenticated: false, isLoading: false, token: null });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("stops asking once the token is gone (signed out in another tab)", async () => {
    mocks.getMe.mockRejectedValue(noAnswer());
    await openWithToken();
    localStorage.removeItem(TOKEN_KEY);
    await advance(BOOTSTRAP_RETRY_DELAYS_MS[0]);
    expect(auth).toMatchObject({ isAuthenticated: false, isLoading: false, token: null });
    await advance(60_000);
    expect(mocks.getMe).toHaveBeenCalledTimes(1);
  });

  it("stops asking when the app is closed", async () => {
    mocks.getMe.mockRejectedValue(noAnswer());
    await openWithToken();
    act(() => view!.unmount());
    view = undefined;
    await advance(60_000);
    expect(mocks.getMe).toHaveBeenCalledTimes(1);
  });
});
