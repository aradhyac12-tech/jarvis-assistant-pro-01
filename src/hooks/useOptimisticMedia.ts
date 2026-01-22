import { useState, useCallback, useRef, useEffect } from "react";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";

export interface MediaState {
  title: string;
  artist: string;
  isPlaying: boolean;
  position: number;
  positionMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
}

const DEFAULT_STATE: MediaState = {
  title: "No media playing",
  artist: "Play something on your PC",
  isPlaying: false,
  position: 0,
  positionMs: 0,
  durationMs: 0,
  volume: 80,
  muted: false,
};

export function useOptimisticMedia() {
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();
  
  const [mediaState, setMediaState] = useState<MediaState>(DEFAULT_STATE);
  const [isFetching, setIsFetching] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  
  // Track optimistic updates to revert on failure
  const optimisticRef = useRef<Partial<MediaState> | null>(null);

  // Format milliseconds to mm:ss
  const formatTime = useCallback((ms: number) => {
    if (!ms || ms <= 0) return "0:00";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }, []);

  // Fetch current media state from PC
  const fetchMediaState = useCallback(async (silent = false) => {
    if (!selectedDevice?.is_online || isFetching) return;
    
    if (!silent) setIsFetching(true);
    try {
      const result = await sendCommand("get_media_state", {}, { awaitResult: true, timeoutMs: 4000 });
      if (result?.success && 'result' in result && result.result) {
        const state = result.result as Record<string, unknown>;
        if (state.success) {
          setMediaState({
            title: (state.title as string) || "No media playing",
            artist: (state.artist as string) || "Unknown artist",
            isPlaying: (state.is_playing as boolean) ?? false,
            position: (state.position_percent as number) ?? 0,
            positionMs: (state.position_ms as number) ?? 0,
            durationMs: (state.duration_ms as number) ?? 0,
            volume: (state.volume as number) ?? 80,
            muted: (state.muted as boolean) ?? false,
          });
          optimisticRef.current = null;
        }
      }
    } catch (error) {
      console.error("Failed to fetch media state:", error);
      // Revert optimistic update on failure
      if (optimisticRef.current) {
        setMediaState(prev => ({
          ...prev,
          ...Object.fromEntries(
            Object.entries(optimisticRef.current || {}).map(([k, v]) => [k, !v])
          )
        }));
        optimisticRef.current = null;
      }
    } finally {
      if (!silent) setIsFetching(false);
    }
  }, [selectedDevice, sendCommand, isFetching]);

  // Initial fetch when device comes online
  useEffect(() => {
    if (selectedDevice?.is_online) {
      fetchMediaState();
    }
  }, [selectedDevice?.is_online]);

  // OPTIMISTIC: Play/Pause - update UI instantly
  const handlePlayPause = useCallback(async () => {
    const newState = !mediaState.isPlaying;
    
    // Optimistic update
    optimisticRef.current = { isPlaying: mediaState.isPlaying };
    setMediaState(prev => ({ ...prev, isPlaying: newState }));
    setPendingAction("play_pause");
    
    // Send command (no await for instant feel)
    sendCommand("media_control", { action: "play_pause" }).then(() => {
      setPendingAction(null);
      // Sync with actual state after a short delay
      setTimeout(() => fetchMediaState(true), 500);
    }).catch(() => {
      // Revert on error
      setMediaState(prev => ({ ...prev, isPlaying: !newState }));
      setPendingAction(null);
    });
  }, [mediaState.isPlaying, sendCommand, fetchMediaState]);

  // OPTIMISTIC: Next track
  const handleNext = useCallback(async () => {
    setPendingAction("next");
    setMediaState(prev => ({ ...prev, title: "Loading...", artist: "Skipping to next..." }));
    
    await sendCommand("media_control", { action: "next" });
    setPendingAction(null);
    setTimeout(() => fetchMediaState(true), 800);
  }, [sendCommand, fetchMediaState]);

  // OPTIMISTIC: Previous track
  const handlePrevious = useCallback(async () => {
    setPendingAction("previous");
    setMediaState(prev => ({ ...prev, title: "Loading...", artist: "Going back..." }));
    
    await sendCommand("media_control", { action: "previous" });
    setPendingAction(null);
    setTimeout(() => fetchMediaState(true), 800);
  }, [sendCommand, fetchMediaState]);

  // OPTIMISTIC: Volume change - instant update
  const handleVolumeChange = useCallback((newVolume: number) => {
    setMediaState(prev => ({ ...prev, volume: newVolume, muted: false }));
  }, []);

  const handleVolumeCommit = useCallback(async (newVolume: number) => {
    setPendingAction("volume");
    await sendCommand("set_volume", { level: newVolume });
    setPendingAction(null);
  }, [sendCommand]);

  // OPTIMISTIC: Mute toggle
  const handleMuteToggle = useCallback(async () => {
    const newMuted = !mediaState.muted;
    setMediaState(prev => ({ ...prev, muted: newMuted }));
    setPendingAction("mute");
    
    await sendCommand("media_control", { action: "mute" });
    setPendingAction(null);
  }, [mediaState.muted, sendCommand]);

  // OPTIMISTIC: Seek
  const handleSeek = useCallback(async (percent: number) => {
    const newPositionMs = (percent / 100) * mediaState.durationMs;
    setMediaState(prev => ({ ...prev, position: percent, positionMs: newPositionMs }));
    setPendingAction("seek");
    
    await sendCommand("media_seek", { position_percent: percent });
    setPendingAction(null);
    setTimeout(() => fetchMediaState(true), 300);
  }, [mediaState.durationMs, sendCommand, fetchMediaState]);

  return {
    mediaState,
    isFetching,
    pendingAction,
    formatTime,
    fetchMediaState,
    handlePlayPause,
    handleNext,
    handlePrevious,
    handleVolumeChange,
    handleVolumeCommit,
    handleMuteToggle,
    handleSeek,
  };
}
