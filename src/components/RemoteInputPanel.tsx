import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Mouse,
  Keyboard,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Maximize2,
  Minimize2,
  Zap,
  Wifi,
  Cloud,
  Hand,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useP2PCommand } from "@/hooks/useP2PCommand";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useGestureInput } from "@/hooks/useGestureInput";

interface RemoteInputPanelProps {
  className?: string;
  compact?: boolean;
}

export function RemoteInputPanel({ className, compact = false }: RemoteInputPanelProps) {
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();
  const { 
    fireMouse, 
    fireKey, 
    fireClick, 
    fireScroll, 
    fireZoom,
    fireGesture3Finger,
    fireGesture4Finger,
    connectionMode, 
    latency 
  } = useP2PCommand();

  const getModeIcon = () => {
    switch (connectionMode) {
      case "local_p2p": return <Zap className="h-3 w-3 text-emerald-400" />;
      case "p2p": return <Zap className="h-3 w-3 text-green-400" />;
      case "websocket": return <Wifi className="h-3 w-3 text-blue-400" />;
      case "fallback": return <Cloud className="h-3 w-3 text-yellow-400" />;
      default: return null;
    }
  };

  const getModeLabel = () => {
    switch (connectionMode) {
      case "local_p2p": return "Local";
      case "p2p": return "P2P";
      case "websocket": return "WS";
      case "fallback": return "Cloud";
      default: return "";
    }
  };

  const [textInput, setTextInput] = useState("");
  const [isExpanded, setIsExpanded] = useState(!compact);

  const isConnected = selectedDevice?.is_online || false;

  // Gesture handlers using the new gesture detection hook
  const gestureInput = useGestureInput({
    onMouseMove: fireMouse,
    onScroll: fireScroll,
    onPinchZoom: fireZoom,
    onGesture3Finger: fireGesture3Finger,
    onGesture4FingerLeft: () => fireGesture4Finger("left"),
    onGesture4FingerRight: () => fireGesture4Finger("right"),
    onClick: fireClick,
  });

  const quickKeys = [
    { label: "Enter", key: "enter" },
    { label: "Esc", key: "escape" },
    { label: "Tab", key: "tab" },
    { label: "⌫", key: "backspace" },
    { label: "Ctrl+C", key: "ctrl+c" },
    { label: "Ctrl+V", key: "ctrl+v" },
    { label: "Alt+Tab", key: "alt+tab" },
    { label: "Win", key: "win" },
  ];

  // Send text
  const sendText = () => {
    if (!textInput.trim()) return;
    sendCommand("type_text", { text: textInput });
    setTextInput("");
    toast({ title: "Text sent" });
  };

  if (compact && !isExpanded) {
    return (
      <Card className={cn("border-border/40", className)}>
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mouse className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Remote Input</span>
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
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsExpanded(true)}>
              <Maximize2 className="h-3 w-3" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("border-border/40", className)}>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">Remote Input</CardTitle>
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
          {compact && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsExpanded(false)}>
              <Minimize2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-0 space-y-3">
        {/* Trackpad with gesture support */}
        <div
          className="aspect-[16/9] bg-muted/30 rounded-lg border border-dashed border-border/60 cursor-crosshair flex flex-col items-center justify-center select-none touch-none relative overflow-hidden"
          {...gestureInput.touchHandlers}
          {...gestureInput.mouseHandlers}
          onWheel={gestureInput.wheelHandler}
        >
          <Mouse className="w-6 h-6 text-muted-foreground/30" />
          <div className="absolute bottom-2 left-2 right-2">
            <div className="flex items-center justify-center gap-1 text-[9px] text-muted-foreground/50">
              <Hand className="w-3 h-3" />
              <span>1 tap=click • 2 tap=right • 2f=scroll • pinch=zoom • 3f↓=desktop • 4f↔=switch</span>
            </div>
          </div>
        </div>

        {/* Mouse buttons */}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="sm" onClick={() => fireClick("left")} disabled={!isConnected}>
            Left Click
          </Button>
          <Button variant="secondary" size="sm" onClick={() => fireClick("right")} disabled={!isConnected}>
            Right Click
          </Button>
        </div>

        {/* Text input */}
        <div className="flex gap-2">
          <Input
            placeholder="Type text..."
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendText()}
            className="flex-1 h-8 text-xs"
            disabled={!isConnected}
          />
          <Button onClick={sendText} disabled={!isConnected} size="sm" className="h-8 px-3">
            <Keyboard className="w-3 h-3" />
          </Button>
        </div>

        {/* Quick keys */}
        <div className="grid grid-cols-4 gap-1">
          {quickKeys.map((k) => (
            <Button
              key={k.key}
              variant="outline"
              size="sm"
              className="text-[10px] h-7 px-1"
              onClick={() => fireKey(k.key)}
              disabled={!isConnected}
            >
              {k.label}
            </Button>
          ))}
        </div>

        {/* Arrow keys */}
        <div className="flex justify-center">
          <div className="grid grid-cols-3 gap-1 w-fit">
            <div />
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => fireKey("up")} disabled={!isConnected}>
              <ArrowUp className="w-3 h-3" />
            </Button>
            <div />
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => fireKey("left")} disabled={!isConnected}>
              <ArrowLeft className="w-3 h-3" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => fireKey("down")} disabled={!isConnected}>
              <ArrowDown className="w-3 h-3" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => fireKey("right")} disabled={!isConnected}>
              <ArrowRight className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
