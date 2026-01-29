import { useState, useCallback, memo } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface KDEKeyboardProps {
  onKeyPress: (key: string) => void;
  disabled?: boolean;
  className?: string;
}

const KeyButton = memo(({ 
  label, 
  keyVal, 
  width = "w-8", 
  onKeyPress, 
  disabled,
  isActive = false,
}: { 
  label: string; 
  keyVal: string; 
  width?: string; 
  onKeyPress: (key: string) => void; 
  disabled?: boolean;
  isActive?: boolean;
}) => (
  <Button
    variant="outline"
    size="sm"
    className={cn(
      "h-8 text-[10px] font-medium border-border/30 bg-card/50 hover:bg-secondary/80 active:scale-95 transition-all",
      width,
      isActive && "bg-primary/20 border-primary/50 text-primary"
    )}
    onClick={() => onKeyPress(keyVal)}
    disabled={disabled}
  >
    {label}
  </Button>
));
KeyButton.displayName = "KeyButton";

export function KDEKeyboard({ onKeyPress, disabled, className }: KDEKeyboardProps) {
  const [modifiers, setModifiers] = useState({
    ctrl: false,
    shift: false,
    alt: false,
    win: false,
  });

  const handleKeyPress = useCallback((key: string) => {
    // Build key combo with active modifiers
    const mods: string[] = [];
    if (modifiers.ctrl) mods.push("ctrl");
    if (modifiers.shift) mods.push("shift");
    if (modifiers.alt) mods.push("alt");
    if (modifiers.win) mods.push("win");

    if (mods.length > 0 && !["ctrl", "shift", "alt", "win"].includes(key)) {
      onKeyPress([...mods, key].join("+"));
      // Reset modifiers after combo
      setModifiers({ ctrl: false, shift: false, alt: false, win: false });
    } else {
      onKeyPress(key);
    }
  }, [modifiers, onKeyPress]);

  const toggleModifier = useCallback((mod: keyof typeof modifiers) => {
    setModifiers(prev => ({ ...prev, [mod]: !prev[mod] }));
  }, []);

  // Function keys
  const fnKeys = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"];

  // Number row
  const numRow = [
    { l: "`", k: "grave" }, { l: "1", k: "1" }, { l: "2", k: "2" }, { l: "3", k: "3" },
    { l: "4", k: "4" }, { l: "5", k: "5" }, { l: "6", k: "6" }, { l: "7", k: "7" },
    { l: "8", k: "8" }, { l: "9", k: "9" }, { l: "0", k: "0" }, { l: "-", k: "minus" },
    { l: "=", k: "equal" }, { l: "⌫", k: "backspace", w: "w-12" },
  ];

  // QWERTY rows
  const row1 = [
    { l: "Tab", k: "tab", w: "w-10" }, { l: "Q", k: "q" }, { l: "W", k: "w" }, { l: "E", k: "e" },
    { l: "R", k: "r" }, { l: "T", k: "t" }, { l: "Y", k: "y" }, { l: "U", k: "u" },
    { l: "I", k: "i" }, { l: "O", k: "o" }, { l: "P", k: "p" }, { l: "[", k: "bracketleft" },
    { l: "]", k: "bracketright" }, { l: "\\", k: "backslash" },
  ];

  const row2 = [
    { l: "A", k: "a" }, { l: "S", k: "s" }, { l: "D", k: "d" }, { l: "F", k: "f" },
    { l: "G", k: "g" }, { l: "H", k: "h" }, { l: "J", k: "j" }, { l: "K", k: "k" },
    { l: "L", k: "l" }, { l: ";", k: "semicolon" }, { l: "'", k: "quote" },
    { l: "Enter", k: "enter", w: "w-14" },
  ];

  const row3 = [
    { l: "Z", k: "z" }, { l: "X", k: "x" }, { l: "C", k: "c" }, { l: "V", k: "v" },
    { l: "B", k: "b" }, { l: "N", k: "n" }, { l: "M", k: "m" }, { l: ",", k: "comma" },
    { l: ".", k: "period" }, { l: "/", k: "slash" },
  ];

  // Navigation keys
  const navKeys = [
    { l: "↑", k: "up" }, { l: "↓", k: "down" }, { l: "←", k: "left" }, { l: "→", k: "right" },
    { l: "Home", k: "home" }, { l: "End", k: "end" }, { l: "PgUp", k: "pageup" }, { l: "PgDn", k: "pagedown" },
    { l: "Ins", k: "insert" }, { l: "Del", k: "delete" },
  ];

  return (
    <div className={cn("space-y-2", className)}>
      {/* Function Keys */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        <KeyButton label="Esc" keyVal="escape" onKeyPress={handleKeyPress} disabled={disabled} />
        <div className="w-2" />
        {fnKeys.map(fk => (
          <KeyButton key={fk} label={fk} keyVal={fk.toLowerCase()} onKeyPress={handleKeyPress} disabled={disabled} />
        ))}
        <div className="w-2" />
        <KeyButton label="PrtSc" keyVal="printscreen" onKeyPress={handleKeyPress} disabled={disabled} />
        <KeyButton label="ScrLk" keyVal="scrolllock" onKeyPress={handleKeyPress} disabled={disabled} />
        <KeyButton label="Pause" keyVal="pause" onKeyPress={handleKeyPress} disabled={disabled} />
      </div>

      {/* Number Row */}
      <div className="flex gap-0.5">
        {numRow.map(k => (
          <KeyButton key={k.k} label={k.l} keyVal={k.k} width={k.w} onKeyPress={handleKeyPress} disabled={disabled} />
        ))}
      </div>

      {/* Row 1 - QWERTY */}
      <div className="flex gap-0.5">
        {row1.map(k => (
          <KeyButton key={k.k} label={k.l} keyVal={k.k} width={k.w} onKeyPress={handleKeyPress} disabled={disabled} />
        ))}
      </div>

      {/* Row 2 - ASDF with Caps Lock */}
      <div className="flex gap-0.5">
        <KeyButton label="Caps" keyVal="capslock" width="w-12" onKeyPress={handleKeyPress} disabled={disabled} />
        {row2.map(k => (
          <KeyButton key={k.k} label={k.l} keyVal={k.k} width={k.w} onKeyPress={handleKeyPress} disabled={disabled} />
        ))}
      </div>

      {/* Row 3 - ZXCV with Shift */}
      <div className="flex gap-0.5">
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 w-14 text-[10px] font-medium border-border/30 transition-all",
            modifiers.shift ? "bg-primary/20 border-primary/50 text-primary" : "bg-card/50 hover:bg-secondary/80"
          )}
          onClick={() => toggleModifier("shift")}
          disabled={disabled}
        >
          Shift
        </Button>
        {row3.map(k => (
          <KeyButton key={k.k} label={k.l} keyVal={k.k} onKeyPress={handleKeyPress} disabled={disabled} />
        ))}
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 w-14 text-[10px] font-medium border-border/30 transition-all",
            modifiers.shift ? "bg-primary/20 border-primary/50 text-primary" : "bg-card/50 hover:bg-secondary/80"
          )}
          onClick={() => toggleModifier("shift")}
          disabled={disabled}
        >
          Shift
        </Button>
      </div>

      {/* Bottom Row - Modifiers + Space */}
      <div className="flex gap-0.5">
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 w-12 text-[10px] font-medium border-border/30 transition-all",
            modifiers.ctrl ? "bg-primary/20 border-primary/50 text-primary" : "bg-card/50 hover:bg-secondary/80"
          )}
          onClick={() => toggleModifier("ctrl")}
          disabled={disabled}
        >
          Ctrl
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 w-10 text-[10px] font-medium border-border/30 transition-all",
            modifiers.win ? "bg-primary/20 border-primary/50 text-primary" : "bg-card/50 hover:bg-secondary/80"
          )}
          onClick={() => toggleModifier("win")}
          disabled={disabled}
        >
          ⊞
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 w-10 text-[10px] font-medium border-border/30 transition-all",
            modifiers.alt ? "bg-primary/20 border-primary/50 text-primary" : "bg-card/50 hover:bg-secondary/80"
          )}
          onClick={() => toggleModifier("alt")}
          disabled={disabled}
        >
          Alt
        </Button>
        <KeyButton label="Space" keyVal="space" width="flex-1" onKeyPress={handleKeyPress} disabled={disabled} />
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 w-10 text-[10px] font-medium border-border/30 transition-all",
            modifiers.alt ? "bg-primary/20 border-primary/50 text-primary" : "bg-card/50 hover:bg-secondary/80"
          )}
          onClick={() => toggleModifier("alt")}
          disabled={disabled}
        >
          Alt
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 w-12 text-[10px] font-medium border-border/30 transition-all",
            modifiers.ctrl ? "bg-primary/20 border-primary/50 text-primary" : "bg-card/50 hover:bg-secondary/80"
          )}
          onClick={() => toggleModifier("ctrl")}
          disabled={disabled}
        >
          Ctrl
        </Button>
      </div>

      {/* Navigation Keys */}
      <div className="flex gap-1 pt-2 border-t border-border/20">
        <div className="grid grid-cols-5 gap-0.5 flex-1">
          {navKeys.map(k => (
            <KeyButton key={k.k} label={k.l} keyVal={k.k} onKeyPress={handleKeyPress} disabled={disabled} />
          ))}
        </div>
      </div>

      {/* Quick Combos */}
      <div className="flex gap-1 pt-2 border-t border-border/20 overflow-x-auto">
        {[
          { l: "Ctrl+C", k: "ctrl+c" },
          { l: "Ctrl+V", k: "ctrl+v" },
          { l: "Ctrl+X", k: "ctrl+x" },
          { l: "Ctrl+Z", k: "ctrl+z" },
          { l: "Ctrl+A", k: "ctrl+a" },
          { l: "Ctrl+S", k: "ctrl+s" },
          { l: "Alt+Tab", k: "alt+tab" },
          { l: "Alt+F4", k: "alt+f4" },
          { l: "Win+D", k: "win+d" },
          { l: "Win+E", k: "win+e" },
          { l: "Win+L", k: "win+l" },
        ].map(combo => (
          <KeyButton key={combo.k} label={combo.l} keyVal={combo.k} width="w-14" onKeyPress={handleKeyPress} disabled={disabled} />
        ))}
      </div>
    </div>
  );
}
