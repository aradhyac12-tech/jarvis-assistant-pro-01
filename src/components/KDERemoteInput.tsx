import { useState, useCallback, useRef, useEffect, memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Mouse, Keyboard, Hand, Zap, Wifi, Cloud, Send,
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  Command, CornerDownLeft, Delete,
  Settings, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGestureInput } from "@/hooks/useGestureInput";

interface KDERemoteInputProps {
  onMouseMove: (dx: number, dy: number) => void;
  onScroll: (deltaY: number) => void;
  onZoom: (delta: number) => void;
  onGesture3Finger: () => void;
  onGesture4Finger: (direction: "left" | "right") => void;
  onClick: (button?: "left" | "right" | "middle") => void;
  onDoubleClick?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onKeyPress: (key: string) => void;
  onTypeText?: (text: string) => void;
  connectionMode: string;
  latency: number;
  isConnected: boolean;
  className?: string;
}

function loadSetting<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback; } catch { return fallback; }
}

export const KDERemoteInput = memo(function KDERemoteInput({
  onMouseMove, onScroll, onZoom, onGesture3Finger, onGesture4Finger,
  onClick, onDoubleClick, onDragStart, onDragEnd,
  onKeyPress, onTypeText, connectionMode, latency, isConnected, className,
}: KDERemoteInputProps) {
  const [text, setText] = useState("");
  const [sensitivity, setSensitivity] = useState(() => loadSetting("trackpad_sensitivity", 1.0));
  const [showSettings, setShowSettings] = useState(false);
  const [showFKeys, setShowFKeys] = useState(false);
  const [modifiers, setModifiers] = useState({ ctrl: false, shift: false, alt: false, win: false });
  const inputRef = useRef<HTMLInputElement>(null);

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

  const handleSendText = useCallback(() => {
    if (text.trim() && onTypeText) { onTypeText(text); setText(""); }
  }, [text, onTypeText]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); text.trim() ? handleSendText() : sendKeyWithModifiers("enter"); }
    else if (e.key === "Backspace" && text === "") sendKeyWithModifiers("backspace");
    else if (e.key === "Tab") { e.preventDefault(); sendKeyWithModifiers("tab"); }
    else if (e.key === "Escape") { e.preventDefault(); sendKeyWithModifiers("escape"); }
  }, [text, handleSendText]);

  const toggleModifier = useCallback((mod: keyof typeof modifiers) => {
    setModifiers(prev => ({ ...prev, [mod]: !prev[mod] }));
  }, []);

  const sendKeyWithModifiers = useCallback((key: string) => {
    const mods: string[] = [];
    if (modifiers.ctrl) mods.push("ctrl");
    if (modifiers.shift) mods.push("shift");
    if (modifiers.alt) mods.push("alt");
    if (modifiers.win) mods.push("win");
    if (mods.length > 0) {
      onKeyPress([...mods, key].join("+"));
      setModifiers({ ctrl: false, shift: false, alt: false, win: false });
    } else {
      onKeyPress(key);
    }
  }, [modifiers, onKeyPress]);

  const modeInfo = getModeInfo();

  return (
    <div className={cn("space-y-2", className)}>
      {/* Connection Status Bar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Mouse className="w-4 h-4 text-primary" />
          <span className="text-xs font-medium">Remote Input</span>
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

      {/* Settings Panel */}
      {showSettings && (
        <Card className="border-border/20 bg-card/50">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Sensitivity</span>
              <span className="font-mono text-muted-foreground">{sensitivity.toFixed(1)}x</span>
            </div>
            <Slider
              value={[sensitivity * 10]}
              onValueChange={([v]) => setSensitivity(v / 10)}
              min={3} max={25} step={1}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Precise</span><span>Fast</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* === TRACKPAD === */}
      <div
        className="w-full bg-muted/5 rounded-xl border border-border/20 cursor-crosshair flex flex-col items-center justify-center select-none touch-none relative overflow-hidden"
        style={{ height: "clamp(180px, 40vh, 320px)" }}
        {...gestureInput.touchHandlers}
        {...gestureInput.mouseHandlers}
        onWheel={gestureInput.wheelHandler}
      >
        <Mouse className="w-10 h-10 text-muted-foreground/10" />
        {/* Gesture hints */}
        <div className="absolute bottom-2 left-2 right-2">
          <div className="flex items-center justify-center gap-1 text-[9px] text-muted-foreground/40 bg-background/20 backdrop-blur-sm rounded-md py-1 px-2">
            <Hand className="w-2.5 h-2.5" />
            tap=click · 2tap=dblclick · hold+drag=drag · 2f=scroll · pinch=zoom
          </div>
        </div>
        {gestureInput.haptics.isSupported && (
          <Badge variant="outline" className="absolute top-2 right-2 text-[8px] px-1 py-0 border-primary/20 text-primary/40 bg-background/30">
            Haptic
          </Badge>
        )}
      </div>

      {/* === MOUSE BUTTONS === */}
      <div className="grid grid-cols-3 gap-1.5">
        <Button variant="secondary" className="h-11 text-xs font-medium active:bg-primary/20"
          onClick={() => onClick("left")} disabled={!isConnected}>
          Left
        </Button>
        <Button variant="secondary" className="h-11 text-xs font-medium active:bg-primary/20"
          onClick={() => onClick("middle")} disabled={!isConnected}>
          Middle
        </Button>
        <Button variant="secondary" className="h-11 text-xs font-medium active:bg-primary/20"
          onClick={() => onClick("right")} disabled={!isConnected}>
          Right
        </Button>
      </div>

      {/* === KEYBOARD INPUT === */}
      <div className="relative">
        <Keyboard className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="text"
          placeholder="Type here — sends to PC..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          className="pl-10 pr-12 h-11 text-sm bg-card/50 border-border/20"
          disabled={!isConnected}
          autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
        />
        <Button size="icon" variant="ghost"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9"
          onClick={handleSendText} disabled={!isConnected || !text.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {/* === MODIFIER KEYS === */}
      <div className="grid grid-cols-4 gap-1">
        {([
          { key: "ctrl" as const, label: "Ctrl", icon: <Command className="h-3 w-3" /> },
          { key: "shift" as const, label: "Shift", icon: <ArrowUp className="h-3 w-3" /> },
          { key: "alt" as const, label: "Alt", icon: null },
          { key: "win" as const, label: "⊞ Win", icon: null },
        ]).map(mod => (
          <Button key={mod.key} variant="outline" size="sm"
            className={cn("h-9 text-[11px] font-medium transition-all gap-1",
              modifiers[mod.key] && "bg-primary/20 border-primary/50 text-primary"
            )}
            onClick={() => toggleModifier(mod.key)} disabled={!isConnected}>
            {mod.icon}{mod.label}
          </Button>
        ))}
      </div>

      {/* === SPECIAL KEYS ROW 1: Navigation === */}
      <div className="grid grid-cols-6 gap-1">
        <Button variant="secondary" size="sm" className="h-9 text-[11px]"
          onClick={() => sendKeyWithModifiers("escape")} disabled={!isConnected}>Esc</Button>
        <Button variant="secondary" size="sm" className="h-9 text-[11px]"
          onClick={() => sendKeyWithModifiers("tab")} disabled={!isConnected}>Tab</Button>
        <Button variant="secondary" size="sm" className="h-9 text-[11px]"
          onClick={() => sendKeyWithModifiers("backspace")} disabled={!isConnected}>⌫</Button>
        <Button variant="secondary" size="sm" className="h-9 text-[11px]"
          onClick={() => sendKeyWithModifiers("delete")} disabled={!isConnected}>
          <Delete className="h-3 w-3" />
        </Button>
        <Button variant="secondary" size="sm" className="h-9 text-[11px]"
          onClick={() => sendKeyWithModifiers("home")} disabled={!isConnected}>Home</Button>
        <Button variant="secondary" size="sm" className="h-9 text-[11px]"
          onClick={() => sendKeyWithModifiers("end")} disabled={!isConnected}>End</Button>
      </div>

      {/* === ARROW KEYS + Page Up/Down === */}
      <div className="grid grid-cols-6 gap-1">
        <Button variant="secondary" size="sm" className="h-9 text-[11px]"
          onClick={() => sendKeyWithModifiers("pageup")} disabled={!isConnected}>PgUp</Button>
        <div /> {/* spacer */}
        <Button variant="secondary" size="sm" className="h-10"
          onClick={() => sendKeyWithModifiers("up")} disabled={!isConnected}>
          <ArrowUp className="h-4 w-4" />
        </Button>
        <div /> {/* spacer */}
        <Button variant="secondary" size="sm" className="h-9 text-[11px]"
          onClick={() => sendKeyWithModifiers("pagedown")} disabled={!isConnected}>PgDn</Button>
        <Button variant="default" size="sm" className="h-9 text-[11px] row-span-2"
          onClick={() => sendKeyWithModifiers("enter")} disabled={!isConnected}>
          <CornerDownLeft className="h-3.5 w-3.5" />
        </Button>
        {/* Row 2 of arrows */}
        <Button variant="secondary" size="sm" className="h-9 text-[11px]"
          onClick={() => sendKeyWithModifiers("insert")} disabled={!isConnected}>Ins</Button>
        <Button variant="secondary" size="sm" className="h-10"
          onClick={() => sendKeyWithModifiers("left")} disabled={!isConnected}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="sm" className="h-10"
          onClick={() => sendKeyWithModifiers("down")} disabled={!isConnected}>
          <ArrowDown className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="sm" className="h-10"
          onClick={() => sendKeyWithModifiers("right")} disabled={!isConnected}>
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="sm" className="h-9 text-[11px]"
          onClick={() => sendKeyWithModifiers("printscreen")} disabled={!isConnected}>PrtSc</Button>
      </div>

      {/* === COMMON SHORTCUTS === */}
      <div className="grid grid-cols-4 gap-1">
        {[
          { label: "Copy", key: "ctrl+c" },
          { label: "Paste", key: "ctrl+v" },
          { label: "Cut", key: "ctrl+x" },
          { label: "Undo", key: "ctrl+z" },
          { label: "Redo", key: "ctrl+y" },
          { label: "All", key: "ctrl+a" },
          { label: "Save", key: "ctrl+s" },
          { label: "Find", key: "ctrl+f" },
        ].map(sc => (
          <Button key={sc.key} variant="outline" size="sm"
            className="h-8 text-[10px] font-medium border-border/20"
            onClick={() => onKeyPress(sc.key)} disabled={!isConnected}>
            {sc.label}
          </Button>
        ))}
      </div>

      {/* === F-KEYS (collapsible) === */}
      <Button variant="ghost" size="sm" className="w-full h-7 text-[10px] text-muted-foreground gap-1"
        onClick={() => setShowFKeys(!showFKeys)}>
        {showFKeys ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Function Keys (F1-F12)
      </Button>

      {showFKeys && (
        <div className="grid grid-cols-6 gap-1">
          {Array.from({ length: 12 }, (_, i) => (
            <Button key={`f${i + 1}`} variant="secondary" size="sm"
              className="h-8 text-[10px] font-medium"
              onClick={() => sendKeyWithModifiers(`f${i + 1}`)} disabled={!isConnected}>
              F{i + 1}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
});
