import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Loader2, Terminal, Check, X, Sparkles, Search, Music, Globe, MessageSquare, Zap } from "lucide-react";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface CommandResult {
  command: string;
  success: boolean;
  message: string;
  timestamp: Date;
}

type ServiceType = "web" | "youtube" | "chatgpt" | "perplexity";

const serviceConfig: Record<ServiceType, { label: string; icon: React.ReactNode; color: string }> = {
  web: { label: "Web", icon: <Globe className="h-3 w-3" />, color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  youtube: { label: "YouTube", icon: <Music className="h-3 w-3" />, color: "bg-red-500/20 text-red-400 border-red-500/30" },
  chatgpt: { label: "ChatGPT", icon: <MessageSquare className="h-3 w-3" />, color: "bg-green-500/20 text-green-400 border-green-500/30" },
  perplexity: { label: "Perplexity", icon: <Zap className="h-3 w-3" />, color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
};

export function CommandCenter() {
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [history, setHistory] = useState<CommandResult[]>([]);
  const [selectedService, setSelectedService] = useState<ServiceType>("web");
  const { sendCommand } = useDeviceCommands();
  const { toast } = useToast();

  const parseAndExecute = useCallback(
    async (text: string, service: ServiceType) => {
      const lower = text.toLowerCase().trim();

      // Helper to add result to history
      const addResult = (success: boolean, message: string) => {
        setHistory((prev) => [
          { command: text, success, message, timestamp: new Date() },
          ...prev.slice(0, 19),
        ]);
      };

      try {
        // If a service is selected, use it directly
        if (service !== "web") {
          if (service === "youtube") {
            // Play on YouTube
            const result = await sendCommand("play_music", { query: text, service: "youtube" }, { awaitResult: true, timeoutMs: 10000 });
            addResult(result.success, result.success ? `Playing "${text}" on YouTube` : result.error || "Failed");
            return;
          } else if (service === "chatgpt") {
            // Search on ChatGPT
            const result = await sendCommand("search_web", { query: text, engine: "chatgpt" }, { awaitResult: true, timeoutMs: 10000 });
            addResult(result.success, result.success ? `Asked ChatGPT: "${text}"` : result.error || "Failed");
            return;
          } else if (service === "perplexity") {
            // Search on Perplexity
            const result = await sendCommand("search_web", { query: text, engine: "perplexity" }, { awaitResult: true, timeoutMs: 10000 });
            addResult(result.success, result.success ? `Asked Perplexity: "${text}"` : result.error || "Failed");
            return;
          }
        }

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

        // Play music patterns - "play X" directly plays on YouTube
        const playMatch = lower.match(/^play\s+(.+?)(?:\s+on\s+(youtube|spotify|soundcloud|apple music))?$/i);
        if (playMatch) {
          const query = playMatch[1];
          const svc = playMatch[2] || "youtube";
          const result = await sendCommand("play_music", { query, service: svc }, { awaitResult: true, timeoutMs: 10000 });
          addResult(result.success, result.success ? `Playing "${query}" on ${svc}` : result.error || "Failed");
          return;
        }

        // Search patterns with service prefix
        const searchMatch = lower.match(
          /^(?:search|ask)\s+(?:(google|bing|youtube|wikipedia|chatgpt|perplexity|duckduckgo)\s+(?:for\s+)?)?(.+)$/i
        );
        if (searchMatch) {
          const engine = searchMatch[1] || "google";
          const query = searchMatch[2];
          const result = await sendCommand("search_web", { query, engine }, { awaitResult: true, timeoutMs: 10000 });
          addResult(result.success, result.success ? `Searching ${engine} for: ${query}` : result.error || "Failed");
          return;
        }

        // Open website patterns
        const websiteMatch = lower.match(
          /^(?:open|go to)\s+(google|youtube|github|reddit|twitter|facebook|instagram|linkedin|netflix|chatgpt|perplexity|wikipedia|gmail|drive|maps|.+\.(?:com|org|net|io|co|ai))(?:\s+and\s+(?:search|ask)\s+(?:for\s+)?(.+))?$/i
        );
        if (websiteMatch) {
          const site = websiteMatch[1];
          const query = websiteMatch[2] || "";
          const result = await sendCommand("open_website", { site, query }, { awaitResult: true, timeoutMs: 10000 });
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

        // If nothing matched and we have text, do a web search by default
        if (text.trim()) {
          const result = await sendCommand("search_web", { query: text, engine: "google" }, { awaitResult: true, timeoutMs: 6000 });
          addResult(result.success, result.success ? `Searched Google for: ${text}` : result.error || "Failed");
          return;
        }

        // Unknown command
        addResult(false, `Unknown command. Try: "open chrome", "play Bohemian Rhapsody", "ask chatgpt about python"`);
      } catch (error) {
        addResult(false, String(error));
      }
    },
    [sendCommand]
  );

  const handleSubmit = async () => {
    if (!input.trim() || isProcessing) return;

    setIsProcessing(true);
    await parseAndExecute(input.trim(), selectedService);
    setInput("");
    setIsProcessing(false);
  };

  const examples = [
    "play Bohemian Rhapsody",
    "open chrome",
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
        {/* Service Selector */}
        <div className="grid grid-cols-4 gap-1.5 w-full">
          {(Object.keys(serviceConfig) as ServiceType[]).map((svc) => (
            <Badge
              key={svc}
              variant="outline"
              className={cn(
                "cursor-pointer transition-all flex items-center justify-center gap-1 px-2 py-1.5 text-[10px]",
                selectedService === svc
                  ? serviceConfig[svc].color + " border-2"
                  : "hover:bg-secondary/50"
              )}
              onClick={() => setSelectedService(svc)}
            >
              {serviceConfig[svc].icon}
              {serviceConfig[svc].label}
            </Badge>
          ))}
        </div>

        {/* Input */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={
                selectedService === "youtube"
                  ? "Search and play on YouTube..."
                  : selectedService === "chatgpt"
                  ? "Ask ChatGPT anything..."
                  : selectedService === "perplexity"
                  ? "Search with Perplexity AI..."
                  : "Type a command or search..."
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              className="pl-10"
              disabled={isProcessing}
            />
          </div>
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
        <div className="grid grid-cols-2 gap-1.5 w-full">
          {examples.map((ex) => (
            <Badge
              key={ex}
              variant="outline"
              className="cursor-pointer hover:bg-primary/10 text-[10px] justify-center py-1.5 truncate"
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
