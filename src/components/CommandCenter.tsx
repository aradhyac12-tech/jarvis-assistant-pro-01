import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Loader2, Terminal, Check, X, Sparkles } from "lucide-react";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface CommandResult {
  command: string;
  success: boolean;
  message: string;
  timestamp: Date;
}

export function CommandCenter() {
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [history, setHistory] = useState<CommandResult[]>([]);
  const { sendCommand } = useDeviceCommands();
  const { toast } = useToast();

  const parseAndExecute = useCallback(
    async (text: string) => {
      const lower = text.toLowerCase().trim();

      // Helper to add result to history
      const addResult = (success: boolean, message: string) => {
        setHistory((prev) => [
          { command: text, success, message, timestamp: new Date() },
          ...prev.slice(0, 19),
        ]);
      };

      try {
        // Open app patterns
        const openAppMatch = lower.match(
          /^open\s+(chrome|firefox|edge|notepad|spotify|vscode|vs code|discord|steam|telegram|whatsapp|obs|zoom|teams|slack|brave|calculator|calc|terminal|cmd|powershell|explorer|vlc|settings|paint|word|excel|powerpoint|outlook|photoshop|gimp|blender|git bash|postman|docker|.+)$/i
        );
        if (openAppMatch) {
          const app = openAppMatch[1];
          const result = await sendCommand("open_app", { app_name: app }, { awaitResult: true, timeoutMs: 6000 });
          addResult(result.success, result.success ? `Opened ${app}` : result.error || "Failed");
          return;
        }

        // Play music patterns
        const playMatch = lower.match(/^play\s+(.+?)(?:\s+on\s+(youtube|spotify|soundcloud|apple music))?$/i);
        if (playMatch) {
          const query = playMatch[1];
          const service = playMatch[2] || "youtube";
          const result = await sendCommand("play_music", { query, service }, { awaitResult: true, timeoutMs: 6000 });
          addResult(result.success, result.success ? `Playing ${query} on ${service}` : result.error || "Failed");
          return;
        }

        // Search patterns
        const searchMatch = lower.match(
          /^search\s+(?:(google|bing|youtube|wikipedia|chatgpt|perplexity|duckduckgo)\s+(?:for\s+)?)?(.+)$/i
        );
        if (searchMatch) {
          const engine = searchMatch[1] || "google";
          const query = searchMatch[2];
          const result = await sendCommand("search_web", { query, engine }, { awaitResult: true, timeoutMs: 6000 });
          addResult(result.success, result.success ? `Searching ${engine} for: ${query}` : result.error || "Failed");
          return;
        }

        // Open website patterns
        const websiteMatch = lower.match(
          /^(?:open|go to)\s+(google|youtube|github|reddit|twitter|facebook|instagram|linkedin|netflix|chatgpt|perplexity|wikipedia|gmail|drive|maps|.+\.(?:com|org|net|io|co|ai))(?:\s+and\s+search\s+(?:for\s+)?(.+))?$/i
        );
        if (websiteMatch) {
          const site = websiteMatch[1];
          const query = websiteMatch[2] || "";
          const result = await sendCommand("open_website", { site, query }, { awaitResult: true, timeoutMs: 6000 });
          addResult(result.success, result.success ? `Opened ${site}` + (query ? ` with query: ${query}` : "") : result.error || "Failed");
          return;
        }

        // URL patterns
        const urlMatch = lower.match(/^(?:open|go to)\s+(https?:\/\/.+)$/i);
        if (urlMatch) {
          const url = urlMatch[1];
          const result = await sendCommand("open_url", { url }, { awaitResult: true, timeoutMs: 6000 });
          addResult(result.success, result.success ? `Opened ${url}` : result.error || "Failed");
          return;
        }

        // Volume patterns
        const volumeMatch = lower.match(/^(?:set\s+)?volume\s+(?:to\s+)?(\d+)%?$/i);
        if (volumeMatch) {
          const level = parseInt(volumeMatch[1]);
          const result = await sendCommand("set_volume", { level }, { awaitResult: true, timeoutMs: 4000 });
          addResult(result.success, result.success ? `Volume set to ${level}%` : result.error || "Failed");
          return;
        }

        // Brightness patterns
        const brightnessMatch = lower.match(/^(?:set\s+)?brightness\s+(?:to\s+)?(\d+)%?$/i);
        if (brightnessMatch) {
          const level = parseInt(brightnessMatch[1]);
          const result = await sendCommand("set_brightness", { level }, { awaitResult: true, timeoutMs: 4000 });
          addResult(result.success, result.success ? `Brightness set to ${level}%` : result.error || "Failed");
          return;
        }

        // Media controls
        if (lower === "pause" || lower === "play" || lower === "play/pause" || lower === "playpause") {
          const result = await sendCommand("media_control", { action: "play_pause" }, { awaitResult: true, timeoutMs: 4000 });
          addResult(result.success, result.success ? "Toggled play/pause" : result.error || "Failed");
          return;
        }
        if (lower === "next" || lower === "next track" || lower === "skip") {
          const result = await sendCommand("media_control", { action: "next" }, { awaitResult: true, timeoutMs: 4000 });
          addResult(result.success, result.success ? "Skipped to next track" : result.error || "Failed");
          return;
        }
        if (lower === "previous" || lower === "prev" || lower === "previous track") {
          const result = await sendCommand("media_control", { action: "previous" }, { awaitResult: true, timeoutMs: 4000 });
          addResult(result.success, result.success ? "Went to previous track" : result.error || "Failed");
          return;
        }
        if (lower === "mute" || lower === "unmute") {
          const result = await sendCommand("media_control", { action: "mute" }, { awaitResult: true, timeoutMs: 4000 });
          addResult(result.success, result.success ? "Toggled mute" : result.error || "Failed");
          return;
        }

        // System commands
        if (lower === "lock" || lower === "lock screen" || lower === "lock pc") {
          const result = await sendCommand("lock", {}, { awaitResult: true, timeoutMs: 4000 });
          addResult(result.success, result.success ? "Screen locked" : result.error || "Failed");
          return;
        }
        if (lower === "sleep" || lower === "sleep pc") {
          const result = await sendCommand("sleep", {}, { awaitResult: true, timeoutMs: 4000 });
          addResult(result.success, result.success ? "PC going to sleep" : result.error || "Failed");
          return;
        }
        if (lower === "restart" || lower === "reboot") {
          const result = await sendCommand("restart", {}, { awaitResult: true, timeoutMs: 4000 });
          addResult(result.success, result.success ? "Restarting PC" : result.error || "Failed");
          return;
        }
        if (lower === "shutdown" || lower === "shut down") {
          const result = await sendCommand("shutdown", {}, { awaitResult: true, timeoutMs: 4000 });
          addResult(result.success, result.success ? "Shutting down PC" : result.error || "Failed");
          return;
        }
        if (lower === "boost" || lower === "boost pc" || lower === "optimize") {
          const result = await sendCommand("boost", {}, { awaitResult: true, timeoutMs: 10000 });
          addResult(result.success, result.success ? "PC boosted" : result.error || "Failed");
          return;
        }

        // Type text fallback
        if (lower.startsWith("type ")) {
          const textToType = text.slice(5);
          const result = await sendCommand("type_text", { text: textToType }, { awaitResult: true, timeoutMs: 4000 });
          addResult(result.success, result.success ? `Typed: ${textToType}` : result.error || "Failed");
          return;
        }

        // Close app
        const closeMatch = lower.match(/^close\s+(.+)$/i);
        if (closeMatch) {
          const app = closeMatch[1];
          const result = await sendCommand("close_app", { app_name: app }, { awaitResult: true, timeoutMs: 6000 });
          addResult(result.success, result.success ? `Closed ${app}` : result.error || "Failed");
          return;
        }

        // Unknown command - try as app open
        addResult(false, `Unknown command. Try: "open chrome", "play Bohemian Rhapsody", "search wikipedia black holes"`);
      } catch (error) {
        addResult(false, String(error));
      }
    },
    [sendCommand]
  );

  const handleSubmit = async () => {
    if (!input.trim() || isProcessing) return;

    setIsProcessing(true);
    await parseAndExecute(input.trim());
    setInput("");
    setIsProcessing(false);
  };

  const examples = [
    "open chrome",
    "play Ordinary by the Arkells",
    "search wikipedia black holes",
    "open chatgpt and search for python tutorials",
    "volume 50",
    "pause",
  ];

  return (
    <Card className="glass-dark border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Terminal className="h-5 w-5 text-primary" />
          Command Center
          <Badge variant="secondary" className="text-[10px]">
            <Sparkles className="h-3 w-3 mr-1" />
            Natural Language
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Input */}
        <div className="flex gap-2">
          <Input
            placeholder="Type a command... (e.g., 'play Bohemian Rhapsody on YouTube')"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            className="flex-1"
            disabled={isProcessing}
          />
          <Button
            onClick={handleSubmit}
            disabled={!input.trim() || isProcessing}
            className="gradient-primary"
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Quick examples */}
        <div className="flex flex-wrap gap-2">
          {examples.map((ex) => (
            <Badge
              key={ex}
              variant="outline"
              className="cursor-pointer hover:bg-primary/10 text-xs"
              onClick={() => setInput(ex)}
            >
              {ex}
            </Badge>
          ))}
        </div>

        {/* History */}
        {history.length > 0 && (
          <div className="border-t border-border/30 pt-3">
            <p className="text-xs text-muted-foreground mb-2">Recent commands</p>
            <ScrollArea className="h-[150px]">
              <div className="space-y-2">
                {history.map((item, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex items-start gap-2 p-2 rounded-lg text-sm",
                      item.success ? "bg-neon-green/5" : "bg-destructive/5"
                    )}
                  >
                    {item.success ? (
                      <Check className="h-4 w-4 text-neon-green shrink-0 mt-0.5" />
                    ) : (
                      <X className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{item.command}</p>
                      <p className="text-muted-foreground text-xs">{item.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
