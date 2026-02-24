import { useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";

const STATE_KEY = "jarvis_app_state";

interface AppState {
  lastRoute: string;
  lastVisited: number;
}

/**
 * Persists the current route to localStorage so the app can restore it on relaunch.
 */
export function useAppStatePersistence() {
  const location = useLocation();

  useEffect(() => {
    // Don't save pair or auth routes
    if (location.pathname === "/pair" || location.pathname === "/auth") return;

    const state: AppState = {
      lastRoute: location.pathname,
      lastVisited: Date.now(),
    };
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch {}
  }, [location.pathname]);
}

/**
 * Returns the last saved route, or null if none / expired (>7 days).
 */
export function getLastRoute(): string | null {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const state: AppState = JSON.parse(raw);
    // Expire after 7 days
    if (Date.now() - state.lastVisited > 7 * 24 * 60 * 60 * 1000) return null;
    if (state.lastRoute === "/pair" || state.lastRoute === "/auth") return null;
    return state.lastRoute;
  } catch {
    return null;
  }
}
