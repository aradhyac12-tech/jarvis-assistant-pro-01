import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Clock, Plus, Trash2, Power, Lock, Terminal, Play, Pause, CalendarClock, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useToast } from "@/hooks/use-toast";

interface ScheduledCommand {
  id: string;
  command_type: string;
  payload: Record<string, any>;
  scheduled_at: string;
  repeat_mode: string;
  repeat_days: string[];
  enabled: boolean;
  last_run_at: string | null;
  label: string | null;
}

const COMMAND_PRESETS = [
  { type: "shutdown", label: "Shutdown PC", icon: Power, payload: {} },
  { type: "lock_pc", label: "Lock PC", icon: Lock, payload: {} },
  { type: "sleep_pc", label: "Sleep PC", icon: Pause, payload: {} },
  { type: "restart_pc", label: "Restart PC", icon: Play, payload: {} },
  { type: "run_command", label: "Run Script/Command", icon: Terminal, payload: { command: "" } },
];

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export function ScheduledCommands({ isConnected, className }: { isConnected: boolean; className?: string }) {
  const { user } = useAuth();
  const { selectedDevice } = useDeviceContext();
  const { sendCommand } = useDeviceCommands();
  const { toast } = useToast();

  const [commands, setCommands] = useState<ScheduledCommand[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  // New command form
  const [newType, setNewType] = useState("shutdown");
  const [newTime, setNewTime] = useState("22:00");
  const [newLabel, setNewLabel] = useState("");
  const [newRepeat, setNewRepeat] = useState("once");
  const [newDays, setNewDays] = useState<string[]>([]);
  const [newScript, setNewScript] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchCommands = useCallback(async () => {
    if (!user || !selectedDevice?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("scheduled_commands")
      .select("*")
      .eq("device_id", selectedDevice.id)
      .order("scheduled_at", { ascending: true });
    if (!error && data) setCommands(data as unknown as ScheduledCommand[]);
    setLoading(false);
  }, [user, selectedDevice?.id]);

  useEffect(() => { fetchCommands(); }, [fetchCommands]);

  const addCommand = async () => {
    if (!user || !selectedDevice?.id) return;
    setSaving(true);

    // Build scheduled_at from time
    const now = new Date();
    const [h, m] = newTime.split(":").map(Number);
    const scheduled = new Date(now);
    scheduled.setHours(h, m, 0, 0);
    if (scheduled <= now) scheduled.setDate(scheduled.getDate() + 1);

    const payload = newType === "run_command" ? { command: newScript } : {};

    const { error } = await supabase.from("scheduled_commands").insert({
      user_id: user.id,
      device_id: selectedDevice.id,
      command_type: newType,
      payload,
      scheduled_at: scheduled.toISOString(),
      repeat_mode: newRepeat,
      repeat_days: newDays,
      label: newLabel || COMMAND_PRESETS.find(p => p.type === newType)?.label || newType,
      enabled: true,
    } as any);

    if (error) {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Scheduled command added" });
      setShowAdd(false);
      setNewLabel("");
      setNewScript("");
      setNewDays([]);
      fetchCommands();
    }
    setSaving(false);
  };

  const toggleCommand = async (id: string, enabled: boolean) => {
    await supabase.from("scheduled_commands").update({ enabled } as any).eq("id", id);
    setCommands(prev => prev.map(c => c.id === id ? { ...c, enabled } : c));
  };

  const deleteCommand = async (id: string) => {
    await supabase.from("scheduled_commands").delete().eq("id", id);
    setCommands(prev => prev.filter(c => c.id !== id));
    toast({ title: "Command deleted" });
  };

  const runNow = async (cmd: ScheduledCommand) => {
    const result = await sendCommand(cmd.command_type, cmd.payload, { awaitResult: true, timeoutMs: 10000 });
    if (result.success) {
      toast({ title: `Executed: ${cmd.label}` });
    } else {
      toast({ title: "Command failed", description: String(result.error), variant: "destructive" });
    }
  };

  // Client-side scheduler check (runs every 30s)
  useEffect(() => {
    if (!isConnected || commands.length === 0) return;

    const check = () => {
      const now = new Date();
      commands.forEach(cmd => {
        if (!cmd.enabled) return;
        const scheduledTime = new Date(cmd.scheduled_at);
        const diff = Math.abs(now.getTime() - scheduledTime.getTime());
        
        // Within 30s window
        if (diff < 30000) {
          // Check if already ran
          if (cmd.last_run_at) {
            const lastRun = new Date(cmd.last_run_at);
            if (now.getTime() - lastRun.getTime() < 60000) return; // Skip if ran within last minute
          }

          // For repeat mode, check day
          if (cmd.repeat_mode === "daily" || (cmd.repeat_mode === "weekly" && cmd.repeat_days.length > 0)) {
            const dayName = DAYS[now.getDay() === 0 ? 6 : now.getDay() - 1];
            if (cmd.repeat_mode === "weekly" && !cmd.repeat_days.includes(dayName)) return;
          }

          // Execute
          sendCommand(cmd.command_type, cmd.payload, { awaitResult: false });
          toast({ title: `⏰ Scheduled: ${cmd.label}`, description: "Command sent to PC" });

          // Update last_run_at
          supabase.from("scheduled_commands").update({
            last_run_at: now.toISOString(),
            // For 'once', disable after running
            ...(cmd.repeat_mode === "once" ? { enabled: false } : {}),
          } as any).eq("id", cmd.id).then(() => fetchCommands());
        }
      });
    };

    const interval = setInterval(check, 30000);
    check(); // Initial check
    return () => clearInterval(interval);
  }, [isConnected, commands, sendCommand, toast, fetchCommands]);

  const getPresetIcon = (type: string) => {
    const preset = COMMAND_PRESETS.find(p => p.type === type);
    return preset?.icon || Terminal;
  };

  return (
    <Card className={cn("border-border/20 bg-card/50", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-primary" />
          Scheduled Commands
          <Badge variant="secondary" className="ml-auto text-[10px]">{commands.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Add Button */}
        <Button
          variant={showAdd ? "secondary" : "outline"}
          size="sm"
          className="w-full h-8 text-xs gap-1"
          onClick={() => setShowAdd(!showAdd)}
        >
          <Plus className="h-3 w-3" />
          {showAdd ? "Cancel" : "Add Scheduled Command"}
        </Button>

        {/* Add Form */}
        {showAdd && (
          <div className="rounded-lg border border-border/50 bg-secondary/10 p-3 space-y-3 animate-in slide-in-from-top-2">
            <div className="space-y-1.5">
              <Label className="text-[10px]">Command Type</Label>
              <Select value={newType} onValueChange={setNewType}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMAND_PRESETS.map(p => (
                    <SelectItem key={p.type} value={p.type} className="text-xs">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {newType === "run_command" && (
              <div className="space-y-1.5">
                <Label className="text-[10px]">Command / Script Path</Label>
                <Input
                  value={newScript}
                  onChange={e => setNewScript(e.target.value)}
                  placeholder="e.g. notepad.exe or C:\scripts\backup.bat"
                  className="h-8 text-xs font-mono"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-[10px]">Time</Label>
                <Input type="time" value={newTime} onChange={e => setNewTime(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px]">Repeat</Label>
                <Select value={newRepeat} onValueChange={setNewRepeat}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="once" className="text-xs">Once</SelectItem>
                    <SelectItem value="daily" className="text-xs">Daily</SelectItem>
                    <SelectItem value="weekly" className="text-xs">Weekly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {newRepeat === "weekly" && (
              <div className="flex flex-wrap gap-1">
                {DAYS.map(d => (
                  <Button
                    key={d}
                    variant={newDays.includes(d) ? "default" : "outline"}
                    size="sm"
                    className="h-6 text-[10px] px-2 capitalize"
                    onClick={() => setNewDays(prev =>
                      prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]
                    )}
                  >
                    {d.slice(0, 3)}
                  </Button>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-[10px]">Label (optional)</Label>
              <Input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. Nightly shutdown" className="h-8 text-xs" />
            </div>

            <Button onClick={addCommand} disabled={saving} size="sm" className="w-full h-8 text-xs gradient-primary">
              {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
              Schedule
            </Button>
          </div>
        )}

        {/* Command List */}
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : commands.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-3">No scheduled commands yet</p>
        ) : (
          <ScrollArea className="max-h-64">
            <div className="space-y-2">
              {commands.map(cmd => {
                const Icon = getPresetIcon(cmd.command_type);
                const time = new Date(cmd.scheduled_at);
                return (
                  <div key={cmd.id} className={cn(
                    "flex items-center gap-2 p-2 rounded-lg border border-border/30 bg-secondary/5 transition-opacity",
                    !cmd.enabled && "opacity-50"
                  )}>
                    <Icon className="h-4 w-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{cmd.label || cmd.command_type}</p>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <Clock className="h-2.5 w-2.5" />
                        {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        <Badge variant="outline" className="text-[8px] h-3.5 px-1">{cmd.repeat_mode}</Badge>
                        {cmd.repeat_mode === "weekly" && cmd.repeat_days.length > 0 && (
                          <span>{cmd.repeat_days.map(d => d.slice(0, 2)).join(", ")}</span>
                        )}
                      </div>
                    </div>
                    <Switch checked={cmd.enabled} onCheckedChange={v => toggleCommand(cmd.id, v)} className="scale-75" />
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => runNow(cmd)} title="Run now">
                      <Play className="h-3 w-3 text-primary" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteCommand(cmd.id)}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
