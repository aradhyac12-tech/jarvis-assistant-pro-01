/**
 * Relay/WebSocket helpers.
 *
 * IMPORTANT:
 * - For WebSocket streaming (camera/screen/audio relays), the canonical host is the
 *   functions subdomain: wss://<projectRef>.functions.supabase.co
 * - Using the REST host (https://<projectRef>.supabase.co) can appear to work for HTTP
 *   but frequently breaks WebSocket upgrades and/or splits clients across hosts.
 */

export function getProjectRefFromBackendUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    const ref = host.split(".")[0];
    return ref || null;
  } catch {
    return null;
  }
}

export function getFunctionsWsBase(): string {
  const backendUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
  const envRef = (import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined) ?? "";
  const ref = envRef || getProjectRefFromBackendUrl(backendUrl) || "";

  if (ref) return `wss://${ref}.functions.supabase.co`;

  // Last resort fallback (dev/local). Not ideal for production streaming.
  return backendUrl.replace(/\/$/, "").replace(/^http/, "ws");
}
