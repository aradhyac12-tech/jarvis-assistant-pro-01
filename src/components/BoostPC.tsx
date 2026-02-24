import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Zap,
  Trash2,
  Cpu,
  Gamepad2,
  RefreshCw,
  Check,
  Loader2,
  AlertTriangle,
  HardDrive,
  Wind,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useToast } from "@/hooks/use-toast";

interface BoostOption {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  enabled: boolean;
}

export function BoostPC({ className }: { className?: string }) {
  const { sendCommand } = useDeviceCommands();
  const { toast } = useToast();
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const [results, setResults] = useState<{ step: string; success: boolean; freed?: string }[]>([]);

  const [options, setOptions] = useState<BoostOption[]>([
    { id: "ram", name: "RAM Cleanup", description: "Clear standby memory and background processes", icon: HardDrive, enabled: true },
    { id: "temp", name: "Clear Temp Files", description: "Delete temporary and prefetch files", icon: Trash2, enabled: true },
    { id: "performance", name: "Performance Mode", description: "Set power plan to high performance", icon: Cpu, enabled: true },
    { id: "defrag", name: "Optimize Drives", description: "TRIM for SSDs or defrag for HDDs (C: /O:)", icon: Zap, enabled: false },
    { id: "gaming", name: "Gaming Mode", description: "Disable notifications, prioritize GPU", icon: Gamepad2, enabled: false },
    { id: "explorer", name: "Restart Explorer", description: "Refresh Windows shell and taskbar", icon: RefreshCw, enabled: false },
  ]);

  const toggleOption = (id: string) => {
    setOptions(prev => prev.map(opt => 
      opt.id === id ? { ...opt, enabled: !opt.enabled } : opt
    ));
  };

  const runBoost = useCallback(async () => {
    const enabledOptions = options.filter(o => o.enabled);
    if (enabledOptions.length === 0) {
      toast({ title: "No options selected", variant: "destructive" });
      return;
    }

    setIsRunning(true);
    setProgress(0);
    setResults([]);

    const steps = enabledOptions.length;
    let completed = 0;

    for (const option of enabledOptions) {
      setCurrentStep(option.name);
      setProgress((completed / steps) * 100);

      try {
        let result;
        
        switch (option.id) {
          case "ram":
            result = await sendCommand("boost_ram", {}, { awaitResult: true, timeoutMs: 30000 });
            break;
          case "temp":
            result = await sendCommand("clear_temp_files", {}, { awaitResult: true, timeoutMs: 60000 });
            break;
          case "performance":
            result = await sendCommand("set_power_plan", { plan: "high_performance" }, { awaitResult: true, timeoutMs: 10000 });
            break;
          case "gaming":
            result = await sendCommand("gaming_mode", { enable: true }, { awaitResult: true, timeoutMs: 15000 });
            break;
          case "defrag":
            result = await sendCommand("optimize_drives", { drive: "C:", flags: "/O" }, { awaitResult: true, timeoutMs: 120000 });
            break;
          case "explorer":
            result = await sendCommand("restart_explorer", {}, { awaitResult: true, timeoutMs: 20000 });
            break;
        }

        const success = result?.success ?? false;
        const freed = result?.result?.freed_mb ? `${result.result.freed_mb}MB freed` : undefined;
        
        setResults(prev => [...prev, { step: option.name, success, freed }]);
      } catch (e) {
        setResults(prev => [...prev, { step: option.name, success: false }]);
      }

      completed++;
    }

    setProgress(100);
    setCurrentStep("");
    setIsRunning(false);

    toast({
      title: "Boost Complete",
      description: `${completed} optimizations applied`,
    });
  }, [options, sendCommand, toast]);

  return (
    <Card className={cn("border-border/50", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          Boost PC
        </CardTitle>
        <CardDescription>
          Optimize your PC for maximum performance
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Options */}
        <div className="space-y-2">
          {options.map((option) => (
            <div
              key={option.id}
              className={cn(
                "flex items-center justify-between p-2.5 rounded-lg border transition-colors",
                option.enabled ? "bg-primary/5 border-primary/20" : "bg-secondary/20 border-border/50"
              )}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <option.icon className={cn(
                  "h-4 w-4 shrink-0",
                  option.enabled ? "text-primary" : "text-muted-foreground"
                )} />
                <div className="min-w-0">
                  <p className="font-medium text-xs">{option.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{option.description}</p>
                </div>
              </div>
              <Switch
                checked={option.enabled}
                onCheckedChange={() => toggleOption(option.id)}
                disabled={isRunning}
                className="shrink-0 ml-2"
              />
            </div>
          ))}
        </div>

        {/* Progress */}
        {isRunning && (
          <div className="space-y-2">
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">
              {currentStep}... {Math.round(progress)}%
            </p>
          </div>
        )}

        {/* Results */}
        {results.length > 0 && !isRunning && (
          <div className="space-y-2">
            {results.map((result, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-center justify-between p-2 rounded-lg text-sm",
                  result.success ? "bg-primary/10" : "bg-destructive/10"
                )}
              >
                <div className="flex items-center gap-2">
                  {result.success ? (
                    <Check className="h-4 w-4 text-primary" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                  )}
                  <span>{result.step}</span>
                </div>
                {result.freed && (
                  <Badge variant="outline" className="text-xs">
                    {result.freed}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Run button */}
        <Button
          onClick={runBoost}
          disabled={isRunning || options.filter(o => o.enabled).length === 0}
          className="w-full"
          size="lg"
        >
          {isRunning ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Boosting...
            </>
          ) : (
            <>
              <Zap className="h-4 w-4 mr-2" />
              Boost Now
            </>
          )}
        </Button>

        <p className="text-xs text-muted-foreground text-center">
          <Wind className="h-3 w-3 inline mr-1" />
          All operations are safe and reversible
        </p>
      </CardContent>
    </Card>
  );
}
