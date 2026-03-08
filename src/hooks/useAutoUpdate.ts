/**
 * Auto-update hook for APK and web app.
 * - Checks app_releases table for new versions on startup + every 5 min
 * - Shows update prompt when new version found
 * - Auto-reloads for web/APK (Capacitor WebView loads from cloud)
 * - Tracks current version in localStorage
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Capacitor } from "@capacitor/core";

const APP_VERSION = "1.0.0"; // Bump this on each release
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const LS_KEY = "jarvis_app_version";
const LS_DISMISSED_KEY = "jarvis_update_dismissed";

interface UpdateInfo {
  version: string;
  releaseNotes: string | null;
  forceUpdate: boolean;
  downloadUrl: string | null;
}

export function useAutoUpdate() {
  const { toast } = useToast();
  const intervalRef = useRef<number | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [currentVersion] = useState(APP_VERSION);
  const isNative = Capacitor.isNativePlatform();

  const isNewer = useCallback((remote: string, local: string): boolean => {
    try {
      const r = remote.split(".").map(Number);
      const l = local.split(".").map(Number);
      while (r.length < 3) r.push(0);
      while (l.length < 3) l.push(0);
      for (let i = 0; i < 3; i++) {
        if (r[i] > l[i]) return true;
        if (r[i] < l[i]) return false;
      }
      return false;
    } catch {
      return remote !== local;
    }
  }, []);

  const checkForUpdate = useCallback(async (silent = false) => {
    setChecking(true);
    try {
      const platform = isNative ? "apk" : "web";
      const { data, error } = await supabase
        .from("app_releases")
        .select("*")
        .eq("platform", platform)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (error || !data) {
        setChecking(false);
        return null;
      }

      if (isNewer(data.version, currentVersion)) {
        const info: UpdateInfo = {
          version: data.version,
          releaseNotes: data.release_notes,
          forceUpdate: data.force_update || false,
          downloadUrl: data.download_url,
        };
        setUpdateAvailable(info);

        // Force update — auto-apply immediately
        if (info.forceUpdate) {
          applyUpdate(info);
        } else if (!silent) {
          toast({
            title: `Update Available: v${info.version}`,
            description: info.releaseNotes || "A new version is available",
          });
        }
        setChecking(false);
        return info;
      } else {
        setUpdateAvailable(null);
        if (!silent) {
          toast({ title: "Up to Date", description: `Running v${currentVersion}` });
        }
      }
    } catch (err) {
      console.debug("[AutoUpdate] Check failed:", err);
    }
    setChecking(false);
    return null;
  }, [currentVersion, isNative, isNewer, toast]);

  const applyUpdate = useCallback((info?: UpdateInfo | null) => {
    const update = info || updateAvailable;
    if (!update) return;

    toast({
      title: "Updating...",
      description: `Installing v${update.version}`,
    });

    // For APK (Capacitor WebView) and web: reload pulls latest from cloud
    // Save version so we know we updated after reload
    try {
      localStorage.setItem(LS_KEY, update.version);
      localStorage.removeItem(LS_DISMISSED_KEY);
    } catch {}

    setTimeout(() => {
      window.location.reload();
    }, 1000);
  }, [updateAvailable, toast]);

  const dismissUpdate = useCallback(() => {
    if (updateAvailable) {
      try {
        localStorage.setItem(LS_DISMISSED_KEY, updateAvailable.version);
      } catch {}
      setUpdateAvailable(null);
    }
  }, [updateAvailable]);

  // Check on mount + interval
  useEffect(() => {
    // Check if we just updated
    try {
      const savedVersion = localStorage.getItem(LS_KEY);
      if (savedVersion && savedVersion !== APP_VERSION) {
        // Version changed after reload — we updated successfully
        localStorage.setItem(LS_KEY, APP_VERSION);
        toast({
          title: "Updated Successfully! 🎉",
          description: `Now running v${APP_VERSION}`,
        });
      }
    } catch {}

    // Initial check (silent, 5s delay to not block startup)
    const startupTimer = setTimeout(() => checkForUpdate(true), 5000);

    // Periodic check
    intervalRef.current = window.setInterval(() => {
      checkForUpdate(true);
    }, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(startupTimer);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [checkForUpdate, toast]);

  return {
    currentVersion,
    updateAvailable,
    checking,
    checkForUpdate,
    applyUpdate,
    dismissUpdate,
    isNative,
  };
}
