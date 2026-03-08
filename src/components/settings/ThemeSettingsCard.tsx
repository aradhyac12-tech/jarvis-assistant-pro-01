import { useState, useEffect, useCallback } from "react";
import { Palette, Check, Sun, Moon, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ThemePreset {
  id: string;
  name: string;
  primary: string;     // HSL values
  accent: string;      // HSL values
  preview: [string, string]; // two CSS colors for swatch
}

const PRESETS: ThemePreset[] = [
  { id: "blue",    name: "Electric Blue", primary: "220 90% 56%", accent: "262 83% 58%", preview: ["#3b82f6", "#7c3aed"] },
  { id: "emerald", name: "Emerald",       primary: "160 84% 39%", accent: "172 66% 50%", preview: ["#10b981", "#14b8a6"] },
  { id: "sunset",  name: "Sunset",        primary: "25 95% 53%",  accent: "330 81% 60%", preview: ["#f97316", "#ec4899"] },
  { id: "violet",  name: "Violet",        primary: "262 83% 58%", accent: "292 84% 61%", preview: ["#7c3aed", "#c026d3"] },
  { id: "rose",    name: "Rose Gold",     primary: "347 77% 50%", accent: "25 95% 53%",  preview: ["#e11d48", "#f97316"] },
  { id: "cyan",    name: "Cyber Cyan",    primary: "186 94% 42%", accent: "220 90% 56%", preview: ["#06b6d4", "#3b82f6"] },
  { id: "amber",   name: "Amber",         primary: "38 92% 50%",  accent: "25 95% 53%",  preview: ["#f59e0b", "#f97316"] },
  { id: "slate",   name: "Monochrome",    primary: "215 20% 65%", accent: "215 14% 34%", preview: ["#94a3b8", "#475569"] },
];

type Mode = "dark" | "light";

function getStoredTheme(): { presetId: string; mode: Mode; customPrimary?: string; customAccent?: string } {
  try {
    const raw = localStorage.getItem("jarvis_theme");
    if (raw) return JSON.parse(raw);
  } catch {}
  return { presetId: "blue", mode: "dark" };
}

function applyThemeColors(primary: string, accent: string) {
  const root = document.documentElement;
  // Primary
  root.style.setProperty("--primary", primary);
  root.style.setProperty("--ring", primary);
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-purple", accent);
  root.style.setProperty("--sidebar-primary", primary);
  root.style.setProperty("--sidebar-ring", primary);
  root.style.setProperty("--info", primary);
  root.style.setProperty("--accent-blue", primary);
}

function applyMode(mode: Mode) {
  if (mode === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

export function ThemeSettingsCard() {
  const [theme, setTheme] = useState(getStoredTheme);
  const [customPrimary, setCustomPrimary] = useState(theme.customPrimary || "#3b82f6");
  const [customAccent, setCustomAccent] = useState(theme.customAccent || "#7c3aed");
  const [isCustom, setIsCustom] = useState(theme.presetId === "custom");

  // Apply on mount & changes
  useEffect(() => {
    applyMode(theme.mode);
    if (theme.presetId === "custom" && theme.customPrimary && theme.customAccent) {
      applyThemeColors(
        hexToHsl(theme.customPrimary),
        hexToHsl(theme.customAccent),
      );
    } else {
      const preset = PRESETS.find(p => p.id === theme.presetId) || PRESETS[0];
      applyThemeColors(preset.primary, preset.accent);
    }
    localStorage.setItem("jarvis_theme", JSON.stringify(theme));
  }, [theme]);

  const selectPreset = useCallback((preset: ThemePreset) => {
    setIsCustom(false);
    setTheme(prev => ({ ...prev, presetId: preset.id }));
  }, []);

  const toggleMode = useCallback(() => {
    setTheme(prev => ({ ...prev, mode: prev.mode === "dark" ? "light" : "dark" }));
  }, []);

  const applyCustomColors = useCallback(() => {
    setIsCustom(true);
    setTheme(prev => ({
      ...prev,
      presetId: "custom",
      customPrimary,
      customAccent,
    }));
  }, [customPrimary, customAccent]);

  return (
    <Card className="border-border/10 bg-card/40 backdrop-blur-sm rounded-2xl shadow-sm">
      <CardHeader className="pb-2 pt-5 px-5">
        <CardTitle className="flex items-center gap-3 text-sm font-semibold tracking-wide uppercase text-muted-foreground">
          <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center">
            <Palette className="h-4 w-4 text-primary" />
          </div>
          Theme
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-1 space-y-4">
        {/* Mode toggle */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/20 border border-border/5">
          <div className="flex items-center gap-2.5">
            {theme.mode === "dark" ? <Moon className="h-4 w-4 text-primary" /> : <Sun className="h-4 w-4 text-primary" />}
            <div>
              <p className="text-xs font-medium">{theme.mode === "dark" ? "Dark Mode" : "Light Mode"}</p>
              <p className="text-[10px] text-muted-foreground">Switch appearance</p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="h-7 text-[10px] rounded-lg" onClick={toggleMode}>
            {theme.mode === "dark" ? <Sun className="h-3 w-3 mr-1" /> : <Moon className="h-3 w-3 mr-1" />}
            {theme.mode === "dark" ? "Light" : "Dark"}
          </Button>
        </div>

        {/* Preset grid */}
        <div>
          <p className="text-[10px] text-muted-foreground mb-2 font-medium uppercase tracking-wider">Color Presets</p>
          <div className="grid grid-cols-4 gap-2">
            {PRESETS.map(preset => (
              <button
                key={preset.id}
                onClick={() => selectPreset(preset)}
                className={cn(
                  "relative flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all duration-200",
                  theme.presetId === preset.id && !isCustom
                    ? "border-primary/40 bg-primary/8 ring-1 ring-primary/20"
                    : "border-border/10 bg-secondary/10 hover:bg-secondary/20"
                )}
              >
                <div className="flex gap-0.5">
                  <div className="w-4 h-4 rounded-full" style={{ background: preset.preview[0] }} />
                  <div className="w-4 h-4 rounded-full" style={{ background: preset.preview[1] }} />
                </div>
                <span className="text-[9px] font-medium text-muted-foreground leading-tight text-center">
                  {preset.name}
                </span>
                {theme.presetId === preset.id && !isCustom && (
                  <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                    <Check className="h-2.5 w-2.5 text-primary-foreground" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Custom color picker */}
        <div>
          <p className="text-[10px] text-muted-foreground mb-2 font-medium uppercase tracking-wider flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> Custom Colors
          </p>
          <div className="flex items-center gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-[10px] text-muted-foreground">Primary</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={customPrimary}
                  onChange={e => setCustomPrimary(e.target.value)}
                  className="w-8 h-8 rounded-lg border border-border/20 cursor-pointer bg-transparent"
                />
                <span className="text-[10px] font-mono text-muted-foreground">{customPrimary}</span>
              </div>
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-[10px] text-muted-foreground">Accent</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={customAccent}
                  onChange={e => setCustomAccent(e.target.value)}
                  className="w-8 h-8 rounded-lg border border-border/20 cursor-pointer bg-transparent"
                />
                <span className="text-[10px] font-mono text-muted-foreground">{customAccent}</span>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className={cn("h-8 text-[10px] rounded-lg mt-4", isCustom && "border-primary/40 bg-primary/10")}
              onClick={applyCustomColors}
            >
              Apply
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Convert hex to HSL string like "220 90% 56%" */
function hexToHsl(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
