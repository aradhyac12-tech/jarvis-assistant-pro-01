import { useState, useCallback, useRef, useEffect, memo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Send, ArrowUp, Command, Option, CornerDownLeft,
  Zap, MessageSquare, Delete, ArrowLeft, ArrowRight,
  ArrowUpIcon, ArrowDown, Home, MoveHorizontal,
} from "lucide-react";

interface MobileKeyboardProps {
  onKeyPress: (key: string) => void;
  onTypeText?: (text: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * High-performance KDE Connect-style keyboard:
 * - Direct mode: hidden textarea captures native keyboard, batches chars at 80ms
 * - Compose mode: type full message and send at once
 * - Quick-action grid for shortcuts, arrows, modifiers
 */
export const MobileKeyboard = memo(function MobileKeyboard({
  onKeyPress,
  onTypeText,
  disabled,
  className,
}: MobileKeyboardProps) {
  const [mode, setMode] = useState<"direct" | "compose">(() =>
    (localStorage.getItem("keyboard_mode") as "direct" | "compose") || "direct"
  );
  const [composeText, setComposeText] = useState("");
  const [modifiers, setModifiers] = useState({ ctrl: false, shift: false, alt: false, win: false });
  const [keyCount, setKeyCount] = useState(0);

  // Direct mode refs
  const directRef = useRef<HTMLTextAreaElement>(null);
  const composeRef = useRef<HTMLTextAreaElement>(null);
  const batchRef = useRef("");
  const batchTimer = useRef<number | null>(null);
  const BATCH_MS = 80; // batch chars for 80ms then flush

  useEffect(() => {
    localStorage.setItem("keyboard_mode", mode);
  }, [mode]);

  // Auto-focus on mode switch
  useEffect(() => {
    const t = setTimeout(() => {
      if (mode === "direct") directRef.current?.focus();
      else composeRef.current?.focus();
    }, 80);
    return () => clearTimeout(t);
  }, [mode]);

  // ── Direct Mode: batch characters and flush ──
  const flushBatch = useCallback(() => {
    if (batchRef.current && onTypeText) {
      onTypeText(batchRef.current);
      setKeyCount(c => c + batchRef.current.length);
    }
    batchRef.current = "";
    batchTimer.current = null;
  }, [onTypeText]);

  const queueChar = useCallback((char: string) => {
    batchRef.current += char;
    if (batchTimer.current !== null) return;
    batchTimer.current = window.setTimeout(flushBatch, BATCH_MS);
  }, [flushBatch]);

  const handleDirectInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const val = ta.value;
    if (val.length > 0) {
      // Queue all new chars
      queueChar(val);
      // Clear immediately — no delay
      ta.value = "";
    }
  }, [queueChar]);

  const handleDirectKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const key = e.key;
    // Handle special keys directly (not through input event)
    if (key === "Backspace") {
      e.preventDefault();
      sendKey("backspace");
    } else if (key === "Enter") {
      e.preventDefault();
      sendKey("enter");
    } else if (key === "Tab") {
      e.preventDefault();
      sendKey("tab");
    } else if (key === "Escape") {
      e.preventDefault();
      sendKey("escape");
    } else if (key === "ArrowLeft") {
      e.preventDefault();
      sendKey("left");
    } else if (key === "ArrowRight") {
      e.preventDefault();
      sendKey("right");
    } else if (key === "ArrowUp") {
      e.preventDefault();
      sendKey("up");
    } else if (key === "ArrowDown") {
      e.preventDefault();
      sendKey("down");
    }
  }, []);

  // Unified key sender with modifier support
  const sendKey = useCallback((key: string) => {
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
    setKeyCount(c => c + 1);
  }, [modifiers, onKeyPress]);

  // ── Compose Mode ──
  const handleSendCompose = useCallback(() => {
    if (composeText.trim() && onTypeText) {
      onTypeText(composeText);
      setComposeText("");
    }
  }, [composeText, onTypeText]);

  const handleComposeKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendCompose();
    }
  }, [handleSendCompose]);

  const toggleMod = useCallback((mod: keyof typeof modifiers) => {
    setModifiers(prev => ({ ...prev, [mod]: !prev[mod] }));
  }, []);

  // Refocus direct input when tapping quick actions
  const refocusDirect = useCallback(() => {
    if (mode === "direct") {
      setTimeout(() => directRef.current?.focus(), 10);
    }
  }, [mode]);

  const quickSend = useCallback((key: string) => {
    sendKey(key);
    refocusDirect();
  }, [sendKey, refocusDirect]);

  // Cleanup batch timer
  useEffect(() => {
    return () => {
      if (batchTimer.current) {
        clearTimeout(batchTimer.current);
        // Flush remaining on unmount
        if (batchRef.current && onTypeText) {
          onTypeText(batchRef.current);
        }
      }
    };
  }, [onTypeText]);

  return (
    <div className={cn("space-y-3", className)}>
      {/* Mode Toggle */}
      <div className="flex gap-1 p-1 bg-secondary/20 rounded-lg">
        <Button
          variant={mode === "direct" ? "default" : "ghost"}
          size="sm"
          className="flex-1 h-9 text-xs gap-1.5"
          onClick={() => setMode("direct")}
        >
          <Zap className="h-3.5 w-3.5" />
          Direct
        </Button>
        <Button
          variant={mode === "compose" ? "default" : "ghost"}
          size="sm"
          className="flex-1 h-9 text-xs gap-1.5"
          onClick={() => setMode("compose")}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Compose
        </Button>
      </div>

      {/* Direct Mode */}
      {mode === "direct" && (
        <div className="space-y-2">
          <div className="relative">
            <Zap className="absolute left-3 top-3 h-4 w-4 text-primary z-10" />
            <textarea
              ref={directRef}
              className="w-full h-14 pl-10 pr-16 py-3 text-base bg-card/50 border border-primary/30 rounded-md focus:border-primary focus:ring-1 focus:ring-primary/50 text-foreground placeholder:text-muted-foreground outline-none resize-none"
              placeholder="Tap here, then type…"
              onInput={handleDirectInput}
              onKeyDown={handleDirectKeyDown}
              disabled={disabled}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="send"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground font-mono tabular-nums">
              {keyCount} keys
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground text-center">
            Characters are batched &amp; sent instantly — zero input lag
          </p>
        </div>
      )}

      {/* Compose Mode */}
      {mode === "compose" && (
        <div className="space-y-2">
          <div className="relative">
            <Textarea
              ref={composeRef}
              placeholder="Type your message, then send…"
              value={composeText}
              onChange={(e) => setComposeText(e.target.value)}
              onKeyDown={handleComposeKeyDown}
              className="min-h-[80px] text-base bg-card/50 border-border/30 resize-none pr-12"
              disabled={disabled}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <Button
              size="icon"
              variant="default"
              className="absolute right-2 bottom-2 h-9 w-9"
              onClick={handleSendCompose}
              disabled={disabled || !composeText.trim()}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground text-center">
            Press Enter or tap Send to type entire text on PC
          </p>
        </div>
      )}

      {/* Modifier keys */}
      <div className="flex gap-1.5">
        {([
          { key: "ctrl" as const, label: "Ctrl", icon: <Command className="h-3 w-3 mr-1" /> },
          { key: "shift" as const, label: "Shift", icon: <ArrowUp className="h-3 w-3 mr-1" /> },
          { key: "alt" as const, label: "Alt", icon: <Option className="h-3 w-3 mr-1" /> },
          { key: "win" as const, label: "⊞", icon: null },
        ]).map(mod => (
          <Button
            key={mod.key}
            variant="outline"
            size="sm"
            className={cn(
              "flex-1 h-9 text-xs font-medium transition-all",
              modifiers[mod.key] && "bg-primary/20 border-primary/50 text-primary"
            )}
            onClick={() => { toggleMod(mod.key); refocusDirect(); }}
            disabled={disabled}
          >
            {mod.icon}{mod.label}
          </Button>
        ))}
      </div>

      {/* Quick actions — 2 rows */}
      <div className="grid grid-cols-5 gap-1.5">
        {[
          { label: "Ctrl+C", key: "ctrl+c" },
          { label: "Ctrl+V", key: "ctrl+v" },
          { label: "Ctrl+Z", key: "ctrl+z" },
          { label: "Ctrl+A", key: "ctrl+a" },
          { label: "Ctrl+S", key: "ctrl+s" },
          { label: "Tab", key: "tab" },
          { label: "Esc", key: "escape" },
          { label: "Del", key: "delete" },
          { label: "Home", key: "home" },
          { label: "End", key: "end" },
        ].map((a) => (
          <Button
            key={a.key}
            variant="secondary"
            size="sm"
            className="h-9 text-[10px] font-medium"
            onClick={() => quickSend(a.key)}
            disabled={disabled}
          >
            {a.label}
          </Button>
        ))}
      </div>

      {/* Arrow keys + Backspace + Enter row */}
      <div className="grid grid-cols-6 gap-1.5">
        <Button variant="secondary" size="sm" className="h-10" onClick={() => quickSend("backspace")} disabled={disabled}>
          <Delete className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="sm" className="h-10" onClick={() => quickSend("left")} disabled={disabled}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="sm" className="h-10" onClick={() => quickSend("down")} disabled={disabled}>
          <ArrowDown className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="sm" className="h-10" onClick={() => quickSend("up")} disabled={disabled}>
          <ArrowUpIcon className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="sm" className="h-10" onClick={() => quickSend("right")} disabled={disabled}>
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button variant="default" size="sm" className="h-10" onClick={() => quickSend("enter")} disabled={disabled}>
          <CornerDownLeft className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
});
