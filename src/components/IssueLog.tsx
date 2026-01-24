import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, Bug, Info, X, Trash2, Share2, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  source: "web" | "agent";
  message: string;
  details?: string;
}

// Global log store
let logEntries: LogEntry[] = [];
let logListeners: Set<(logs: LogEntry[]) => void> = new Set();

export const addLog = (level: LogLevel, source: "web" | "agent", message: string, details?: string) => {
  const entry: LogEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date(),
    level,
    source,
    message,
    details,
  };
  logEntries = [entry, ...logEntries].slice(0, 100); // Keep last 100 logs
  logListeners.forEach((listener) => listener([...logEntries]));
};

export const clearLogs = () => {
  logEntries = [];
  logListeners.forEach((listener) => listener([]));
};

export const getLogs = () => [...logEntries];

export const useLogs = () => {
  const [logs, setLogs] = useState<LogEntry[]>(logEntries);

  useEffect(() => {
    const listener = (newLogs: LogEntry[]) => setLogs(newLogs);
    logListeners.add(listener);
    return () => {
      logListeners.delete(listener);
    };
  }, []);

  return logs;
};

// Format logs for sharing
export const formatLogsForSharing = (logs: LogEntry[], filter?: LogLevel): string => {
  const filteredLogs = filter ? logs.filter(l => l.level === filter) : logs;
  
  const header = `=== JARVIS Issue Log ===
Generated: ${new Date().toISOString()}
Total Entries: ${filteredLogs.length}
${filter ? `Filter: ${filter.toUpperCase()} only` : "Filter: All"}
========================

`;

  const logText = filteredLogs.map(log => {
    const time = log.timestamp.toISOString();
    const level = log.level.toUpperCase().padEnd(5);
    const source = log.source.toUpperCase().padEnd(5);
    let entry = `[${time}] [${level}] [${source}] ${log.message}`;
    if (log.details) {
      entry += `\n    Details: ${log.details}`;
    }
    return entry;
  }).join("\n\n");

  return header + logText;
};

// Initialize console overrides to capture errors
if (typeof window !== "undefined") {
  const originalError = console.error;
  const originalWarn = console.warn;

  console.error = (...args) => {
    addLog("error", "web", args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "));
    originalError.apply(console, args);
  };

  console.warn = (...args) => {
    addLog("warn", "web", args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "));
    originalWarn.apply(console, args);
  };

  // Capture unhandled errors
  window.addEventListener("error", (event) => {
    addLog("error", "web", event.message, `${event.filename}:${event.lineno}:${event.colno}`);
  });

  window.addEventListener("unhandledrejection", (event) => {
    addLog("error", "web", `Unhandled Promise Rejection: ${event.reason}`);
  });
}

interface IssueLogProps {
  className?: string;
  compact?: boolean;
}

export function IssueLog({ className, compact = false }: IssueLogProps) {
  const logs = useLogs();
  const [isExpanded, setIsExpanded] = useState(!compact);
  const [filter, setFilter] = useState<LogLevel | "all">("all");
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const filteredLogs = filter === "all" ? logs : logs.filter((l) => l.level === filter);

  const errorCount = logs.filter((l) => l.level === "error").length;
  const warnCount = logs.filter((l) => l.level === "warn").length;

  const getLevelIcon = (level: LogLevel) => {
    switch (level) {
      case "error":
        return <Bug className="h-4 w-4 text-destructive" />;
      case "warn":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Info className="h-4 w-4 text-primary" />;
    }
  };

  const getLevelColor = (level: LogLevel) => {
    switch (level) {
      case "error":
        return "text-destructive";
      case "warn":
        return "text-yellow-500";
      default:
        return "text-muted-foreground";
    }
  };

  const handleCopyLogs = async () => {
    const text = formatLogsForSharing(logs, filter === "all" ? undefined : filter);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast({
      title: "Logs Copied!",
      description: "Share these logs to help debug issues",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShareLogs = async () => {
    const text = formatLogsForSharing(logs, filter === "all" ? undefined : filter);
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: "JARVIS Issue Log",
          text: text,
        });
      } catch (err) {
        // User cancelled or share failed, fall back to copy
        handleCopyLogs();
      }
    } else {
      handleCopyLogs();
    }
  };

  if (compact && !isExpanded) {
    return (
      <Button
        variant="outline"
        size="sm"
        className={cn("gap-2", className)}
        onClick={() => setIsExpanded(true)}
      >
        <Bug className="h-4 w-4" />
        <span>Logs</span>
        {errorCount > 0 && (
          <Badge variant="destructive" className="h-5 px-1.5 text-xs">
            {errorCount}
          </Badge>
        )}
        {warnCount > 0 && (
          <Badge variant="secondary" className="h-5 px-1.5 text-xs bg-yellow-500/20 text-yellow-500">
            {warnCount}
          </Badge>
        )}
      </Button>
    );
  }

  return (
    <Card className={cn("glass-dark border-border/50", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bug className="h-5 w-5 text-primary" />
            Issue Log
            {errorCount > 0 && (
              <Badge variant="destructive" className="ml-2">
                {errorCount} errors
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              <Button
                variant={filter === "all" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setFilter("all")}
              >
                All
              </Button>
              <Button
                variant={filter === "error" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setFilter("error")}
              >
                Errors
              </Button>
              <Button
                variant={filter === "warn" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setFilter("warn")}
              >
                Warnings
              </Button>
            </div>
            <Button 
              variant="outline" 
              size="icon" 
              className="h-7 w-7" 
              onClick={handleShareLogs}
              title="Share logs"
            >
              {copied ? <Check className="h-4 w-4 text-neon-green" /> : <Share2 className="h-4 w-4" />}
            </Button>
            <Button 
              variant="outline" 
              size="icon" 
              className="h-7 w-7" 
              onClick={handleCopyLogs}
              title="Copy logs"
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={clearLogs}>
              <Trash2 className="h-4 w-4" />
            </Button>
            {compact && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsExpanded(false)}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ScrollArea className="h-[200px]">
          {filteredLogs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              No issues logged
            </div>
          ) : (
            <div className="space-y-2">
              {filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-2 p-2 rounded-lg bg-secondary/30 text-sm"
                >
                  {getLevelIcon(log.level)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {log.source}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {log.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                    <p className={cn("mt-1 break-words", getLevelColor(log.level))}>
                      {log.message}
                    </p>
                    {log.details && (
                      <p className="text-xs text-muted-foreground mt-1">{log.details}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
