import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  X,
  Move,
  GripVertical,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGlobalPiP } from "@/contexts/GlobalPiPContext";

export function GlobalFloatingPiP() {
  const {
    activeStreams,
    pinnedStreamId,
    isFloating,
    floatingPosition,
    floatingSize,
    isLandscape,
    pinStream,
    setFloating,
    setFloatingPosition,
    setFloatingSize,
    toggleLandscape,
  } = useGlobalPiP();

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const floatingRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const resizeStartRef = useRef({ width: 0, height: 0, x: 0, y: 0 });

  const pinnedStream = pinnedStreamId ? activeStreams.get(pinnedStreamId) : null;
  const streamList = Array.from(activeStreams.values()).filter(s => s.isActive);

  // Mouse/touch dragging
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    const point = "touches" in e ? e.touches[0] : e;
    dragStartRef.current = {
      x: point.clientX - floatingPosition.x,
      y: point.clientY - floatingPosition.y,
    };
  }, [floatingPosition]);

  // Resize logic
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

  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      const point = "touches" in e ? e.touches[0] : e;
      
      if (isDragging) {
        const newX = Math.max(0, Math.min(window.innerWidth - floatingSize.width, point.clientX - dragStartRef.current.x));
        const newY = Math.max(0, Math.min(window.innerHeight - floatingSize.height - 40, point.clientY - dragStartRef.current.y));
        setFloatingPosition({ x: newX, y: newY });
      }
      
      if (isResizing) {
        const deltaX = point.clientX - resizeStartRef.current.x;
        const deltaY = point.clientY - resizeStartRef.current.y;
        const newWidth = Math.max(200, Math.min(960, resizeStartRef.current.width + deltaX));
        const newHeight = Math.max(120, Math.min(720, resizeStartRef.current.height + deltaY));
        setFloatingSize({ width: newWidth, height: newHeight });
      }
    };

    const handleEnd = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    // Add both mouse and touch listeners
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
  }, [isDragging, isResizing, floatingSize, setFloatingPosition, setFloatingSize]);

  // Switch to next/prev stream
  const switchStream = useCallback((direction: "next" | "prev") => {
    const idx = streamList.findIndex(s => s.id === pinnedStreamId);
    if (idx === -1) return;
    
    const newIdx = direction === "next" 
      ? (idx + 1) % streamList.length
      : (idx - 1 + streamList.length) % streamList.length;
    
    pinStream(streamList[newIdx].id);
  }, [streamList, pinnedStreamId, pinStream]);

  // Hide if no pinned stream or not floating
  if (!isFloating || !pinnedStream) return null;

  // Minimized state
  if (isMinimized) {
    return (
      <div
        className="fixed z-[9999] bottom-20 right-4 rounded-full bg-black/90 border border-white/20 shadow-lg cursor-pointer flex items-center gap-2 px-3 py-2"
        onClick={() => setIsMinimized(false)}
      >
        <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
        <span className="text-white/80 text-xs font-medium">{pinnedStream.title}</span>
        <Maximize2 className="w-3 h-3 text-white/60" />
      </div>
    );
  }

  return (
    <div
      ref={floatingRef}
      className={cn(
        "fixed z-[9999] rounded-xl border border-white/10 shadow-2xl overflow-hidden bg-black",
        isDragging && "cursor-grabbing",
        isResizing && "cursor-se-resize"
      )}
      style={{
        left: floatingPosition.x,
        top: floatingPosition.y,
        width: floatingSize.width,
        height: floatingSize.height,
        transition: isDragging || isResizing ? "none" : "box-shadow 0.2s",
      }}
    >
      {/* Draggable header */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 py-2 bg-gradient-to-b from-black/90 to-transparent cursor-grab z-20"
        onMouseDown={handleDragStart}
        onTouchStart={handleDragStart}
      >
        <div className="flex items-center gap-2 text-white/80 text-xs font-medium">
          <Move className="h-3 w-3" />
          <span className="truncate max-w-[120px]">{pinnedStream.title}</span>
          {pinnedStream.fps > 0 && (
            <Badge variant="outline" className="bg-black/50 border-white/20 text-white/70 text-[10px] px-1.5 py-0">
              {pinnedStream.fps} FPS
            </Badge>
          )}
          {pinnedStream.latency > 0 && (
            <Badge 
              variant="outline" 
              className={cn(
                "bg-black/50 border-transparent text-[10px] px-1.5 py-0",
                pinnedStream.latency > 100 ? "text-destructive" : 
                pinnedStream.latency > 50 ? "text-warning" : "text-primary"
              )}
            >
              {pinnedStream.latency}ms
            </Badge>
          )}
        </div>
        <div className="flex gap-0.5">
          {streamList.length > 1 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-white/80 hover:text-white hover:bg-white/10"
                onClick={(e) => { e.stopPropagation(); switchStream("prev"); }}
              >
                <ChevronLeft className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-white/80 hover:text-white hover:bg-white/10"
                onClick={(e) => { e.stopPropagation(); switchStream("next"); }}
              >
                <ChevronRight className="h-3 w-3" />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-white/80 hover:text-white hover:bg-white/10"
            onClick={(e) => { e.stopPropagation(); toggleLandscape(); }}
            title={isLandscape ? "Portrait" : "Landscape"}
          >
            <RotateCw className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-white/80 hover:text-white hover:bg-white/10"
            onClick={(e) => { e.stopPropagation(); setIsMinimized(true); }}
          >
            <Minimize2 className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-white/80 hover:text-white hover:bg-white/10"
            onClick={(e) => { e.stopPropagation(); setFloating(false); }}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Stream content */}
      <div className="relative w-full h-full">
        {pinnedStream.frame ? (
          <img
            src={pinnedStream.frame}
            alt={pinnedStream.title}
            className="w-full h-full object-contain"
            draggable={false}
            style={{ imageRendering: "auto" }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white/50 text-sm">
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-white/30 border-t-white/80 rounded-full animate-spin" />
              <span>Waiting for frames...</span>
            </div>
          </div>
        )}
      </div>

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-8 h-8 cursor-se-resize z-20 flex items-end justify-end p-1"
        onMouseDown={handleResizeStart}
        onTouchStart={handleResizeStart}
      >
        <GripVertical className="h-4 w-4 text-white/30 rotate-[-45deg]" />
      </div>

      {/* Stream indicator dots */}
      {streamList.length > 1 && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 z-20">
          {streamList.map((s) => (
            <button
              key={s.id}
              onClick={(e) => { e.stopPropagation(); pinStream(s.id); }}
              className={cn(
                "w-2 h-2 rounded-full transition-all",
                s.id === pinnedStreamId 
                  ? "bg-primary scale-125" 
                  : "bg-white/30 hover:bg-white/50"
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
