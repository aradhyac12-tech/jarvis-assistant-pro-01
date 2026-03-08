import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Fan, RefreshCw, Loader2, Plus, Trash2, Save, RotateCcw,
  ChevronDown, ChevronUp, Thermometer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useToast } from "@/hooks/use-toast";

interface FanInfo {
  name: string;
  rpm: number;
  percent: number;
  min_rpm?: number;
  max_rpm?: number;
}

interface CurvePoint {
  temp: number;
  speed: number; // 0-100%
}

const DEFAULT_CURVE: CurvePoint[] = [
  { temp: 30, speed: 20 },
  { temp: 50, speed: 40 },
  { temp: 70, speed: 70 },
  { temp: 85, speed: 100 },
];

const PRESET_CURVES: Record<string, CurvePoint[]> = {
  Silent: [
    { temp: 30, speed: 15 },
    { temp: 50, speed: 25 },
    { temp: 70, speed: 50 },
    { temp: 90, speed: 80 },
  ],
  Balanced: DEFAULT_CURVE,
  Performance: [
    { temp: 30, speed: 40 },
    { temp: 50, speed: 60 },
    { temp: 70, speed: 85 },
    { temp: 80, speed: 100 },
  ],
  "Max Cooling": [
    { temp: 0, speed: 100 },
  ],
};

function CurveVisualizer({ curve, className }: { curve: CurvePoint[]; className?: string }) {
  const sorted = [...curve].sort((a, b) => a.temp - b.temp);
  const w = 160, h = 60;
  const padX = 4, padY = 4;

  const toX = (temp: number) => padX + ((temp - 0) / 110) * (w - padX * 2);
  const toY = (speed: number) => h - padY - (speed / 100) * (h - padY * 2);

  const pathD = sorted.length > 0
    ? `M ${toX(0)} ${toY(sorted[0].speed)} ` +
      sorted.map(p => `L ${toX(p.temp)} ${toY(p.speed)}`).join(" ") +
      ` L ${toX(110)} ${toY(sorted[sorted.length - 1].speed)}`
    : "";

  const fillD = pathD
    ? pathD + ` L ${toX(110)} ${toY(0)} L ${toX(0)} ${toY(0)} Z`
    : "";

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("w-full", className)}>
      <defs>
        <linearGradient id="fan-curve-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
        </linearGradient>
      </defs>
      {/* Grid lines */}
      {[25, 50, 75].map(v => (
        <line key={v} x1={padX} x2={w - padX} y1={toY(v)} y2={toY(v)}
          stroke="hsl(var(--border))" strokeWidth={0.3} strokeDasharray="2,2" />
      ))}
      {/* Fill + Line */}
      {fillD && <path d={fillD} fill="url(#fan-curve-grad)" />}
      {pathD && <path d={pathD} fill="none" stroke="hsl(var(--primary))" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />}
      {/* Points */}
      {sorted.map((p, i) => (
        <circle key={i} cx={toX(p.temp)} cy={toY(p.speed)} r={2.5}
          fill="hsl(var(--primary))" stroke="hsl(var(--background))" strokeWidth={1} />
      ))}
      {/* Axis labels */}
      <text x={padX} y={h - 1} fontSize={5} fill="hsl(var(--muted-foreground))">0°C</text>
      <text x={w - padX - 14} y={h - 1} fontSize={5} fill="hsl(var(--muted-foreground))">110°C</text>
      <text x={1} y={padY + 4} fontSize={5} fill="hsl(var(--muted-foreground))">100%</text>
    </svg>
  );
}

export function FanSpeedControl({ className }: { className?: string }) {
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();
  const { toast } = useToast();
  const isConnected = selectedDevice?.is_online || false;

  const [fans, setFans] = useState<FanInfo[]>([]);
  const [fanNote, setFanNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [curve, setCurve] = useState<CurvePoint[]>(DEFAULT_CURVE);
  const [activePreset, setActivePreset] = useState<string>("Balanced");
  const [saving, setSaving] = useState(false);
  const [showCurveEditor, setShowCurveEditor] = useState(false);
  const intervalRef = useRef<number | null>(null);

  const fetchFans = useCallback(async () => {
    if (!isConnected) return;
    setLoading(true);
    try {
      const result = await sendCommand("get_fan_speeds", {}, { awaitResult: true, timeoutMs: 5000 });
      if (result.success && "result" in result) {
        const r = result.result as any;
        const fanData = r.fans || r.fan_speeds || [];
        setFans(fanData);
        setFanNote(r.note || null);
        if (r.current_curve) {
          setCurve(r.current_curve);
          setActivePreset(r.curve_preset || "Custom");
        }
      }
    } catch {}
    setLoading(false);
  }, [isConnected, sendCommand]);

  const applyPreset = useCallback(async (presetName: string) => {
    const presetCurve = PRESET_CURVES[presetName];
    if (!presetCurve) return;
    setCurve(presetCurve);
    setActivePreset(presetName);
    setSaving(true);
    try {
      const result = await sendCommand("set_fan_curve", {
        curve: presetCurve,
        preset: presetName,
      }, { awaitResult: true, timeoutMs: 5000 });
      if (result.success) {
        toast({ title: `Fan profile: ${presetName}`, description: "Applied successfully" });
      } else {
        toast({ title: "Failed to apply", description: String(result.error), variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Failed to apply", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
    }
    setSaving(false);
  }, [sendCommand, toast]);

  const saveCustomCurve = useCallback(async () => {
    setSaving(true);
    setActivePreset("Custom");
    try {
      const result = await sendCommand("set_fan_curve", {
        curve,
        preset: "Custom",
      }, { awaitResult: true, timeoutMs: 5000 });
      if (result.success) {
        toast({ title: "Custom fan curve saved" });
      } else {
        toast({ title: "Failed to save", description: String(result.error), variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Failed to save", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
    }
    setSaving(false);
  }, [curve, sendCommand, toast]);

  const updateCurvePoint = (index: number, field: "temp" | "speed", value: number) => {
    setCurve(prev => prev.map((p, i) => i === index ? { ...p, [field]: value } : p));
    setActivePreset("Custom");
  };

  const addCurvePoint = () => {
    const sorted = [...curve].sort((a, b) => a.temp - b.temp);
    const lastTemp = sorted.length > 0 ? sorted[sorted.length - 1].temp : 30;
    const newTemp = Math.min(lastTemp + 10, 100);
    setCurve(prev => [...prev, { temp: newTemp, speed: 50 }]);
    setActivePreset("Custom");
  };

  const removeCurvePoint = (index: number) => {
    if (curve.length <= 1) return;
    setCurve(prev => prev.filter((_, i) => i !== index));
    setActivePreset("Custom");
  };

  // Poll fan speeds every 5s when expanded
  useEffect(() => {
    if (!expanded || !isConnected) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    fetchFans();
    intervalRef.current = window.setInterval(fetchFans, 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [expanded, isConnected, fetchFans]);

  if (!isConnected) return null;

  const sortedCurve = [...curve].sort((a, b) => a.temp - b.temp);

  return (
    <Card className={cn("border-border/20 bg-card/50", className)}>
      <button
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-secondary/10 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex items-center gap-2 text-xs font-medium">
          <Fan className={cn("h-3.5 w-3.5 text-primary", expanded && fans.length > 0 && "animate-spin")}
            style={expanded && fans.length > 0 ? { animationDuration: "2s" } : undefined} />
          Fan Control
          {fans.length > 0 && (
            <Badge variant="secondary" className="text-[8px] h-3.5 px-1">
              {fans.length} fan{fans.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </span>
        <div className="flex items-center gap-1.5">
          {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          <Badge variant="outline" className="text-[8px] h-4 px-1.5">
            {activePreset}
          </Badge>
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </div>
      </button>

      {expanded && (
        <CardContent className="px-3 pb-3 pt-0 space-y-2">
          {/* Current Fan RPMs */}
          {fans.length > 0 ? (
            <div className="grid grid-cols-2 gap-1.5">
              {fans.map((fan, i) => (
                <div key={i} className="rounded-lg border border-border/20 bg-secondary/5 p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] text-muted-foreground truncate">{fan.name || `Fan ${i + 1}`}</span>
                    <span className={cn(
                      "font-mono text-[10px] font-bold",
                      fan.rpm === 0 ? "text-muted-foreground" : fan.percent > 80 ? "text-destructive" : "text-foreground"
                    )}>
                      {fan.rpm} RPM
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        fan.percent > 80 ? "bg-destructive" : fan.percent > 50 ? "bg-amber-500" : "bg-primary"
                      )}
                      style={{ width: `${Math.min(100, fan.percent)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] text-muted-foreground">{Math.round(fan.percent)}%</span>
                    {(fan as any).estimated && (
                      <span className="text-[7px] text-amber-500">est.</span>
                    )}
                    {(fan as any).temp_c && (
                      <span className="text-[8px] text-muted-foreground">{(fan as any).temp_c}°C</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-border/20 bg-secondary/5 p-3 text-center space-y-1.5">
              <Fan className="h-5 w-5 mx-auto text-muted-foreground/50" />
              <p className="text-[10px] text-muted-foreground">
                {fanNote || "Fan sensors not detected on this system"}
              </p>
              <p className="text-[8px] text-muted-foreground/70">
                Fan profiles can still be applied — the PC will use them when supported hardware is available
              </p>
              <Button variant="ghost" size="sm" className="h-6 text-[10px] mt-1" onClick={fetchFans}>
                <RefreshCw className="h-3 w-3 mr-1" /> Retry
              </Button>
            </div>
          )}

          {/* Preset Buttons */}
          <div className="space-y-1">
            <span className="text-[9px] text-muted-foreground font-medium">Fan Profile</span>
            <div className="grid grid-cols-4 gap-1">
              {Object.keys(PRESET_CURVES).map(name => (
                <Button
                  key={name}
                  variant={activePreset === name ? "default" : "outline"}
                  size="sm"
                  className={cn(
                    "h-6 text-[9px] px-1.5",
                    activePreset === name && "ring-1 ring-primary/50"
                  )}
                  onClick={() => applyPreset(name)}
                  disabled={saving}
                >
                  {name}
                </Button>
              ))}
            </div>
          </div>

          {/* Curve Visualizer */}
          <div className="rounded-lg border border-border/20 bg-secondary/5 p-1.5">
            <CurveVisualizer curve={curve} className="h-14" />
          </div>

          {/* Curve Editor Toggle */}
          <button
            className="w-full flex items-center justify-between text-[10px] text-muted-foreground hover:text-foreground transition-colors py-1"
            onClick={() => setShowCurveEditor(!showCurveEditor)}
          >
            <span className="flex items-center gap-1">
              <Thermometer className="h-3 w-3" /> Custom Curve Editor
            </span>
            {showCurveEditor ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {showCurveEditor && (
            <div className="space-y-1.5">
              <ScrollArea className="max-h-36">
                <div className="space-y-1.5">
                  {sortedCurve.map((point, idx) => {
                    const originalIdx = curve.indexOf(point);
                    return (
                      <div key={originalIdx} className="flex items-center gap-2 rounded-md border border-border/10 bg-secondary/5 px-2 py-1.5">
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[8px] text-muted-foreground">Temp: {point.temp}°C</span>
                            <span className="text-[8px] text-muted-foreground">Speed: {point.speed}%</span>
                          </div>
                          <Slider
                            value={[point.temp]}
                            min={0}
                            max={110}
                            step={5}
                            onValueChange={([v]) => updateCurvePoint(originalIdx, "temp", v)}
                            className="h-3"
                          />
                          <Slider
                            value={[point.speed]}
                            min={0}
                            max={100}
                            step={5}
                            onValueChange={([v]) => updateCurvePoint(originalIdx, "speed", v)}
                            className="h-3"
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 shrink-0"
                          onClick={() => removeCurvePoint(originalIdx)}
                          disabled={curve.length <= 1}
                        >
                          <Trash2 className="h-2.5 w-2.5 text-destructive" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>

              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="sm" className="h-6 text-[9px] flex-1 gap-1" onClick={addCurvePoint}>
                  <Plus className="h-2.5 w-2.5" /> Add Point
                </Button>
                <Button variant="outline" size="sm" className="h-6 text-[9px] gap-1"
                  onClick={() => { setCurve(DEFAULT_CURVE); setActivePreset("Balanced"); }}>
                  <RotateCcw className="h-2.5 w-2.5" /> Reset
                </Button>
                <Button variant="default" size="sm" className="h-6 text-[9px] flex-1 gap-1"
                  onClick={saveCustomCurve} disabled={saving}>
                  {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Save className="h-2.5 w-2.5" />}
                  Apply
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
