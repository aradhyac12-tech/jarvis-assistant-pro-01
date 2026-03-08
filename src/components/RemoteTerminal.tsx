import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Terminal, Send, Loader2, Trash2, Copy, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useToast } from "@/hooks/use-toast";

interface TerminalLine {
  id: string;
  type: "input" | "output" | "error" | "system";
  content: string;
  timestamp: Date;
}

const QUICK_COMMANDS = [
  { label: "ipconfig", cmd: "ipconfig" },
  { label: "tasklist", cmd: "tasklist /FO CSV /NH" },
  { label: "systeminfo", cmd: "systeminfo" },
  { label: "dir", cmd: "dir" },
  { label: "whoami", cmd: "whoami" },
  { label: "netstat", cmd: "netstat -an" },
];

export function RemoteTerminal({ isConnected, className }: { isConnected: boolean; className?: string }) {
  const { sendCommand } = useDeviceCommands();
  const { toast } = useToast();
  const [lines, setLines] = useState<TerminalLine[]>([
    { id: "welcome", type: "system", content: "JARVIS Remote Terminal v1.0 — Type a command or use quick actions below.", timestamp: new Date() },
  ]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addLine = useCallback((type: TerminalLine["type"], content: string) => {
    setLines(prev => [...prev, { id: crypto.randomUUID(), type, content, timestamp: new Date() }]);
  }, []);

  const executeCommand = useCallback(async (cmd: string) => {
    if (!cmd.trim()) return;
    
    addLine("input", `> ${cmd}`);
    setHistory(prev => [cmd, ...prev].slice(0, 50));
    setHistoryIdx(-1);
    setInput("");
    setRunning(true);

    try {
      const result = await sendCommand("run_command", { command: cmd }, {
        awaitResult: true,
        timeoutMs: 30000,
      });

      if (result.success && "result" in result) {
        const r = result.result as any;
        const output = r.stdout || r.output || r.message || JSON.stringify(r);
        if (output) addLine("output", output);
        if (r.stderr) addLine("error", r.stderr);
        if (r.exit_code !== undefined && r.exit_code !== 0) {
          addLine("error", `Exit code: ${r.exit_code}`);
        }
      } else {
        addLine("error", `Error: ${result.error || "Command failed"}`);
      }
    } catch (err) {
      addLine("error", `Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    setRunning(false);
  }, [sendCommand, addLine]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !running) {
      executeCommand(input);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const nextIdx = Math.min(historyIdx + 1, history.length - 1);
      if (history[nextIdx]) {
        setHistoryIdx(nextIdx);
        setInput(history[nextIdx]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIdx = historyIdx - 1;
      if (nextIdx < 0) {
        setHistoryIdx(-1);
        setInput("");
      } else {
        setHistoryIdx(nextIdx);
        setInput(history[nextIdx]);
      }
    }
  };

  const copyOutput = () => {
    const text = lines.filter(l => l.type !== "system").map(l => l.content).join("\n");
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  return (
    <Card className={cn("border-border/20 bg-card/50", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Terminal className="h-4 w-4 text-primary" />
          Remote Terminal
          {isConnected ? (
            <Badge variant="default" className="ml-auto text-[10px]">Connected</Badge>
          ) : (
            <Badge variant="secondary" className="ml-auto text-[10px]">Offline</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Quick Commands */}
        <div className="flex flex-wrap gap-1">
          {QUICK_COMMANDS.map(qc => (
            <Button
              key={qc.label}
              variant="outline"
              size="sm"
              className="h-6 text-[10px] px-2 font-mono"
              onClick={() => executeCommand(qc.cmd)}
              disabled={running || !isConnected}
            >
              {qc.label}
            </Button>
          ))}
        </div>

        {/* Terminal Output */}
        <div className="relative">
          <ScrollArea className="h-52 rounded-lg bg-background/80 border border-border/30 font-mono text-[11px]" ref={scrollRef as any}>
            <div className="p-2 space-y-0.5">
              {lines.map(line => (
                <div key={line.id} className={cn(
                  "whitespace-pre-wrap break-all leading-relaxed",
                  line.type === "input" && "text-primary font-semibold",
                  line.type === "output" && "text-foreground",
                  line.type === "error" && "text-destructive",
                  line.type === "system" && "text-muted-foreground italic",
                )}>
                  {line.content}
                </div>
              ))}
              {running && (
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Running...
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Top-right actions */}
          <div className="absolute top-1 right-1 flex gap-0.5">
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={copyOutput} title="Copy output">
              <Copy className="h-2.5 w-2.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setLines([
              { id: "cleared", type: "system", content: "Terminal cleared.", timestamp: new Date() },
            ])} title="Clear">
              <Trash2 className="h-2.5 w-2.5" />
            </Button>
          </div>
        </div>

        {/* Input */}
        <div className="flex gap-1">
          <div className="flex-1 relative">
            <ChevronRight className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-primary" />
            <Input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isConnected ? "Type a command..." : "Connect to PC first"}
              disabled={!isConnected || running}
              className="h-8 text-xs font-mono pl-6"
            />
          </div>
          <Button
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => executeCommand(input)}
            disabled={!input.trim() || running || !isConnected}
          >
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
