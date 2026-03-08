import { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from "react";

interface PiPStream {
  id: string;
  title: string;
  frame: string | null;
  fps: number;
  latency: number;
  isActive: boolean;
  type: "camera" | "screen" | "phone";
}

interface WsOwnership {
  ws: WebSocket;
  processFrame: (frame: string) => void;
  cleanup?: () => void;
}

interface GlobalPiPContextType {
  activeStreams: Map<string, PiPStream>;
  pinnedStreamId: string | null;
  isFloating: boolean;
  floatingPosition: { x: number; y: number };
  floatingSize: { width: number; height: number };
  isLandscape: boolean;
  
  registerStream: (stream: PiPStream) => void;
  unregisterStream: (id: string) => void;
  updateStreamFrame: (id: string, frame: string, fps?: number, latency?: number) => void;
  setStreamActive: (id: string, active: boolean) => void;
  pinStream: (id: string | null) => void;
  setFloating: (floating: boolean) => void;
  setFloatingPosition: (pos: { x: number; y: number }) => void;
  setFloatingSize: (size: { width: number; height: number }) => void;
  toggleLandscape: () => void;
  
  /** Transfer WebSocket ownership to context so it survives page navigation */
  takeWebSocketOwnership: (streamId: string, ws: WebSocket, blobUrlRef?: React.MutableRefObject<string | null>) => void;
  /** Check if context owns the WS for a stream */
  hasWebSocketOwnership: (streamId: string) => boolean;
  /** Release WS ownership back (e.g. when unpinning) */
  releaseWebSocketOwnership: (streamId: string) => void;
}

const GlobalPiPContext = createContext<GlobalPiPContextType | null>(null);

export function GlobalPiPProvider({ children }: { children: ReactNode }) {
  const [activeStreams, setActiveStreams] = useState<Map<string, PiPStream>>(new Map());
  const [pinnedStreamId, setPinnedStreamId] = useState<string | null>(null);
  const [isFloating, setIsFloating] = useState(false);
  // Center the PiP by default
  const [floatingPosition, setFloatingPosition] = useState({ 
    x: Math.max(0, (window.innerWidth - 400) / 2), 
    y: Math.max(0, (window.innerHeight - 260) / 2) 
  });
  const [floatingSize, setFloatingSize] = useState({ width: 400, height: 240 });
  const [isLandscape, setIsLandscape] = useState(true);
  
  // WebSocket ownership map — context keeps WS alive across page navigations
  const wsOwnerships = useRef<Map<string, WsOwnership>>(new Map());
  const fpsCounters = useRef<Map<string, { frames: number; lastCheck: number }>>(new Map());
  const blobUrls = useRef<Map<string, string>>(new Map());

  const registerStream = useCallback((stream: PiPStream) => {
    setActiveStreams(prev => {
      const newMap = new Map(prev);
      newMap.set(stream.id, stream);
      return newMap;
    });
  }, []);

  const unregisterStream = useCallback((id: string) => {
    setActiveStreams(prev => {
      const newMap = new Map(prev);
      newMap.delete(id);
      return newMap;
    });
    setPinnedStreamId(prev => prev === id ? null : prev);
  }, []);

  const updateStreamFrame = useCallback((id: string, frame: string, fps?: number, latency?: number) => {
    setActiveStreams(prev => {
      const stream = prev.get(id);
      if (!stream) return prev;
      const newMap = new Map(prev);
      newMap.set(id, {
        ...stream,
        frame,
        fps: fps ?? stream.fps,
        latency: latency ?? stream.latency,
      });
      return newMap;
    });
  }, []);

  const setStreamActive = useCallback((id: string, active: boolean) => {
    setActiveStreams(prev => {
      const stream = prev.get(id);
      if (!stream) return prev;
      const newMap = new Map(prev);
      newMap.set(id, { ...stream, isActive: active });
      return newMap;
    });
    if (!active && pinnedStreamId === id) {
      setIsFloating(false);
    }
  }, [pinnedStreamId]);

  const pinStream = useCallback((id: string | null) => {
    setPinnedStreamId(id);
    if (id) {
      setIsFloating(true);
      // Re-center when pinning a new stream
      setFloatingPosition({
        x: Math.max(0, (window.innerWidth - floatingSize.width) / 2),
        y: Math.max(0, (window.innerHeight - floatingSize.height) / 2),
      });
    }
  }, [floatingSize]);

  const setFloating = useCallback((floating: boolean) => {
    setIsFloating(floating);
    if (!floating) {
      // Release WS ownership when closing PiP
      wsOwnerships.current.forEach((ownership, id) => {
        // Don't close WS — let the source component reclaim it if still mounted
      });
    }
  }, []);

  const toggleLandscape = useCallback(() => {
    setIsLandscape(prev => !prev);
    setFloatingSize(prev => ({
      width: prev.height,
      height: prev.width,
    }));
  }, []);

  // ===== WebSocket Ownership =====
  
  const processWsMessage = useCallback((streamId: string, event: MessageEvent) => {
    const now = Date.now();
    
    const handleArrayBuffer = (ab: ArrayBuffer) => {
      if (ab.byteLength < 100) return;
      const blob = new Blob([ab], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      
      // Revoke old blob URL
      const oldUrl = blobUrls.current.get(streamId);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      blobUrls.current.set(streamId, url);
      
      // Calculate FPS
      let counter = fpsCounters.current.get(streamId);
      if (!counter) { counter = { frames: 0, lastCheck: now }; fpsCounters.current.set(streamId, counter); }
      counter.frames++;
      const elapsed = now - counter.lastCheck;
      let fps = 0;
      if (elapsed >= 1000) {
        fps = Math.round((counter.frames * 1000) / elapsed);
        fpsCounters.current.set(streamId, { frames: 0, lastCheck: now });
      }
      
      updateStreamFrame(streamId, url, fps > 0 ? fps : undefined);
    };
    
    if (event.data instanceof ArrayBuffer) {
      handleArrayBuffer(event.data);
    } else if (event.data instanceof Blob && event.data.size > 100) {
      event.data.arrayBuffer().then(handleArrayBuffer);
    } else if (typeof event.data === "string") {
      try {
        const data = JSON.parse(event.data);
        if ((data.type === "camera_frame" || data.type === "screen_frame") && data.data) {
          updateStreamFrame(streamId, `data:image/jpeg;base64,${data.data}`);
        }
      } catch {}
    }
  }, [updateStreamFrame]);

  const takeWebSocketOwnership = useCallback((streamId: string, ws: WebSocket) => {
    // Attach our own message handler to keep frames flowing
    const originalOnMessage = ws.onmessage;
    
    ws.onmessage = (event) => {
      processWsMessage(streamId, event);
    };
    
    // Keepalive ping
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: "ping" })); } catch {}
      } else {
        clearInterval(pingInterval);
      }
    }, 25000);
    
    ws.onclose = () => {
      clearInterval(pingInterval);
      wsOwnerships.current.delete(streamId);
      setStreamActive(streamId, false);
      const oldUrl = blobUrls.current.get(streamId);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      blobUrls.current.delete(streamId);
    };
    
    wsOwnerships.current.set(streamId, {
      ws,
      processFrame: () => {},
      cleanup: () => clearInterval(pingInterval),
    });
  }, [processWsMessage, setStreamActive]);

  const hasWebSocketOwnership = useCallback((streamId: string) => {
    const ownership = wsOwnerships.current.get(streamId);
    return !!ownership && ownership.ws.readyState === WebSocket.OPEN;
  }, []);

  const releaseWebSocketOwnership = useCallback((streamId: string) => {
    const ownership = wsOwnerships.current.get(streamId);
    if (ownership) {
      ownership.cleanup?.();
      if (ownership.ws.readyState === WebSocket.OPEN || ownership.ws.readyState === WebSocket.CONNECTING) {
        try { ownership.ws.close(); } catch {}
      }
      wsOwnerships.current.delete(streamId);
    }

    const oldUrl = blobUrls.current.get(streamId);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    blobUrls.current.delete(streamId);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsOwnerships.current.forEach((ownership) => {
        ownership.cleanup?.();
        ownership.ws.close();
      });
      blobUrls.current.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  return (
    <GlobalPiPContext.Provider
      value={{
        activeStreams,
        pinnedStreamId,
        isFloating,
        floatingPosition,
        floatingSize,
        isLandscape,
        registerStream,
        unregisterStream,
        updateStreamFrame,
        setStreamActive,
        pinStream,
        setFloating,
        setFloatingPosition,
        setFloatingSize,
        toggleLandscape,
        takeWebSocketOwnership,
        hasWebSocketOwnership,
        releaseWebSocketOwnership,
      }}
    >
      {children}
    </GlobalPiPContext.Provider>
  );
}

export function useGlobalPiP() {
  const ctx = useContext(GlobalPiPContext);
  if (!ctx) throw new Error("useGlobalPiP must be used within GlobalPiPProvider");
  return ctx;
}
