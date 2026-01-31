import { useState, useCallback, useRef, useEffect, memo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Keyboard, Send, ArrowUp, Command, Option, CornerDownLeft } from "lucide-react";

interface MobileKeyboardProps {
  onKeyPress: (key: string) => void;
  onTypeText?: (text: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * KDE Connect-style keyboard that uses the native mobile keyboard.
 * Simple text input that sends to PC when user types.
 */
export const MobileKeyboard = memo(function MobileKeyboard({
  onKeyPress,
  onTypeText,
  disabled,
  className,
}: MobileKeyboardProps) {
  const [text, setText] = useState("");
  const [modifiers, setModifiers] = useState({
    ctrl: false,
    shift: false,
    alt: false,
    win: false,
  });
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount for quick typing
  useEffect(() => {
    // Small delay to prevent layout shifts
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const handleSendText = useCallback(() => {
    if (text.trim() && onTypeText) {
      onTypeText(text);
      setText("");
    }
  }, [text, onTypeText]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (text.trim()) {
        handleSendText();
      } else {
        onKeyPress("enter");
      }
    } else if (e.key === "Backspace" && text === "") {
      onKeyPress("backspace");
    } else if (e.key === "Tab") {
      e.preventDefault();
      onKeyPress("tab");
    } else if (e.key === "Escape") {
      e.preventDefault();
      onKeyPress("escape");
    }
  }, [text, handleSendText, onKeyPress]);

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

  // Quick action buttons
  const quickActions = [
    { label: "Ctrl+C", key: "ctrl+c", icon: null },
    { label: "Ctrl+V", key: "ctrl+v", icon: null },
    { label: "Ctrl+Z", key: "ctrl+z", icon: null },
    { label: "Tab", key: "tab", icon: null },
    { label: "Esc", key: "escape", icon: null },
    { label: "⌫", key: "backspace", icon: null },
    { label: "←", key: "left", icon: null },
    { label: "→", key: "right", icon: null },
    { label: "↑", key: "up", icon: null },
    { label: "↓", key: "down", icon: null },
  ];

  return (
    <div className={cn("space-y-3", className)}>
      {/* Main text input - uses native mobile keyboard */}
      <div className="relative">
        <Keyboard className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="text"
          placeholder="Type here..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          className="pl-10 pr-12 h-12 text-base bg-card/50 border-border/30"
          disabled={disabled}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
        />
        <Button
          size="icon"
          variant="ghost"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-10 w-10"
          onClick={handleSendText}
          disabled={disabled || !text.trim()}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {/* Modifier keys */}
      <div className="flex gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "flex-1 h-9 text-xs font-medium transition-all",
            modifiers.ctrl && "bg-primary/20 border-primary/50 text-primary"
          )}
          onClick={() => toggleModifier("ctrl")}
          disabled={disabled}
        >
          <Command className="h-3 w-3 mr-1" />
          Ctrl
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "flex-1 h-9 text-xs font-medium transition-all",
            modifiers.shift && "bg-primary/20 border-primary/50 text-primary"
          )}
          onClick={() => toggleModifier("shift")}
          disabled={disabled}
        >
          <ArrowUp className="h-3 w-3 mr-1" />
          Shift
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "flex-1 h-9 text-xs font-medium transition-all",
            modifiers.alt && "bg-primary/20 border-primary/50 text-primary"
          )}
          onClick={() => toggleModifier("alt")}
          disabled={disabled}
        >
          <Option className="h-3 w-3 mr-1" />
          Alt
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "flex-1 h-9 text-xs font-medium transition-all",
            modifiers.win && "bg-primary/20 border-primary/50 text-primary"
          )}
          onClick={() => toggleModifier("win")}
          disabled={disabled}
        >
          ⊞
        </Button>
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
