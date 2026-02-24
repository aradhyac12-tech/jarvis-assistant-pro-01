import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Maximize2,
  Minimize2,
  PictureInPicture2,
  X,
  Move,
  Loader2,
  GripVertical,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGlobalPiP } from "@/contexts/GlobalPiPContext";

interface StreamDisplayControlsProps {
  frame: string | null;
  isActive: boolean;
  fps?: number;
  latency?: number;
  title: string;
  error?: string | null;
  streamId?: string;
  streamType?: "camera" | "screen" | "phone";
  onClose?: () => void;
  className?: string;
}

export function StreamDisplayControls({
  frame,
  isActive,
  fps = 0,
  latency = 0,
  title,
  error,
  streamId,
  streamType = "camera",
  onClose,
  className,
}: StreamDisplayControlsProps) {
  const pip = useGlobalPiP();
  const [displayMode, setDisplayMode] = useState<"normal" | "fullscreen">("normal");
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const lastTouchDistRef = useRef<number | null>(null);
  const panStartRef = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });
  const imgContainerRef = useRef<HTMLDivElement>(null);
  const fullscreenContainerRef = useRef<HTMLDivElement>(null);

  const effectiveStreamId = streamId || `stream-${title.replace(/\s/g, "-")}`;

  // Register/update stream in GlobalPiP context
  useEffect(() => {
    if (isActive) {
      pip.registerStream({
        id: effectiveStreamId,
        title,
        frame,
        fps,
        latency,
        isActive: true,
        type: streamType,
      });
    } else {
      pip.setStreamActive(effectiveStreamId, false);
    }
  }, [isActive, effectiveStreamId, title, streamType]);

  // Update frame in GlobalPiP
  useEffect(() => {
    if (isActive && frame) {
      pip.updateStreamFrame(effectiveStreamId, frame, fps, latency);
    }
  }, [frame, fps, latency, isActive, effectiveStreamId]);

  // Unregister on unmount
  useEffect(() => {
    return () => {
      pip.unregisterStream(effectiveStreamId);
    };
  }, [effectiveStreamId]);

  // Exit fullscreen when stream stops
  useEffect(() => {
    if (!isActive && displayMode === "fullscreen") {
      exitFullscreenSafe();
    }
  }, [isActive, displayMode]);

  // Handle fullscreen change events
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && displayMode === "fullscreen") {
        setDisplayMode("normal");
        setZoomLevel(1);
        setPanOffset({ x: 0, y: 0 });
        try {
          (screen.orientation as any)?.unlock?.();
        } catch {}
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [displayMode]);

  const exitFullscreenSafe = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    setDisplayMode("normal");
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
    try {
      (screen.orientation as any)?.unlock?.();
    } catch {}
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (displayMode === "fullscreen") {
      exitFullscreenSafe();
    } else {
      // Use a dedicated fullscreen container to avoid page refresh
      const container = fullscreenContainerRef.current;
      if (!container) return;
      try {
        await container.requestFullscreen();
        try {
          await (screen.orientation as any)?.lock?.("landscape");
        } catch {}
        setDisplayMode("fullscreen");
      } catch (err) {
        console.error("Fullscreen failed:", err);
      }
    }
  }, [displayMode, exitFullscreenSafe]);

  const toggleFloating = useCallback(() => {
    const isPinned = pip.pinnedStreamId === effectiveStreamId && pip.isFloating;
    if (isPinned) {
      pip.setFloating(false);
      pip.pinStream(null);
    } else {
      if (displayMode === "fullscreen") {
        exitFullscreenSafe();
      }
      pip.pinStream(effectiveStreamId);
    }
  }, [displayMode, effectiveStreamId, pip, exitFullscreenSafe]);

  // Pinch zoom for fullscreen
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (displayMode !== "fullscreen") return;
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDistRef.current = Math.hypot(dx, dy);
    } else if (e.touches.length === 1 && zoomLevel > 1) {
      setIsPanning(true);
      panStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        offsetX: panOffset.x,
        offsetY: panOffset.y,
      };
    }
  }, [displayMode, zoomLevel, panOffset]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (displayMode !== "fullscreen") return;
    if (e.touches.length === 2 && lastTouchDistRef.current !== null) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const scale = dist / lastTouchDistRef.current;
      setZoomLevel(prev => Math.max(1, Math.min(5, prev * scale)));
      lastTouchDistRef.current = dist;
    } else if (e.touches.length === 1 && isPanning && zoomLevel > 1) {
      const dx = e.touches[0].clientX - panStartRef.current.x;
      const dy = e.touches[0].clientY - panStartRef.current.y;
      setPanOffset({
        x: panStartRef.current.offsetX + dx,
        y: panStartRef.current.offsetY + dy,
      });
    }
  }, [displayMode, isPanning, zoomLevel]);

  const handleTouchEnd = useCallback(() => {
    lastTouchDistRef.current = null;
    setIsPanning(false);
  }, []);

  const isPipActive = pip.pinnedStreamId === effectiveStreamId && pip.isFloating;

  const renderStreamContent = (isFullscreenMode = false) => {
    if (!isActive) {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground bg-secondary/50">
          <p className="text-sm">Stream is off</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-destructive bg-destructive/10">
          <p className="text-sm font-medium">Error</p>
          <p className="text-xs max-w-[200px] text-center mt-1">{error}</p>
        </div>
      );
    }

    if (!frame) {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground bg-secondary/30">
          <Loader2 className="h-8 w-8 animate-spin mb-2 text-primary" />
          <p className="text-sm">Waiting for frames...</p>
        </div>
      );
    }

    return (
      <div
        ref={imgContainerRef}
        className="w-full h-full overflow-hidden"
        onTouchStart={isFullscreenMode ? handleTouchStart : undefined}
        onTouchMove={isFullscreenMode ? handleTouchMove : undefined}
        onTouchEnd={isFullscreenMode ? handleTouchEnd : undefined}
      >
        <img
          src={frame}
          alt={title}
          className="w-full h-full object-contain"
          draggable={false}
          style={isFullscreenMode ? {
            transform: `scale(${zoomLevel}) translate(${panOffset.x / zoomLevel}px, ${panOffset.y / zoomLevel}px)`,
            transformOrigin: "center center",
            transition: isPanning ? "none" : "transform 0.1s ease-out",
          } : undefined}
        />
      </div>
    );
  };

  const renderControls = (isFullscreenMode = false) => (
    <div className={cn(
      "absolute top-2 right-2 flex gap-1 z-10",
      isFullscreenMode ? "opacity-100" : "opacity-0 group-hover:opacity-100 transition-opacity"
    )}>
      {isFullscreenMode && zoomLevel > 1 && (
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 bg-black/50 backdrop-blur-sm hover:bg-black/70 text-white"
          onClick={() => { setZoomLevel(1); setPanOffset({ x: 0, y: 0 }); }}
          title="Reset zoom"
        >
          <ZoomOut className="h-5 w-5" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-10 w-10 bg-black/50 backdrop-blur-sm hover:bg-black/70 text-white",
          isPipActive && "bg-primary/50"
        )}
        onClick={toggleFloating}
        title={isPipActive ? "Exit floating" : "Float across pages"}
      >
        <PictureInPicture2 className="h-5 w-5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10 bg-black/50 backdrop-blur-sm hover:bg-black/70 text-white"
        onClick={toggleFullscreen}
        title={displayMode === "fullscreen" ? "Exit fullscreen" : "Fullscreen"}
      >
        {displayMode === "fullscreen" ? (
          <Minimize2 className="h-5 w-5" />
        ) : (
          <Maximize2 className="h-5 w-5" />
        )}
      </Button>
    </div>
  );

  const renderStats = () => {
    if (!isActive || !frame) return null;
    return (
      <div className="absolute bottom-2 left-2 flex gap-1.5 z-10">
        <Badge 
          variant="outline" 
          className="bg-black/50 backdrop-blur-sm border-transparent text-white font-mono text-[10px] px-1.5 py-0"
        >
          {fps} FPS
        </Badge>
        {latency > 0 && (
          <Badge
            variant="outline"
            className={cn(
              "bg-black/50 backdrop-blur-sm border-transparent font-mono text-[10px] px-1.5 py-0",
              latency > 100 ? "text-destructive" : latency > 50 ? "text-warning" : "text-primary"
            )}
          >
            {latency}ms
          </Badge>
        )}
        {zoomLevel > 1 && displayMode === "fullscreen" && (
          <Badge
            variant="outline"
            className="bg-black/50 backdrop-blur-sm border-transparent text-white font-mono text-[10px] px-1.5 py-0"
          >
            {zoomLevel.toFixed(1)}x
          </Badge>
        )}
      </div>
    );
  };

  // If this stream is pinned to global PiP, show placeholder in-page
  if (isPipActive && displayMode === "normal") {
    return (
      <div
        ref={fullscreenContainerRef}
        className={cn(
          "relative aspect-video rounded-xl border-2 border-dashed border-primary/30 overflow-hidden bg-primary/5",
          className
        )}
      >
        <div className="absolute inset-0 flex items-center justify-center text-primary/60 text-sm">
          <PictureInPicture2 className="h-5 w-5 mr-2" />
          Floating on all pages
        </div>
      </div>
    );
  }

  // Normal mode
  if (displayMode === "normal") {
    return (
      <div
        ref={fullscreenContainerRef}
        className={cn(
          "group relative aspect-video rounded-xl overflow-hidden bg-black/90",
          className
        )}
      >
        {renderStreamContent()}
        {isActive && renderControls()}
        {renderStats()}
      </div>
    );
  }

  // Fullscreen mode
  return (
    <div
      ref={fullscreenContainerRef}
      className="relative w-full h-full bg-black group"
    >
      {renderStreamContent(true)}
      <div className="absolute top-4 right-4 flex gap-2 z-20">
        {zoomLevel > 1 && (
          <Button
            variant="ghost"
            size="icon"
            className="h-12 w-12 bg-black/50 backdrop-blur-sm hover:bg-black/70 text-white"
            onClick={() => { setZoomLevel(1); setPanOffset({ x: 0, y: 0 }); }}
          >
            <ZoomOut className="h-6 w-6" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-12 w-12 bg-black/50 backdrop-blur-sm hover:bg-black/70 text-white"
          onClick={toggleFullscreen}
        >
          <Minimize2 className="h-6 w-6" />
        </Button>
      </div>
      {renderStats()}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/40 text-sm">
        {zoomLevel > 1 ? "Pinch or tap reset to zoom out" : "Pinch to zoom · Press ESC to exit"}
      </div>
    </div>
  );
}
