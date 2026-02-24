import { memo, useState, useCallback, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Mouse, Hand, Zap, Wifi, Cloud, Settings,
  ChevronUp, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGestureInput } from "@/hooks/useGestureInput";

interface PureTrackpadProps {
  onMouseMove: (dx: number, dy: number) => void;
  onScroll: (deltaY: number) => void;
  onZoom: (delta: number) => void;
  onGesture3Finger: () => void;
  onGesture4Finger: (direction: "left" | "right") => void;
  onClick: (button?: "left" | "right" | "middle") => void;
  onDoubleClick?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  connectionMode: string;
  latency: number;
  isConnected: boolean;
  className?: string;
}

function loadSetting<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback; } catch { return fallback; }
}

export const PureTrackpad = memo(function PureTrackpad({
  onMouseMove, onScroll, onZoom, onGesture3Finger, onGesture4Finger,
  onClick, onDoubleClick, onDragStart, onDragEnd,
  connectionMode, latency, isConnected, className,
}: PureTrackpadProps) {
  const [sensitivity, setSensitivity] = useState(() => loadSetting("trackpad_sensitivity", 1.0));
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => { localStorage.setItem("trackpad_sensitivity", JSON.stringify(sensitivity)); }, [sensitivity]);

  const gestureInput = useGestureInput({
    onMouseMove,
    onScroll,
    onPinchZoom: onZoom,
    onGesture3Finger,
    onGesture4FingerLeft: () => onGesture4Finger("left"),
    onGesture4FingerRight: () => onGesture4Finger("right"),
    onClick,
    onDoubleClick,
    onDragStart,
    onDragEnd,
  }, sensitivity);

  const getModeInfo = useCallback(() => {
    switch (connectionMode) {
      case "local_p2p": return { icon: <Zap className="h-3 w-3" />, label: "Local", color: "text-emerald-400 border-emerald-500/30" };
      case "p2p": return { icon: <Zap className="h-3 w-3" />, label: "P2P", color: "text-green-400 border-green-500/30" };
      case "websocket": return { icon: <Wifi className="h-3 w-3" />, label: "WS", color: "text-blue-400 border-blue-500/30" };
      case "fallback": return { icon: <Cloud className="h-3 w-3" />, label: "Cloud", color: "text-yellow-400 border-yellow-500/30" };
      default: return null;
    }
  }, [connectionMode]);

  const modeInfo = getModeInfo();

  return (
    <div className={cn("space-y-2", className)}>
      {/* Status Bar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Mouse className="w-4 h-4 text-primary" />
          <span className="text-xs font-medium">Trackpad</span>
        </div>
        <div className="flex items-center gap-2">
          {modeInfo && (
            <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 gap-1", modeInfo.color)}>
              {modeInfo.icon} {modeInfo.label} {latency > 0 ? `${latency}ms` : ""}
            </Badge>
          )}
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowSettings(!showSettings)}>
            <Settings className={cn("h-3.5 w-3.5", showSettings && "text-primary")} />
          </Button>
        </div>
      </div>

      {/* Settings */}
      {showSettings && (
        <Card className="border-border/20 bg-card/50">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Sensitivity</span>
              <span className="font-mono text-muted-foreground">{sensitivity.toFixed(1)}x</span>
            </div>
            <Slider value={[sensitivity * 10]} onValueChange={([v]) => setSensitivity(v / 10)} min={3} max={25} step={1} className="w-full" />
            <div className="flex justify-between text-[10px] text-muted-foreground"><span>Precise</span><span>Fast</span></div>
          </CardContent>
        </Card>
      )}

      {/* TRACKPAD — maximized area */}
      <div
        className="w-full bg-muted/5 rounded-xl border border-border/20 cursor-crosshair flex flex-col items-center justify-center select-none touch-none relative overflow-hidden"
        style={{ height: "clamp(220px, 50vh, 400px)" }}
        {...gestureInput.touchHandlers}
        {...gestureInput.mouseHandlers}
        onWheel={gestureInput.wheelHandler}
      >
        <Mouse className="w-12 h-12 text-muted-foreground/10" />
        <div className="absolute bottom-2 left-2 right-2">
          <div className="flex items-center justify-center gap-1 text-[9px] text-muted-foreground/40 bg-background/20 backdrop-blur-sm rounded-md py-1 px-2">
            <Hand className="w-2.5 h-2.5" />
            tap · 2tap · hold+drag · 2f=scroll · pinch=zoom · 3f=desktop
          </div>
        </div>
        {gestureInput.haptics.isSupported && (
          <Badge variant="outline" className="absolute top-2 right-2 text-[8px] px-1 py-0 border-primary/20 text-primary/40 bg-background/30">
            Haptic
          </Badge>
        )}
      </div>

      {/* MOUSE BUTTONS */}
      <div className="grid grid-cols-3 gap-1.5">
        <Button variant="secondary" className="h-12 text-xs font-medium active:bg-primary/20"
          onClick={() => onClick("left")} disabled={!isConnected}>Left</Button>
        <Button variant="secondary" className="h-12 text-xs font-medium active:bg-primary/20"
          onClick={() => onClick("middle")} disabled={!isConnected}>Middle</Button>
        <Button variant="secondary" className="h-12 text-xs font-medium active:bg-primary/20"
          onClick={() => onClick("right")} disabled={!isConnected}>Right</Button>
      </div>
    </div>
  );
});
