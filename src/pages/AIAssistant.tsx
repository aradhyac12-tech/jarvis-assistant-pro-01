import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Send, 
  Bot, 
  User, 
  Loader2, 
  Zap, 
  Mic, 
  MicOff, 
  Volume2,
  Settings,
  Smartphone,
  Monitor,
  Globe,
  Music,
  Search,
  Sun,
  Moon,
  Lock,
  Power,
  FolderOpen,
  Calendar,
  StickyNote,
  Terminal,
  Wifi,
  WifiOff,
  ChevronDown,
  ChevronUp,
  Plus,
  Sparkles,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  VolumeX,
  Volume1,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useWebSpeechTTS } from "@/hooks/useWebSpeechTTS";
import { useContinuousVoice } from "@/hooks/useContinuousVoice";
import { CircularWaveform } from "@/components/AudioWaveform";
import { BackButton } from "@/components/BackButton";
import { supabase } from "@/integrations/supabase/client";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface QuickCommand {
  icon: React.ReactNode;
  label: string;
  command: string;
  color: string;
}

const pcCommands: QuickCommand[] = [
  { icon: <Lock className="h-4 w-4" />, label: "Lock", command: "lock", color: "bg-orange-500/20 text-orange-400" },
  { icon: <Moon className="h-4 w-4" />, label: "Sleep", command: "sleep", color: "bg-blue-500/20 text-blue-400" },
  { icon: <Power className="h-4 w-4" />, label: "Shutdown", command: "shutdown", color: "bg-red-500/20 text-red-400" },
  { icon: <Zap className="h-4 w-4" />, label: "Boost", command: "boost", color: "bg-green-500/20 text-green-400" },
];

const mediaCommands: QuickCommand[] = [
  { icon: <Play className="h-4 w-4" />, label: "Play/Pause", command: "media_control", color: "bg-primary/20 text-primary" },
  { icon: <SkipBack className="h-4 w-4" />, label: "Previous", command: "previous", color: "bg-muted text-muted-foreground" },
  { icon: <SkipForward className="h-4 w-4" />, label: "Next", command: "next", color: "bg-muted text-muted-foreground" },
  { icon: <VolumeX className="h-4 w-4" />, label: "Mute", command: "mute", color: "bg-muted text-muted-foreground" },
];

export function AIAssistant() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [inputText, setInputText] = useState("");
  const [activeTab, setActiveTab] = useState("chat");
  const [showQuickActions, setShowQuickActions] = useState(true);
  const [volume, setVolume] = useState(50);
  const [brightness, setBrightness] = useState(50);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { session } = useDeviceSession();
  const isConnected = !!session?.session_token;

  const { speak, stopSpeaking, isSpeaking } = useWebSpeechTTS({ rate: 1.0, pitch: 1.0 });
  const [voiceEnabled, setVoiceEnabled] = useState(true);

  const { 
    isListening, 
    isWakeWordActive,
    interimTranscript,
    startListening, 
    stopListening,
    isSupported: voiceSupported,
  } = useContinuousVoice({
    wakeWord: "jarvis",
    continuous: true,
    onTranscript: (text, isFinal) => {
      if (isFinal && text.trim()) {
        handleVoiceCommand(text.trim());
      }
    },
    onError: (error) => {
      toast({ variant: "destructive", title: "Voice Error", description: error });
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleVoiceCommand = useCallback(async (text: string) => {
    const userMessage: Message = { id: Date.now().toString(), role: "user", content: text, timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    await processAIMessage(text);
  }, []);

  const processAIMessage = async (text: string) => {
    setIsProcessing(true);
    try {
      if (!session?.session_token) throw new Error("Not paired. Please connect your PC first.");

      const { data, error } = await supabase.functions.invoke("jarvis-chat", {
        body: { message: text },
        headers: { "x-session-token": session.session_token },
      });

      if (error) throw new Error(error.message || "Failed to get AI response");

      const responseText = (data as Record<string, unknown>)?.response as string ?? "";
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: responseText,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
      if (voiceEnabled && responseText) speak(responseText);
      
      // Execute commands if present
      const commands = (data as Record<string, unknown>)?.commands as Array<Record<string, unknown>>;
      if (commands && commands.length > 0) {
        for (const cmd of commands) {
          await executeCommand(cmd);
        }
      }
    } catch (error) {
      console.error("Error:", error);
      const errorMsg = error instanceof Error ? error.message : "Failed to get AI response";
      toast({ title: "Error", description: errorMsg, variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };

  const executeCommand = async (cmd: Record<string, unknown>) => {
    const action = cmd.action as string;
    try {
      switch (action) {
        case "open_app":
          await sendCommand("open_app", { app_name: cmd.app_name }, { awaitResult: true, timeoutMs: 8000 });
          break;
        case "close_app":
          await sendCommand("close_app", { app_name: cmd.app_name }, { awaitResult: true, timeoutMs: 8000 });
          break;
        case "play_music":
          await sendCommand("play_music", { query: cmd.query, service: "youtube" }, { awaitResult: true, timeoutMs: 10000 });
          break;
        case "media_control":
          await sendCommand("media_control", { action: cmd.control || "play_pause" }, { awaitResult: true, timeoutMs: 4000 });
          break;
        case "set_volume":
          await sendCommand("set_volume", { level: cmd.level }, { awaitResult: true, timeoutMs: 4000 });
          setVolume(cmd.level as number);
          break;
        case "set_brightness":
          await sendCommand("set_brightness", { level: cmd.level }, { awaitResult: true, timeoutMs: 4000 });
          setBrightness(cmd.level as number);
          break;
        case "lock":
          await sendCommand("lock", {}, { awaitResult: true, timeoutMs: 4000 });
          break;
        case "sleep":
          await sendCommand("sleep", {}, { awaitResult: true, timeoutMs: 4000 });
          break;
        case "shutdown":
          await sendCommand("shutdown", {}, { awaitResult: true, timeoutMs: 4000 });
          break;
        case "search_web":
          await sendCommand("search_web", { engine: cmd.engine || "google", query: cmd.query }, { awaitResult: true, timeoutMs: 10000 });
          break;
        case "open_website":
          await sendCommand("open_website", { site: cmd.site, query: cmd.query || "" }, { awaitResult: true, timeoutMs: 10000 });
          break;
        default:
          console.warn("Unknown command:", action);
      }
    } catch (e) {
      console.error("Command execution error:", e);
    }
  };

  const handleSendMessage = useCallback(async (text?: string) => {
    const messageText = text || inputText;
    if (!messageText.trim() || isProcessing) return;
    const userMessage: Message = { id: Date.now().toString(), role: "user", content: messageText, timestamp: new Date() };
    setMessages((prev) => [...prev, userMessage]);
    setInputText("");
    await processAIMessage(messageText);
  }, [inputText, isProcessing, session?.session_token]);

  const handleQuickCommand = async (command: string) => {
    try {
      if (command === "media_control") {
        await sendCommand("media_control", { action: "play_pause" }, { awaitResult: true, timeoutMs: 4000 });
      } else if (command === "next") {
        await sendCommand("media_control", { action: "next" }, { awaitResult: true, timeoutMs: 4000 });
      } else if (command === "previous") {
        await sendCommand("media_control", { action: "previous" }, { awaitResult: true, timeoutMs: 4000 });
      } else if (command === "mute") {
        await sendCommand("media_control", { action: "mute" }, { awaitResult: true, timeoutMs: 4000 });
      } else {
        await sendCommand(command, {}, { awaitResult: true, timeoutMs: 8000 });
      }
      toast({ title: "Success", description: `Command executed: ${command}` });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: `Failed: ${command}` });
    }
  };

  const handleVolumeChange = async (newVolume: number) => {
    setVolume(newVolume);
    try {
      await sendCommand("set_volume", { level: newVolume }, { awaitResult: true, timeoutMs: 4000 });
    } catch (e) {
      console.error("Volume change error:", e);
    }
  };

  const handleBrightnessChange = async (newBrightness: number) => {
    setBrightness(newBrightness);
    try {
      await sendCommand("set_brightness", { level: newBrightness }, { awaitResult: true, timeoutMs: 4000 });
    } catch (e) {
      console.error("Brightness change error:", e);
    }
  };

  const toggleVoice = useCallback(() => {
    if (isListening) { stopListening(); stopSpeaking(); }
    else startListening();
  }, [isListening, startListening, stopListening, stopSpeaking]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/95 backdrop-blur-sm">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-3">
            <BackButton />
            <div>
              <h1 className="font-semibold text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                AI Assistant
              </h1>
              <p className="text-xs text-muted-foreground">
                {isConnected ? "PC Connected" : "Offline"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant={isConnected ? "default" : "secondary"} className="text-xs gap-1">
              {isConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {isConnected ? "Online" : "Offline"}
            </Badge>
            
            {voiceSupported && (
              <Button 
                variant={isListening ? "destructive" : "outline"} 
                size="icon" 
                className="h-8 w-8"
                onClick={toggleVoice}
              >
                {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
        {/* Quick Actions Toggle */}
        <Button
          variant="ghost"
          size="sm"
          className="self-start gap-2 text-muted-foreground"
          onClick={() => setShowQuickActions(!showQuickActions)}
        >
          {showQuickActions ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          Quick Actions
        </Button>

        {/* Quick Actions Panel */}
        {showQuickActions && (
          <div className="space-y-4 animate-in slide-in-from-top-2">
            {/* PC Controls */}
            <div className="grid grid-cols-4 gap-2">
              {pcCommands.map((cmd) => (
                <Button
                  key={cmd.command}
                  variant="outline"
                  className={cn("flex flex-col h-auto py-3 gap-1", cmd.color)}
                  onClick={() => handleQuickCommand(cmd.command)}
                  disabled={!isConnected}
                >
                  {cmd.icon}
                  <span className="text-[10px]">{cmd.label}</span>
                </Button>
              ))}
            </div>

            {/* Media Controls */}
            <Card className="border-border/40">
              <CardContent className="p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Media Controls</span>
                  <div className="flex gap-1">
                    {mediaCommands.map((cmd) => (
                      <Button
                        key={cmd.command}
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleQuickCommand(cmd.command)}
                        disabled={!isConnected}
                      >
                        {cmd.icon}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Volume Slider */}
                <div className="flex items-center gap-3">
                  <Volume1 className="h-4 w-4 text-muted-foreground" />
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={volume}
                    onChange={(e) => handleVolumeChange(parseInt(e.target.value))}
                    className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer"
                    disabled={!isConnected}
                  />
                  <span className="text-xs w-8 text-right">{volume}%</span>
                </div>

                {/* Brightness Slider */}
                <div className="flex items-center gap-3">
                  <Sun className="h-4 w-4 text-muted-foreground" />
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={brightness}
                    onChange={(e) => handleBrightnessChange(parseInt(e.target.value))}
                    className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer"
                    disabled={!isConnected}
                  />
                  <span className="text-xs w-8 text-right">{brightness}%</span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Chat Area */}
        <Card className="flex-1 border-border/40 overflow-hidden flex flex-col min-h-0">
          <ScrollArea className="flex-1 p-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4">
                <div className="relative mb-4">
                  <CircularWaveform isActive={isListening || isSpeaking} mode={isSpeaking ? "speaking" : isListening ? "listening" : "idle"} size={100} />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Bot className="w-8 h-8 text-primary" />
                  </div>
                </div>

                <h2 className="text-lg font-semibold mb-1">Hey, I'm your AI Assistant!</h2>
                <p className="text-muted-foreground text-sm mb-4 max-w-xs">
                  Control your PC, play music, search the web, and more. Just ask!
                </p>

                {/* Example Commands */}
                <div className="grid grid-cols-2 gap-2 w-full max-w-xs">
                  {[
                    { icon: <Music className="h-3 w-3" />, text: "Play some music" },
                    { icon: <Globe className="h-3 w-3" />, text: "Search Google" },
                    { icon: <Monitor className="h-3 w-3" />, text: "Open Chrome" },
                    { icon: <Calendar className="h-3 w-3" />, text: "Open Calendar" },
                  ].map((ex, i) => (
                    <Button
                      key={i}
                      variant="outline"
                      size="sm"
                      className="justify-start gap-2 text-xs h-auto py-2"
                      onClick={() => handleSendMessage(ex.text)}
                      disabled={!isConnected}
                    >
                      {ex.icon}
                      {ex.text}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((msg) => (
                  <div key={msg.id} className={cn("flex gap-2", msg.role === "user" ? "justify-end" : "justify-start")}>
                    {msg.role === "assistant" && (
                      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Bot className="w-4 h-4 text-primary" />
                      </div>
                    )}
                    <div className={cn(
                      "max-w-[80%] rounded-2xl px-3 py-2",
                      msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                    )}>
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    </div>
                    {msg.role === "user" && (
                      <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <User className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                ))}
                {isProcessing && (
                  <div className="flex gap-2">
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                      <Bot className="w-4 h-4 text-primary" />
                    </div>
                    <div className="bg-muted rounded-2xl px-3 py-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </div>
                  </div>
                )}
                <div ref={scrollRef} />
              </div>
            )}
          </ScrollArea>

          {/* Interim transcript display */}
          {interimTranscript && (
            <div className="px-4 py-2 border-t border-border/40 bg-muted/50">
              <p className="text-sm text-muted-foreground italic truncate">
                🎤 {interimTranscript}
              </p>
            </div>
          )}

          {/* Input */}
          <div className="p-3 border-t border-border/40">
            <div className="flex gap-2">
              {voiceSupported && (
                <Button 
                  variant={isListening ? "destructive" : "outline"} 
                  size="icon" 
                  onClick={toggleVoice} 
                  className="shrink-0"
                >
                  {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </Button>
              )}
              <Input
                placeholder={isConnected ? "Ask me anything..." : "Connect PC to start..."}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
                disabled={isProcessing || !isConnected}
                className="flex-1"
              />
              <Button 
                onClick={() => handleSendMessage()} 
                disabled={isProcessing || !inputText.trim() || !isConnected} 
                size="icon" 
                className="shrink-0"
              >
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default AIAssistant;
