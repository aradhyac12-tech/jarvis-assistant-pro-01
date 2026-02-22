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
  RotateCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface StreamDisplayControlsProps {
  frame: string | null;
  isActive: boolean;
  fps?: number;
  latency?: number;
  title: string;
  error?: string | null;
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
  onClose,
  className,
}: StreamDisplayControlsProps) {
  const [displayMode, setDisplayMode] = useState<"normal" | "fullscreen" | "floating">("normal");
  const [floatingPos, setFloatingPos] = useState({ x: 20, y: 20 });
  const [floatingSize, setFloatingSize] = useState({ width: 480, height: 270 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const floatingRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const resizeStartRef = useRef({ width: 0, height: 0, x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });
  const lastTouchDistRef = useRef<number | null>(null);
  const imgContainerRef = useRef<HTMLDivElement>(null);

  // Exit fullscreen when stream stops
  useEffect(() => {
    if (!isActive && displayMode === "fullscreen") {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      setDisplayMode("normal");
      setZoomLevel(1);
      setPanOffset({ x: 0, y: 0 });
    }
  }, [isActive, displayMode]);

  // Handle fullscreen change events
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && displayMode === "fullscreen") {
        setDisplayMode("normal");
        setZoomLevel(1);
        setPanOffset({ x: 0, y: 0 });
        // Unlock orientation
        try {
          (screen.orientation as any)?.unlock?.();
        } catch {}
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [displayMode]);

  const toggleFullscreen = useCallback(async () => {
    const container = document.getElementById(`stream-fullscreen-${title.replace(/\s/g, "-")}`);
    if (!container) return;

    if (displayMode === "fullscreen") {
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {});
      }
      setDisplayMode("normal");
      setZoomLevel(1);
      setPanOffset({ x: 0, y: 0 });
      try {
        (screen.orientation as any)?.unlock?.();
      } catch {}
    } else {
      if (displayMode === "floating") setDisplayMode("normal");
      try {
        await container.requestFullscreen();
        // Lock to landscape for fullscreen
        try {
          await (screen.orientation as any)?.lock?.("landscape");
        } catch {}
        setDisplayMode("fullscreen");
      } catch (err) {
        console.error("Fullscreen failed:", err);
      }
    }
  }, [displayMode, title]);

  const toggleFloating = useCallback(() => {
    if (displayMode === "floating") {
      setDisplayMode("normal");
    } else {
      if (displayMode === "fullscreen" && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      setDisplayMode("floating");
      setFloatingPos({
        x: window.innerWidth - floatingSize.width - 24,
        y: window.innerHeight - floatingSize.height - 80,
      });
    }
  }, [displayMode, floatingSize]);

  // Touch support for dragging
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (displayMode !== "floating") return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    const point = "touches" in e ? e.touches[0] : e;
    dragStartRef.current = {
      x: point.clientX - floatingPos.x,
      y: point.clientY - floatingPos.y,
    };
  }, [displayMode, floatingPos]);

  // Touch support for resizing
  const handleResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    const point = "touches" in e ? e.touches[0] : e;
    resizeStartRef.current = {
      width: floatingSize.width,
      height: floatingSize.height,
      x: point.clientX,
      y: point.clientY,
    };
  }, [floatingSize]);

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

  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      const point = "touches" in e ? e.touches[0] : e;
      if (isDragging) {
        setFloatingPos({
          x: Math.max(0, Math.min(window.innerWidth - floatingSize.width, point.clientX - dragStartRef.current.x)),
          y: Math.max(0, Math.min(window.innerHeight - floatingSize.height - 40, point.clientY - dragStartRef.current.y)),
        });
      }
      if (isResizing) {
        const deltaX = point.clientX - resizeStartRef.current.x;
        const deltaY = point.clientY - resizeStartRef.current.y;
        const newWidth = Math.max(200, Math.min(800, resizeStartRef.current.width + deltaX));
        const newHeight = Math.max(120, Math.min(600, resizeStartRef.current.height + deltaY));
        setFloatingSize({ width: newWidth, height: newHeight });
      }
    };

    const handleEnd = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleEnd);
    document.addEventListener("touchmove", handleMove, { passive: false });
    document.addEventListener("touchend", handleEnd);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleEnd);
      document.removeEventListener("touchmove", handleMove);
      document.removeEventListener("touchend", handleEnd);
    };
  }, [isDragging, isResizing, floatingSize]);

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
      isFullscreenMode ? "opacity-0 group-hover:opacity-100 transition-opacity" : "opacity-0 group-hover:opacity-100 transition-opacity"
    )}>
      {isFullscreenMode && zoomLevel > 1 && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 bg-black/50 backdrop-blur-sm hover:bg-black/70 text-white"
          onClick={() => { setZoomLevel(1); setPanOffset({ x: 0, y: 0 }); }}
          title="Reset zoom"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 bg-black/50 backdrop-blur-sm hover:bg-black/70 text-white"
        onClick={toggleFloating}
        title={displayMode === "floating" ? "Exit floating" : "Floating window"}
      >
        <PictureInPicture2 className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 bg-black/50 backdrop-blur-sm hover:bg-black/70 text-white"
        onClick={toggleFullscreen}
        title={displayMode === "fullscreen" ? "Exit fullscreen" : "Fullscreen"}
      >
        {displayMode === "fullscreen" ? (
          <Minimize2 className="h-4 w-4" />
        ) : (
          <Maximize2 className="h-4 w-4" />
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

  // Normal mode
  if (displayMode === "normal") {
    return (
      <div
        id={`stream-fullscreen-${title.replace(/\s/g, "-")}`}
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

  // Floating mode
  if (displayMode === "floating") {
    return (
      <>
        <div
          className={cn(
            "relative aspect-video rounded-xl border-2 border-dashed border-primary/30 overflow-hidden bg-primary/5",
            className
          )}
        >
          <div className="absolute inset-0 flex items-center justify-center text-primary/60 text-sm">
            <PictureInPicture2 className="h-5 w-5 mr-2" />
            Floating mode
          </div>
        </div>

        <div
          ref={floatingRef}
          className="fixed z-[9999] rounded-xl border border-white/10 shadow-2xl overflow-hidden bg-black group"
          style={{
            left: floatingPos.x,
            top: floatingPos.y,
            width: floatingSize.width,
            height: floatingSize.height,
            transition: isDragging || isResizing ? "none" : "box-shadow 0.2s",
          }}
        >
          {/* Draggable header */}
          <div
            className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 py-2 bg-gradient-to-b from-black/80 to-transparent cursor-move z-20"
            onMouseDown={handleDragStart}
            onTouchStart={handleDragStart}
          >
            <div className="flex items-center gap-2 text-white/80 text-xs font-medium">
              <Move className="h-3 w-3" />
              {title}
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-white/80 hover:text-white hover:bg-white/10"
                onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
              >
                <Maximize2 className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-white/80 hover:text-white hover:bg-white/10"
                onClick={(e) => { e.stopPropagation(); setDisplayMode("normal"); }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>

          <div className="relative w-full h-full">
            {renderStreamContent()}
            {renderStats()}
          </div>

          {/* Resize handle - touch supported */}
          <div
            className="absolute bottom-0 right-0 w-8 h-8 cursor-se-resize z-20 flex items-end justify-end p-1"
            onMouseDown={handleResizeStart}
            onTouchStart={handleResizeStart}
          >
            <GripVertical className="h-4 w-4 text-white/30 rotate-[-45deg]" />
          </div>
        </div>
      </>
    );
  }

  // Fullscreen mode - landscape with zoom
  return (
    <div
      id={`stream-fullscreen-${title.replace(/\s/g, "-")}`}
      className="relative w-full h-full bg-black group"
    >
      {renderStreamContent(true)}
      <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-20">
        {zoomLevel > 1 && (
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 bg-black/50 backdrop-blur-sm hover:bg-black/70 text-white"
            onClick={() => { setZoomLevel(1); setPanOffset({ x: 0, y: 0 }); }}
          >
            <ZoomOut className="h-5 w-5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 bg-black/50 backdrop-blur-sm hover:bg-black/70 text-white"
          onClick={toggleFullscreen}
        >
          <Minimize2 className="h-5 w-5" />
        </Button>
      </div>
      {renderStats()}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/40 text-sm opacity-0 group-hover:opacity-100 transition-opacity">
        {zoomLevel > 1 ? "Pinch or tap reset to zoom out" : "Pinch to zoom · Press ESC to exit"}
      </div>
    </div>
  );
}
