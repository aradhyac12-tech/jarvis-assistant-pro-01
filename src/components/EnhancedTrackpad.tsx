import { useCallback, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import {
  Mouse,
  Keyboard,
  Hand,
  Zap,
  Wifi,
  Cloud,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGestureInput } from "@/hooks/useGestureInput";

interface EnhancedTrackpadProps {
  onMouseMove: (dx: number, dy: number) => void;
  onScroll: (deltaY: number) => void;
  onZoom: (delta: number) => void;
  onGesture3Finger: () => void;
  onGesture4Finger: (direction: "left" | "right") => void;
  onClick: (button?: "left" | "right" | "middle") => void;
  onTypeText?: (text: string) => void;
  connectionMode: string;
  latency: number;
  isConnected: boolean;
  className?: string;
}

export const EnhancedTrackpad = memo(function EnhancedTrackpad({
  onMouseMove,
  onScroll,
  onZoom,
  onGesture3Finger,
  onGesture4Finger,
  onClick,
  onTypeText,
  connectionMode,
  latency,
  isConnected,
  className,
}: EnhancedTrackpadProps) {
  const [textInput, setTextInput] = useState("");

  const gestureInput = useGestureInput({
    onMouseMove,
    onScroll,
    onPinchZoom: onZoom,
    onGesture3Finger,
    onGesture4FingerLeft: () => onGesture4Finger("left"),
    onGesture4FingerRight: () => onGesture4Finger("right"),
    onClick,
  });

  const getModeIcon = useCallback(() => {
    switch (connectionMode) {
      case "local_p2p": return <Zap className="h-3 w-3 text-emerald-400" />;
      case "p2p": return <Zap className="h-3 w-3 text-green-400" />;
      case "websocket": return <Wifi className="h-3 w-3 text-blue-400" />;
      case "fallback": return <Cloud className="h-3 w-3 text-yellow-400" />;
      default: return null;
    }
  }, [connectionMode]);

  const getModeLabel = useCallback(() => {
    switch (connectionMode) {
      case "local_p2p": return "Local";
      case "p2p": return "P2P";
      case "websocket": return "WS";
      case "fallback": return "Cloud";
      default: return "";
    }
  }, [connectionMode]);

  const handleSendText = useCallback(() => {
    if (textInput.trim() && onTypeText) {
      onTypeText(textInput);
      setTextInput("");
    }
  }, [textInput, onTypeText]);

  return (
    <Card className={cn("border-border/30 bg-card/50", className)}>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Mouse className="w-4 h-4" />
            Trackpad
          </CardTitle>
          {connectionMode !== "disconnected" && (
            <Badge 
              variant="outline" 
              className={cn(
                "text-[10px] px-1.5 py-0 gap-1",
                connectionMode === "local_p2p" && "border-emerald-500/30 text-emerald-400",
                connectionMode === "p2p" && "border-green-500/30 text-green-400",
                connectionMode === "websocket" && "border-blue-500/30 text-blue-400",
                connectionMode === "fallback" && "border-yellow-500/30 text-yellow-400"
              )}
            >
              {getModeIcon()}
              {getModeLabel()} {latency > 0 ? `${latency}ms` : ""}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-0 space-y-3">
      {/* Trackpad Area - Sized to screen ratio */}
      <div
        className="aspect-[16/10] w-full max-h-[45vh] bg-muted/20 rounded-xl border border-dashed border-border/40 cursor-crosshair flex flex-col items-center justify-center select-none touch-none relative overflow-hidden"
        {...gestureInput.touchHandlers}
        {...gestureInput.mouseHandlers}
        onWheel={gestureInput.wheelHandler}
      >
          <Mouse className="w-8 h-8 text-muted-foreground/20" />
          <div className="absolute bottom-3 left-3 right-3">
            <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/60 bg-background/30 backdrop-blur-sm rounded-lg py-1.5 px-2">
              <Hand className="w-3 h-3" />
              <span>1tap=click • 2tap=right • 2f=scroll • pinch=zoom • 3f↓=desktop • 4f↔=switch</span>
            </div>
          </div>
          {gestureInput.haptics.isSupported && (
            <div className="absolute top-2 right-2">
              <Badge variant="outline" className="text-[8px] px-1.5 py-0.5 border-primary/30 text-primary/60 bg-background/50">
                Haptic
              </Badge>
            </div>
          )}
        </div>

        {/* Mouse Buttons */}
        <div className="grid grid-cols-3 gap-2">
          <Button 
            variant="secondary" 
            size="sm" 
            className="h-10"
            onClick={() => onClick("left")} 
            disabled={!isConnected}
          >
            Left Click
          </Button>
          <Button 
            variant="secondary" 
            size="sm" 
            className="h-10"
            onClick={() => onClick("middle")} 
            disabled={!isConnected}
          >
            Middle
          </Button>
          <Button 
            variant="secondary" 
            size="sm" 
            className="h-10"
            onClick={() => onClick("right")} 
            disabled={!isConnected}
          >
            Right Click
          </Button>
        </div>

        {/* Quick Text Input */}
        <div className="flex gap-2">
          <Input
            placeholder="Type and send..."
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendText()}
            className="flex-1 h-9 text-xs bg-background/50"
            disabled={!isConnected}
          />
          <Button 
            onClick={handleSendText} 
            disabled={!isConnected || !textInput.trim()} 
            size="icon" 
            className="h-9 w-9 shrink-0"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
});
