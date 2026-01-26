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
  const floatingRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const resizeStartRef = useRef({ width: 0, height: 0, x: 0, y: 0 });

  const pinnedStream = pinnedStreamId ? activeStreams.get(pinnedStreamId) : null;
  const streamList = Array.from(activeStreams.values()).filter(s => s.isActive);

  // Dragging logic
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX - floatingPosition.x,
      y: e.clientY - floatingPosition.y,
    };
  }, [floatingPosition]);

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
        setFloatingPosition({
          x: Math.max(0, Math.min(window.innerWidth - floatingSize.width, e.clientX - dragStartRef.current.x)),
          y: Math.max(0, Math.min(window.innerHeight - floatingSize.height - 40, e.clientY - dragStartRef.current.y)),
        });
      }
      if (isResizing) {
        const deltaX = e.clientX - resizeStartRef.current.x;
        const deltaY = e.clientY - resizeStartRef.current.y;
        const newWidth = Math.max(280, Math.min(960, resizeStartRef.current.width + deltaX));
        const newHeight = Math.max(160, Math.min(720, resizeStartRef.current.height + deltaY));
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

  // Moved switch stream inside callback above
  return (
    <div
      ref={floatingRef}
      className="fixed z-[9999] rounded-xl border border-white/10 shadow-2xl overflow-hidden bg-black"
      style={{
        left: floatingPosition.x,
        top: floatingPosition.y,
        width: floatingSize.width,
        height: floatingSize.height,
      }}
    >
      {/* Draggable header */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 py-2 bg-gradient-to-b from-black/90 to-transparent cursor-move z-20"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2 text-white/80 text-xs font-medium">
          <Move className="h-3 w-3" />
          {pinnedStream.title}
          <Badge variant="outline" className="bg-black/50 border-white/20 text-white/70 text-[10px] px-1.5 py-0">
            {pinnedStream.fps} FPS
          </Badge>
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
        <div className="flex gap-1">
          {streamList.length > 1 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-white/80 hover:text-white hover:bg-white/10"
                onClick={() => switchStream("prev")}
              >
                <ChevronLeft className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-white/80 hover:text-white hover:bg-white/10"
                onClick={() => switchStream("next")}
              >
                <ChevronRight className="h-3 w-3" />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-white/80 hover:text-white hover:bg-white/10"
            onClick={toggleLandscape}
            title={isLandscape ? "Portrait" : "Landscape"}
          >
            <RotateCw className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-white/80 hover:text-white hover:bg-white/10"
            onClick={() => setFloating(false)}
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
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white/50 text-sm">
            Waiting for frames...
          </div>
        )}
      </div>

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-6 h-6 cursor-se-resize z-20 flex items-center justify-center"
        onMouseDown={handleResizeStart}
      >
        <GripVertical className="h-4 w-4 text-white/30 rotate-[-45deg]" />
      </div>

      {/* Stream indicator */}
      {streamList.length > 1 && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
          {streamList.map((s) => (
            <button
              key={s.id}
              onClick={() => pinStream(s.id)}
              className={cn(
                "w-2 h-2 rounded-full transition-colors",
                s.id === pinnedStreamId ? "bg-primary" : "bg-white/30 hover:bg-white/50"
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
