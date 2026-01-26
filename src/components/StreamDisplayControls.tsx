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
  const [isDragging, setIsDragging] = useState(false);
  const floatingRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });

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
    const container = document.getElementById("stream-fullscreen-container");
    if (!container) return;

    if (displayMode === "fullscreen") {
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {});
      }
      setDisplayMode("normal");
    } else {
      setDisplayMode("floating"); // Exit floating if active
      try {
        await container.requestFullscreen();
        setDisplayMode("fullscreen");
      } catch (err) {
        console.error("Fullscreen failed:", err);
      }
    }
  }, [displayMode]);

  const toggleFloating = useCallback(() => {
    if (displayMode === "floating") {
      setDisplayMode("normal");
    } else {
      if (displayMode === "fullscreen" && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      setDisplayMode("floating");
      // Reset position to bottom-right
      setFloatingPos({ 
        x: window.innerWidth - 340, 
        y: window.innerHeight - 220 
      });
    }
  }, [displayMode]);

  // Dragging logic for floating window
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (displayMode !== "floating") return;
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX - floatingPos.x,
      y: e.clientY - floatingPos.y,
    };
  }, [displayMode, floatingPos]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setFloatingPos({
        x: Math.max(0, Math.min(window.innerWidth - 320, e.clientX - dragStartRef.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 200, e.clientY - dragStartRef.current.y)),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  // Render the stream content
  const renderStreamContent = () => {
    if (!isActive) {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground bg-secondary/30">
          <p className="text-sm">Stream is off</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-destructive bg-destructive/5">
          <p className="text-sm font-medium">Error</p>
          <p className="text-xs max-w-[200px] text-center mt-1">{error}</p>
        </div>
      );
    }

    if (!frame) {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin mb-2" />
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
    <div className="absolute top-2 right-2 flex gap-1 z-10">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 bg-background/60 backdrop-blur hover:bg-background/80"
        onClick={toggleFloating}
        title={displayMode === "floating" ? "Exit floating" : "Floating window"}
      >
        <PictureInPicture2 className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 bg-background/60 backdrop-blur hover:bg-background/80"
        onClick={toggleFullscreen}
        title={displayMode === "fullscreen" ? "Exit fullscreen" : "Fullscreen"}
      >
        {displayMode === "fullscreen" ? (
          <Minimize2 className="h-4 w-4" />
        ) : (
          <Maximize2 className="h-4 w-4" />
        )}
      </Button>
      {displayMode === "floating" && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 bg-background/60 backdrop-blur hover:bg-background/80"
          onClick={() => setDisplayMode("normal")}
          title="Close floating"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );

  // Render stats overlay
  const renderStats = () => {
    if (!isActive || !frame) return null;
    return (
      <div className="absolute top-2 left-2 flex gap-1.5 z-10">
        <Badge variant="outline" className="bg-background/60 backdrop-blur font-mono text-xs px-1.5 py-0.5">
          {fps} FPS
        </Badge>
        <Badge
          variant="outline"
          className={cn(
            "bg-background/60 backdrop-blur font-mono text-xs px-1.5 py-0.5",
            latency > 100 ? "border-destructive text-destructive" :
            latency > 50 ? "border-warning text-warning" :
            "border-primary text-primary"
          )}
        >
          {latency}ms
        </Badge>
      </div>
    );
  };

  // Normal mode - embedded in parent
  if (displayMode === "normal") {
    return (
      <div
        id="stream-fullscreen-container"
        className={cn(
          "relative aspect-video rounded-xl border border-border/50 overflow-hidden bg-secondary/30",
          className
        )}
      >
        {renderStreamContent()}
        {isActive && renderControls()}
        {renderStats()}
      </div>
    );
  }

  // Floating mode - fixed position draggable window
  if (displayMode === "floating") {
    return (
      <>
        {/* Placeholder in normal position */}
        <div
          className={cn(
            "relative aspect-video rounded-xl border border-dashed border-border/50 overflow-hidden bg-secondary/10",
            className
          )}
        >
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
            <PictureInPicture2 className="h-5 w-5 mr-2" />
            Floating mode active
          </div>
        </div>

        {/* Floating window */}
        <div
          ref={floatingRef}
          className="fixed z-50 w-[320px] rounded-lg border border-border shadow-2xl overflow-hidden bg-background"
          style={{
            left: floatingPos.x,
            top: floatingPos.y,
          }}
        >
          {/* Draggable header */}
          <div
            className="flex items-center justify-between px-2 py-1.5 bg-secondary/50 cursor-move select-none"
            onMouseDown={handleMouseDown}
          >
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <Move className="h-3 w-3" />
              {title}
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={toggleFullscreen}
              >
                <Maximize2 className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => setDisplayMode("normal")}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
          {/* Stream content */}
          <div className="relative aspect-video">
            {renderStreamContent()}
            {renderStats()}
          </div>
        </div>
      </>
    );
  }

  // Fullscreen mode
  return (
    <div
      id="stream-fullscreen-container"
      className="relative w-full h-full bg-black"
    >
      {renderStreamContent()}
      {renderControls()}
      {renderStats()}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/60 text-xs">
        Press ESC to exit fullscreen
      </div>
    </div>
  );
}
