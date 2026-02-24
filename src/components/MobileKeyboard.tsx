import { useState, useCallback, useRef, useEffect, memo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Keyboard, Send, ArrowUp, Command, Option, CornerDownLeft, Zap, MessageSquare } from "lucide-react";

interface MobileKeyboardProps {
  onKeyPress: (key: string) => void;
  onTypeText?: (text: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * KDE Connect-style keyboard with two modes:
 * 1. Direct mode: Each keystroke is sent immediately to PC (like KDE Connect)
 * 2. Compose mode: Type a message and send it all at once
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
  const directInputRef = useRef<HTMLInputElement>(null);
  const composeRef = useRef<HTMLTextAreaElement>(null);
  const lastValueRef = useRef("");

  useEffect(() => {
    localStorage.setItem("keyboard_mode", mode);
  }, [mode]);

  // Focus input on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      if (mode === "direct") directInputRef.current?.focus();
      else composeRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [mode]);

  // Direct mode: send each new character immediately as typed
  const handleDirectInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    const oldValue = lastValueRef.current;

    if (newValue.length > oldValue.length) {
      // Characters added — send each new character
      const added = newValue.slice(oldValue.length);
      for (const char of added) {
        if (onTypeText) {
          onTypeText(char);
        }
      }
    } else if (newValue.length < oldValue.length) {
      // Characters removed — send backspace for each deleted char
      const deleted = oldValue.length - newValue.length;
      for (let i = 0; i < deleted; i++) {
        onKeyPress("backspace");
      }
    }

    lastValueRef.current = newValue;
    // Keep input cleared to avoid accumulation — slight delay to allow native keyboard to work
    setTimeout(() => {
      if (directInputRef.current) {
        directInputRef.current.value = "";
        lastValueRef.current = "";
      }
    }, 50);
  }, [onKeyPress, onTypeText]);

  const handleDirectKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendKeyWithModifiers("enter");
    } else if (e.key === "Backspace") {
      // Don't double-send — handled by input change
    } else if (e.key === "Tab") {
      e.preventDefault();
      sendKeyWithModifiers("tab");
    } else if (e.key === "Escape") {
      e.preventDefault();
      sendKeyWithModifiers("escape");
    }
  }, []);

  // Compose mode handlers
  const handleSendCompose = useCallback(() => {
    if (composeText.trim() && onTypeText) {
      onTypeText(composeText);
      setComposeText("");
    }
  }, [composeText, onTypeText]);

  const handleComposeKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Enter or just Enter (without Shift) sends the message
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendCompose();
    }
  }, [handleSendCompose]);

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

  const quickActions = [
    { label: "Ctrl+C", key: "ctrl+c" },
    { label: "Ctrl+V", key: "ctrl+v" },
    { label: "Ctrl+Z", key: "ctrl+z" },
    { label: "Tab", key: "tab" },
    { label: "Esc", key: "escape" },
    { label: "⌫", key: "backspace" },
    { label: "←", key: "left" },
    { label: "→", key: "right" },
    { label: "↑", key: "up" },
    { label: "↓", key: "down" },
  ];

  return (
    <div className={cn("space-y-3", className)}>
      {/* Mode Toggle */}
      <div className="flex gap-1 p-1 bg-secondary/20 rounded-lg">
        <Button
          variant={mode === "direct" ? "default" : "ghost"}
          size="sm"
          className="flex-1 h-8 text-xs gap-1.5"
          onClick={() => setMode("direct")}
        >
          <Zap className="h-3.5 w-3.5" />
          Direct Input
        </Button>
        <Button
          variant={mode === "compose" ? "default" : "ghost"}
          size="sm"
          className="flex-1 h-8 text-xs gap-1.5"
          onClick={() => setMode("compose")}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Compose
        </Button>
      </div>

      {/* Direct Mode — each keystroke sent immediately */}
      {mode === "direct" && (
        <div className="space-y-2">
          <div className="relative">
            <Zap className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
            <Input
              ref={directInputRef}
              type="text"
              placeholder="Type — each key goes to PC instantly..."
              onChange={handleDirectInput}
              onKeyDown={handleDirectKeyDown}
              className="pl-10 h-12 text-base bg-card/50 border-primary/30 focus:border-primary"
              disabled={disabled}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
            />
          </div>
          <p className="text-[10px] text-muted-foreground text-center">
            Each character is sent to your PC as you type — like KDE Connect
          </p>
        </div>
      )}

      {/* Compose Mode — type message, then send */}
      {mode === "compose" && (
        <div className="space-y-2">
          <div className="relative">
            <Textarea
              ref={composeRef}
              placeholder="Compose a message and send it all at once..."
              value={composeText}
              onChange={(e) => setComposeText(e.target.value)}
              onKeyDown={handleComposeKeyDown}
              className="min-h-[80px] text-base bg-card/50 border-border/30 resize-none pr-12"
              disabled={disabled}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
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
            onClick={() => toggleModifier(mod.key)}
            disabled={disabled}
          >
            {mod.icon}{mod.label}
          </Button>
        ))}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-5 gap-1.5">
        {quickActions.map((action) => (
          <Button
            key={action.key}
            variant="secondary"
            size="sm"
            className="h-9 text-xs font-medium"
            onClick={() => sendKeyWithModifiers(action.key)}
            disabled={disabled}
          >
            {action.label}
          </Button>
        ))}
      </div>

      {/* Enter key */}
      <Button
        variant="default"
        className="w-full h-10"
        onClick={() => sendKeyWithModifiers("enter")}
        disabled={disabled}
      >
        <CornerDownLeft className="h-4 w-4 mr-2" />
        Enter
      </Button>
    </div>
  );
});
