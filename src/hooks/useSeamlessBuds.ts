import { useState, useEffect, useCallback, useRef } from "react";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { getFunctionsWsBase } from "@/lib/relay";

const GALAXY_BUDS_PATTERNS = [
  "galaxy buds", "buds pro", "buds live", "buds2", "buds fe",
  "buds+", "buds3", "samsung buds", "sm-r",
];

export function isGalaxyBuds(name: string): boolean {
  const lower = name.toLowerCase();
  return GALAXY_BUDS_PATTERNS.some((p) => lower.includes(p));
}

export interface PcAudioDevice {
  id: string;
  name: string;
  isDefault: boolean;
  isBluetooth: boolean;
}

export type BudsLocation = "phone" | "pc" | "both" | "none";
export type AudioRoute = "direct" | "streaming" | "idle";

export interface SeamlessBudsState {
  // Detection
  phoneBudsDetected: boolean;
  phoneBudsName: string | null;
  pcBudsDetected: boolean;
  pcBudsName: string | null;
  pcBudsIsDefault: boolean;
  budsLocation: BudsLocation;

  // Audio streaming
  audioRoute: AudioRoute;
  isStreaming: boolean;
  streamLatency: number;

  // PC devices
  pcDevices: PcAudioDevice[];
  currentPcDefault: string | null;

  // Meta
  isPolling: boolean;
  lastPollTime: number;
}

const INITIAL_STATE: SeamlessBudsState = {
  phoneBudsDetected: false,
  phoneBudsName: null,
  pcBudsDetected: false,
  pcBudsName: null,
  pcBudsIsDefault: false,
  budsLocation: "none",
  audioRoute: "idle",
  isStreaming: false,
  streamLatency: 0,
  pcDevices: [],
  currentPcDefault: null,
  isPolling: false,
  lastPollTime: 0,
};

export function useSeamlessBuds() {
  const { sendCommand } = useDeviceCommands();
  const { session } = useDeviceSession();
  const [state, setState] = useState<SeamlessBudsState>(INITIAL_STATE);
  const [autoSwitch, setAutoSwitch] = useState(() =>
    localStorage.getItem("buds-auto-switch") === "true"
  );
  const [fallbackDeviceId, setFallbackDeviceId] = useState<string | null>(() =>
    localStorage.getItem("buds-fallback-device")
  );

  const audioCtxRef = useRef<AudioContext | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioSessionIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const prevBudsLocationRef = useRef<BudsLocation>("none");

  // Persist settings
  useEffect(() => {
    localStorage.setItem("buds-auto-switch", String(autoSwitch));
  }, [autoSwitch]);
  useEffect(() => {
    if (fallbackDeviceId) localStorage.setItem("buds-fallback-device", fallbackDeviceId);
  }, [fallbackDeviceId]);

  // ─── Phone-side Buds detection via Web Audio API ───
  const detectPhoneBuds = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioDev = devices.filter(
        (d) => d.kind === "audiooutput" || d.kind === "audioinput"
      );
      const buds = audioDev.find((d) => isGalaxyBuds(d.label));
      return buds ? { detected: true, name: buds.label } : { detected: false, name: null };
    } catch {
      return { detected: false, name: null };
    }
  }, []);

  // ─── PC-side audio device poll ───
  const pollPcDevices = useCallback(async () => {
    try {
      const result = await sendCommand("list_audio_outputs", {}, {
        awaitResult: true,
        timeoutMs: 5000,
      });
      if (!result.success) return null;

      const raw = result.result as any;
      const devList = raw?.devices || raw?.output_devices || [];
      const devices: PcAudioDevice[] = devList.map((d: any) => ({
        id: d.id || d.ID || "",
        name: d.name || d.Name || "Unknown",
        isDefault: !!(d.is_default || d.is_active || d.IsDefault),
        isBluetooth:
          (d.name || "").toLowerCase().includes("bluetooth") ||
          isGalaxyBuds(d.name || ""),
      }));

      const budsDevice = devices.find((d) => isGalaxyBuds(d.name));
      const defaultDevice = devices.find((d) => d.isDefault);

      return {
        devices,
        budsDetected: !!budsDevice,
        budsName: budsDevice?.name || null,
        budsIsDefault: budsDevice?.isDefault || false,
        budsId: budsDevice?.id || null,
        currentDefault: defaultDevice?.id || null,
      };
    } catch {
      return null;
    }
  }, [sendCommand]);

  // ─── Start PC→Phone audio stream ───
  const startAudioStream = useCallback(async () => {
    if (wsRef.current) return; // Already streaming

    const sessionToken = session?.session_token;
    if (!sessionToken) return;

    const sessionId = crypto.randomUUID();
    audioSessionIdRef.current = sessionId;

    // Create audio session via edge function
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      await supabase.functions.invoke("audio-relay", {
        body: {
          action: "create_session",
          sessionId,
          direction: "pc_to_phone",
        },
      });
    } catch {
      console.error("[SeamlessBuds] Failed to create audio session");
      return;
    }

    // Tell the PC agent to start streaming system audio
    sendCommand("start_audio_relay", {
      session_id: sessionId,
      direction: "pc_to_phone",
      use_system_audio: true,
    }, { awaitResult: false });

    // Connect phone side to receive audio
    const wsBase = getFunctionsWsBase();
    const wsUrl = `${wsBase}/functions/v1/audio-relay?sessionId=${sessionId}&type=phone&direction=pc_to_phone&session_token=${sessionToken}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      // Set up Web Audio playback
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;

      ws.onopen = () => {
        setState((s) => ({ ...s, isStreaming: true, audioRoute: "streaming" }));
        console.log("[SeamlessBuds] Audio stream connected");
      };

      ws.onmessage = async (e) => {
        if (e.data instanceof Blob || e.data instanceof ArrayBuffer) {
          try {
            const arrayBuffer =
              e.data instanceof Blob ? await e.data.arrayBuffer() : e.data;
            const int16 = new Int16Array(arrayBuffer);
            const float32 = new Float32Array(int16.length);
            for (let i = 0; i < int16.length; i++) {
              float32[i] = int16[i] / 32768;
            }

            const buffer = audioCtx.createBuffer(1, float32.length, 16000);
            buffer.copyToChannel(float32, 0);
            const source = audioCtx.createBufferSource();
            source.buffer = buffer;
            source.connect(audioCtx.destination);
            source.start();
          } catch {}
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        setState((s) => ({
          ...s,
          isStreaming: false,
          audioRoute: s.budsLocation === "pc" ? "direct" : "idle",
        }));
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      console.error("[SeamlessBuds] WebSocket connection failed");
    }
  }, [session, sendCommand]);

  // ─── Stop audio stream ───
  const stopAudioStream = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (audioSessionIdRef.current) {
      sendCommand("stop_audio_relay", {}, { awaitResult: false });
      audioSessionIdRef.current = null;
    }
    setState((s) => ({ ...s, isStreaming: false, audioRoute: "idle" }));
  }, [sendCommand]);

  // ─── Switch PC audio output ───
  const switchPcOutput = useCallback(
    async (deviceId: string) => {
      const result = await sendCommand("set_audio_output", { device_id: deviceId }, {
        awaitResult: true,
        timeoutMs: 5000,
      });
      return result.success || false;
    },
    [sendCommand]
  );

  // ─── Main poll loop ───
  const poll = useCallback(async () => {
    setState((s) => ({ ...s, isPolling: true }));

    const [phoneBuds, pcData] = await Promise.all([
      detectPhoneBuds(),
      pollPcDevices(),
    ]);

    const pcBudsDetected = pcData?.budsDetected || false;
    const pcBudsIsDefault = pcData?.budsIsDefault || false;

    let budsLocation: BudsLocation = "none";
    if (phoneBuds.detected && pcBudsDetected) budsLocation = "both";
    else if (phoneBuds.detected) budsLocation = "phone";
    else if (pcBudsDetected) budsLocation = "pc";

    // Determine audio route
    let audioRoute: AudioRoute = "idle";
    if (budsLocation === "pc" && pcBudsIsDefault) audioRoute = "direct";
    else if (budsLocation === "phone" && wsRef.current) audioRoute = "streaming";

    setState((s) => ({
      ...s,
      phoneBudsDetected: phoneBuds.detected,
      phoneBudsName: phoneBuds.name,
      pcBudsDetected,
      pcBudsName: pcData?.budsName || null,
      pcBudsIsDefault,
      budsLocation,
      audioRoute,
      pcDevices: pcData?.devices || s.pcDevices,
      currentPcDefault: pcData?.currentDefault || s.currentPcDefault,
      isPolling: false,
      lastPollTime: Date.now(),
    }));

    // ─── Auto-switch logic ───
    if (autoSwitch) {
      const prevLocation = prevBudsLocationRef.current;

      // Buds moved from PC to Phone → start streaming PC audio
      if (budsLocation === "phone" && prevLocation !== "phone" && !wsRef.current) {
        console.log("[SeamlessBuds] Buds moved to phone → starting PC audio stream");
        startAudioStream();
      }

      // Buds moved from Phone to PC → stop streaming, switch PC output to buds
      if (
        (budsLocation === "pc" || budsLocation === "both") &&
        prevLocation === "phone" &&
        pcData?.budsId
      ) {
        console.log("[SeamlessBuds] Buds back on PC → switching audio output");
        stopAudioStream();
        switchPcOutput(pcData.budsId);
      }

      // Buds disconnected from everything → fallback
      if (budsLocation === "none" && prevLocation !== "none") {
        stopAudioStream();
        if (fallbackDeviceId) {
          switchPcOutput(fallbackDeviceId);
        }
      }
    }

    prevBudsLocationRef.current = budsLocation;
  }, [
    detectPhoneBuds,
    pollPcDevices,
    autoSwitch,
    startAudioStream,
    stopAudioStream,
    switchPcOutput,
    fallbackDeviceId,
  ]);

  // ─── Start/stop polling ───
  useEffect(() => {
    poll(); // Initial
    pollTimerRef.current = window.setInterval(poll, 3000);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [poll]);

  // ─── Cleanup ───
  useEffect(() => {
    return () => {
      stopAudioStream();
    };
  }, [stopAudioStream]);

  return {
    state,
    autoSwitch,
    setAutoSwitch,
    fallbackDeviceId,
    setFallbackDeviceId,
    poll,
    startAudioStream,
    stopAudioStream,
    switchPcOutput,
  };
}
