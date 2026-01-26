import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface PiPStream {
  id: string;
  title: string;
  frame: string | null;
  fps: number;
  latency: number;
  isActive: boolean;
  type: "camera" | "screen" | "phone";
}

interface GlobalPiPContextType {
  activeStreams: Map<string, PiPStream>;
  pinnedStreamId: string | null;
  isFloating: boolean;
  floatingPosition: { x: number; y: number };
  floatingSize: { width: number; height: number };
  isLandscape: boolean;
  
  // Actions
  registerStream: (stream: PiPStream) => void;
  unregisterStream: (id: string) => void;
  updateStreamFrame: (id: string, frame: string, fps?: number, latency?: number) => void;
  setStreamActive: (id: string, active: boolean) => void;
  pinStream: (id: string | null) => void;
  setFloating: (floating: boolean) => void;
  setFloatingPosition: (pos: { x: number; y: number }) => void;
  setFloatingSize: (size: { width: number; height: number }) => void;
  toggleLandscape: () => void;
}

const GlobalPiPContext = createContext<GlobalPiPContextType | null>(null);

export function GlobalPiPProvider({ children }: { children: ReactNode }) {
  const [activeStreams, setActiveStreams] = useState<Map<string, PiPStream>>(new Map());
  const [pinnedStreamId, setPinnedStreamId] = useState<string | null>(null);
  const [isFloating, setIsFloating] = useState(false);
  const [floatingPosition, setFloatingPosition] = useState({ x: window.innerWidth - 520, y: window.innerHeight - 340 });
  const [floatingSize, setFloatingSize] = useState({ width: 480, height: 270 });
  const [isLandscape, setIsLandscape] = useState(true);

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
    if (id) setIsFloating(true);
  }, []);

  const setFloating = useCallback((floating: boolean) => {
    setIsFloating(floating);
  }, []);

  const toggleLandscape = useCallback(() => {
    setIsLandscape(prev => !prev);
    setFloatingSize(prev => ({
      width: prev.height,
      height: prev.width,
    }));
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
