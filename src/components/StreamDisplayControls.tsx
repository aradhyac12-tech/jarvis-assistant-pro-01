import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Maximize2,
  Minimize2,
  PictureInPicture2,
  X,
  Loader2,
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
  /** Pass the WebSocket ref so PiP can take ownership for cross-page persistence */
  wsRef?: React.MutableRefObject<WebSocket | null>;
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
  wsRef,
  onClose,
  className,
}: StreamDisplayControlsProps) {
  const pip = useGlobalPiP();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const lastTouchDistRef = useRef<number | null>(null);
  const panStartRef = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });
  const imgContainerRef = useRef<HTMLDivElement>(null);

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

  // Update frame in GlobalPiP (only if context doesn't own the WS — otherwise it updates itself)
  useEffect(() => {
    if (isActive && frame && !pip.hasWebSocketOwnership(effectiveStreamId)) {
      pip.updateStreamFrame(effectiveStreamId, frame, fps, latency);
    }
  }, [frame, fps, latency, isActive, effectiveStreamId]);

  // On unmount: if PiP is floating, transfer WS ownership to context
  useEffect(() => {
    return () => {
      const isPinned = pip.pinnedStreamId === effectiveStreamId && pip.isFloating;
      if (isPinned && wsRef?.current && wsRef.current.readyState === WebSocket.OPEN) {
        // Transfer WS to context — it will keep receiving frames
        pip.takeWebSocketOwnership(effectiveStreamId, wsRef.current);
        // Null out the ref so the source component doesn't close it
        wsRef.current = null;
      } else if (!isPinned) {
        pip.unregisterStream(effectiveStreamId);
      }
    };
  }, [effectiveStreamId]);

  // Exit fullscreen when stream stops
  useEffect(() => {
    if (!isActive && isFullscreen) {
      setIsFullscreen(false);
      setZoomLevel(1);
      setPanOffset({ x: 0, y: 0 });
    }
  }, [isActive, isFullscreen]);

  // ESC key to exit fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsFullscreen(false);
        setZoomLevel(1);
        setPanOffset({ x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isFullscreen]);

  // Lock body scroll when fullscreen
  useEffect(() => {
    if (isFullscreen) {
      document.body.style.overflow = "hidden";
      // Try to lock orientation on mobile
      try { (screen.orientation as any)?.lock?.("landscape"); } catch { }
    } else {
      document.body.style.overflow = "";
      try { (screen.orientation as any)?.unlock?.(); } catch { }
    }
    return () => { document.body.style.overflow = ""; };
  }, [isFullscreen]);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  const toggleFloating = useCallback(() => {
    const isPinned = pip.pinnedStreamId === effectiveStreamId && pip.isFloating;
    if (isPinned) {
      pip.setFloating(false);
      pip.pinStream(null);
      pip.releaseWebSocketOwnership(effectiveStreamId);
    } else {
      if (isFullscreen) {
        setIsFullscreen(false);
      }
      // Transfer WS ownership to context for cross-page persistence
      if (wsRef?.current && wsRef.current.readyState === WebSocket.OPEN) {
        pip.takeWebSocketOwnership(effectiveStreamId, wsRef.current);
        wsRef.current = null;
      }
      pip.pinStream(effectiveStreamId);
    }
  }, [isFullscreen, effectiveStreamId, pip, wsRef]);

  // Pinch zoom for fullscreen
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isFullscreen) return;
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
  }, [isFullscreen, zoomLevel, panOffset]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isFullscreen) return;
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
  }, [isFullscreen, isPanning, zoomLevel]);

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
        title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
      >
        {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
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
        {zoomLevel > 1 && isFullscreen && (
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
  if (isPipActive && !isFullscreen) {
    return (
      <div
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

  // CSS-only fullscreen (no Fullscreen API — avoids mobile refresh issues)
  if (isFullscreen) {
    return (
      <>
        {/* Placeholder in flow */}
        <div className={cn("relative aspect-video rounded-xl overflow-hidden bg-black/90", className)}>
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
            <Maximize2 className="h-5 w-5 mr-2" /> Fullscreen Active
          </div>
        </div>
        {/* CSS fullscreen overlay — no DOM manipulation, no Fullscreen API, no refresh */}
        <div
          className="fixed inset-0 z-[99999] bg-black"
          style={{ touchAction: "none" }}
        >
          <div className="relative w-full h-full group">
            {renderStreamContent(true)}
            <div className="absolute top-4 right-4 flex gap-2 z-20">
              {zoomLevel > 1 && (
                <Button variant="ghost" size="icon" className="h-12 w-12 bg-black/50 backdrop-blur-sm hover:bg-black/70 text-white"
                  onClick={() => { setZoomLevel(1); setPanOffset({ x: 0, y: 0 }); }}>
                  <ZoomOut className="h-6 w-6" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-12 w-12 bg-black/50 backdrop-blur-sm hover:bg-black/70 text-white"
                onClick={toggleFullscreen}>
                <Minimize2 className="h-6 w-6" />
              </Button>
            </div>
            {renderStats()}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/40 text-sm">
              {zoomLevel > 1 ? "Pinch or tap reset to zoom out" : "Pinch to zoom · Tap X or ESC to exit"}
            </div>
          </div>
        </div>
      </>
    );
  }

  // Normal mode
  return (
    <div
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
