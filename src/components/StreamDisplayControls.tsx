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
  const floatingRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const resizeStartRef = useRef({ width: 0, height: 0, x: 0, y: 0 });

  // Exit fullscreen when stream stops
  useEffect(() => {
    if (!isActive && displayMode === "fullscreen") {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      setDisplayMode("normal");
    }
  }, [isActive, displayMode]);

  // Handle fullscreen change events
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && displayMode === "fullscreen") {
        setDisplayMode("normal");
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
    } else {
      if (displayMode === "floating") setDisplayMode("normal");
      try {
        await container.requestFullscreen();
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
      // Position at bottom-right with nice size
      setFloatingPos({
        x: window.innerWidth - floatingSize.width - 24,
        y: window.innerHeight - floatingSize.height - 80,
      });
    }
  }, [displayMode, floatingSize]);

  // Dragging logic for floating window
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (displayMode !== "floating") return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX - floatingPos.x,
      y: e.clientY - floatingPos.y,
    };
  }, [displayMode, floatingPos]);

  // Resize logic
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeStartRef.current = {
      width: floatingSize.width,
      height: floatingSize.height,
      x: e.clientX,
      y: e.clientY,
    };
  }, [floatingSize]);

  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setFloatingPos({
          x: Math.max(0, Math.min(window.innerWidth - floatingSize.width, e.clientX - dragStartRef.current.x)),
          y: Math.max(0, Math.min(window.innerHeight - floatingSize.height - 40, e.clientY - dragStartRef.current.y)),
        });
      }
      if (isResizing) {
        const deltaX = e.clientX - resizeStartRef.current.x;
        const deltaY = e.clientY - resizeStartRef.current.y;
        const newWidth = Math.max(320, Math.min(800, resizeStartRef.current.width + deltaX));
        const newHeight = Math.max(180, Math.min(600, resizeStartRef.current.height + deltaY));
        setFloatingSize({ width: newWidth, height: newHeight });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, isResizing, floatingSize]);

  // Render the stream content
  const renderStreamContent = () => {
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
      <img
        src={frame}
        alt={title}
        className={cn(
          "w-full h-full",
          displayMode === "fullscreen" ? "object-contain" : "object-cover"
        )}
        draggable={false}
      />
    );
  };

  // Render the controls overlay
  const renderControls = () => (
    <div className="absolute top-2 right-2 flex gap-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
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

  // Render stats overlay - minimal, only when streaming
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
      </div>
    );
  };

  // Normal mode - embedded in parent
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

  // Floating mode - fixed position draggable + resizable window
  if (displayMode === "floating") {
    return (
      <>
        {/* Placeholder in normal position */}
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

        {/* Floating window */}
        <div
          ref={floatingRef}
          className="fixed z-[9999] rounded-xl border border-white/10 shadow-2xl overflow-hidden bg-black"
          style={{
            left: floatingPos.x,
            top: floatingPos.y,
            width: floatingSize.width,
            height: floatingSize.height,
          }}
        >
          {/* Draggable header */}
          <div
            className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 py-2 bg-gradient-to-b from-black/80 to-transparent cursor-move z-20"
            onMouseDown={handleMouseDown}
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
                onClick={toggleFullscreen}
              >
                <Maximize2 className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-white/80 hover:text-white hover:bg-white/10"
                onClick={() => setDisplayMode("normal")}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Stream content */}
          <div className="relative w-full h-full">
            {renderStreamContent()}
            {renderStats()}
          </div>

          {/* Resize handle */}
          <div
            className="absolute bottom-0 right-0 w-6 h-6 cursor-se-resize z-20 flex items-center justify-center"
            onMouseDown={handleResizeStart}
          >
            <GripVertical className="h-4 w-4 text-white/30 rotate-[-45deg]" />
          </div>
        </div>
      </>
    );
  }

  // Fullscreen mode
  return (
    <div
      id={`stream-fullscreen-${title.replace(/\s/g, "-")}`}
      className="relative w-full h-full bg-black group"
    >
      {renderStreamContent()}
      <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
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
        Press ESC to exit
      </div>
    </div>
  );
}
