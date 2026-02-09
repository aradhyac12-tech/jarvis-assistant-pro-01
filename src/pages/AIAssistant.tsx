import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
  Mic, 
  MicOff, 
  Volume2,
  Smartphone,
  Monitor,
  Globe,
  Music,
  Search,
  Sun,
  Moon,
  Lock,
  Power,
  Calendar,
  StickyNote,
  Wifi,
  WifiOff,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  VolumeX,
  Volume1,
  Clock,
  CloudSun,
  MessageSquare,
  Phone,
  Mail,
  Settings,
  Zap,
  Home,
  Timer,
  Bell,
  AlarmClock,
  MapPin,
  Camera,
  Image,
  Heart,
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
  type?: "text" | "weather" | "alarm" | "reminder" | "media";
}

interface QuickAction {
  icon: React.ReactNode;
  label: string;
  command: string;
  payload?: Record<string, unknown>;
  color: string;
}

const mobileActions: QuickAction[] = [
  { icon: <Phone className="h-4 w-4" />, label: "Call", command: "dial", color: "bg-green-500/20 text-green-400" },
  { icon: <MessageSquare className="h-4 w-4" />, label: "Text", command: "sms", color: "bg-blue-500/20 text-blue-400" },
  { icon: <Mail className="h-4 w-4" />, label: "Email", command: "email", color: "bg-purple-500/20 text-purple-400" },
  { icon: <Camera className="h-4 w-4" />, label: "Camera", command: "camera", color: "bg-pink-500/20 text-pink-400" },
];

const pcActions: QuickAction[] = [
  { icon: <Lock className="h-4 w-4" />, label: "Lock", command: "lock", color: "bg-orange-500/20 text-orange-400" },
  { icon: <Moon className="h-4 w-4" />, label: "Sleep", command: "sleep", color: "bg-blue-500/20 text-blue-400" },
  { icon: <Power className="h-4 w-4" />, label: "Shutdown", command: "shutdown", color: "bg-red-500/20 text-red-400" },
  { icon: <Zap className="h-4 w-4" />, label: "Boost", command: "boost", color: "bg-green-500/20 text-green-400" },
];

const mediaActions: QuickAction[] = [
  { icon: <Play className="h-4 w-4" />, label: "Play", command: "media_control", payload: { action: "play_pause" }, color: "bg-primary/20 text-primary" },
  { icon: <SkipBack className="h-4 w-4" />, label: "Prev", command: "media_control", payload: { action: "previous" }, color: "bg-muted text-muted-foreground" },
  { icon: <SkipForward className="h-4 w-4" />, label: "Next", command: "media_control", payload: { action: "next" }, color: "bg-muted text-muted-foreground" },
  { icon: <VolumeX className="h-4 w-4" />, label: "Mute", command: "media_control", payload: { action: "mute" }, color: "bg-muted text-muted-foreground" },
];

const utilityActions: QuickAction[] = [
  { icon: <CloudSun className="h-4 w-4" />, label: "Weather", command: "weather", color: "bg-sky-500/20 text-sky-400" },
  { icon: <AlarmClock className="h-4 w-4" />, label: "Alarm", command: "set_alarm", color: "bg-amber-500/20 text-amber-400" },
  { icon: <Timer className="h-4 w-4" />, label: "Timer", command: "set_timer", color: "bg-emerald-500/20 text-emerald-400" },
  { icon: <Bell className="h-4 w-4" />, label: "Remind", command: "set_reminder", color: "bg-violet-500/20 text-violet-400" },
];

const suggestedCommands = [
  { text: "What's the weather?", icon: <CloudSun className="h-3 w-3" /> },
  { text: "Play some music", icon: <Music className="h-3 w-3" /> },
  { text: "Open Chrome", icon: <Globe className="h-3 w-3" /> },
  { text: "Set a timer for 5 min", icon: <Timer className="h-3 w-3" /> },
  { text: "Lock my PC", icon: <Lock className="h-3 w-3" /> },
  { text: "Search Google for...", icon: <Search className="h-3 w-3" /> },
];

export function AIAssistant() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [inputText, setInputText] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "mobile" | "pc" | "media">("all");
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
  const [showSettings, setShowSettings] = useState(false);

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
      // Check for local mobile commands first
      const lowerText = text.toLowerCase();
      
      // Handle mobile-specific commands locally
      if (lowerText.includes("call ") || lowerText.includes("dial ")) {
        const response = "I'll help you make a call. Opening the dialer...";
        addAssistantMessage(response);
        // Extract number/contact and open dialer
        window.location.href = "tel:";
        return;
      }
      
      if (lowerText.includes("text ") || lowerText.includes("message ") || lowerText.includes("sms ")) {
        const response = "Opening messaging app...";
        addAssistantMessage(response);
        window.location.href = "sms:";
        return;
      }
      
      if (lowerText.includes("email ")) {
        const response = "Opening email...";
        addAssistantMessage(response);
        window.location.href = "mailto:";
        return;
      }
      
      if (lowerText.includes("weather")) {
        const response = "Let me check the weather for you. Opening weather...";
        addAssistantMessage(response, "weather");
        window.open("https://weather.com", "_blank");
        return;
      }
      
      if (lowerText.includes("timer") || lowerText.includes("alarm")) {
        // Extract time from message
        const match = lowerText.match(/(\d+)\s*(min|minute|sec|second|hour)/);
        if (match) {
          const amount = parseInt(match[1]);
          const unit = match[2];
          const ms = unit.startsWith("min") ? amount * 60000 : unit.startsWith("sec") ? amount * 1000 : amount * 3600000;
          const response = `Timer set for ${amount} ${unit}(s). I'll notify you when it's done!`;
          addAssistantMessage(response, "alarm");
          setTimeout(() => {
            toast({ title: "⏰ Timer Complete!", description: `Your ${amount} ${unit} timer is done!` });
            if (voiceEnabled) speak(`Your ${amount} ${unit} timer is complete.`);
          }, ms);
          return;
        }
      }

      // For PC commands, send to backend
      if (!session?.session_token) {
        addAssistantMessage("I'm not connected to your PC. Please pair your device first to control it remotely.");
        return;
      }

      const { data, error } = await supabase.functions.invoke("jarvis-chat", {
        body: { message: text },
        headers: { "x-session-token": session.session_token },
      });

      if (error) throw new Error(error.message || "Failed to get AI response");

      const responseText = (data as Record<string, unknown>)?.response as string ?? "";
      addAssistantMessage(responseText);
      
      // Execute commands if present
      const commands = (data as Record<string, unknown>)?.commands as Array<Record<string, unknown>>;
      if (commands && commands.length > 0) {
        for (const cmd of commands) {
          await executeCommand(cmd);
        }
      }
    } catch (error) {
      console.error("Error:", error);
      const errorMsg = error instanceof Error ? error.message : "Something went wrong. Please try again.";
      addAssistantMessage(errorMsg);
    } finally {
      setIsProcessing(false);
    }
  };

  const addAssistantMessage = (content: string, type?: Message["type"]) => {
    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content,
      timestamp: new Date(),
      type,
    };
    setMessages((prev) => [...prev, assistantMessage]);
    if (voiceEnabled && content) speak(content);
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
  }, [inputText, isProcessing]);

  const handleQuickAction = async (action: QuickAction) => {
    // Handle mobile-native actions
    if (action.command === "dial") {
      window.location.href = "tel:";
      return;
    }
    if (action.command === "sms") {
      window.location.href = "sms:";
      return;
    }
    if (action.command === "email") {
      window.location.href = "mailto:";
      return;
    }
    if (action.command === "camera") {
      // Request camera permission
      try {
        await navigator.mediaDevices.getUserMedia({ video: true });
        toast({ title: "Camera", description: "Camera access granted" });
      } catch {
        toast({ variant: "destructive", title: "Camera", description: "Camera access denied" });
      }
      return;
    }
    if (action.command === "weather") {
      window.open("https://weather.com", "_blank");
      return;
    }
    if (action.command === "set_alarm" || action.command === "set_timer") {
      setInputText(`Set a ${action.command === "set_alarm" ? "alarm" : "timer"} for `);
      return;
    }
    if (action.command === "set_reminder") {
      setInputText("Remind me to ");
      return;
    }

    // PC commands
    try {
      if (action.command === "media_control") {
        await sendCommand("media_control", action.payload || { action: "play_pause" }, { awaitResult: true, timeoutMs: 4000 });
      } else if (action.command === "boost") {
        await sendCommand("boost_ram", {}, { awaitResult: true, timeoutMs: 8000 });
        await sendCommand("clear_temp_files", {}, { awaitResult: true, timeoutMs: 8000 });
      } else {
        await sendCommand(action.command, action.payload || {}, { awaitResult: true, timeoutMs: 8000 });
      }
      toast({ title: "✓ Success", description: `${action.label} executed` });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: `Failed: ${action.label}` });
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

  const getActionsForTab = () => {
    switch (activeTab) {
      case "mobile": return mobileActions;
      case "pc": return pcActions;
      case "media": return mediaActions;
      default: return [...mobileActions, ...pcActions];
    }
  };

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
                {isConnected ? "PC Connected • Ready" : "Mobile Only Mode"}
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
                className={cn("h-8 w-8", isListening && "animate-pulse")}
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
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-muted-foreground"
            onClick={() => setShowQuickActions(!showQuickActions)}
          >
            {showQuickActions ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Quick Actions
          </Button>
          
          <div className="flex items-center gap-2">
            <Label htmlFor="voice-toggle" className="text-xs text-muted-foreground">Voice</Label>
            <Switch
              id="voice-toggle"
              checked={voiceEnabled}
              onCheckedChange={setVoiceEnabled}
              className="scale-75"
            />
          </div>
        </div>

        {/* Quick Actions Panel */}
        {showQuickActions && (
          <div className="space-y-4 animate-in slide-in-from-top-2">
            {/* Category Tabs */}
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="w-full">
              <TabsList className="grid grid-cols-4 h-8">
                <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
                <TabsTrigger value="mobile" className="text-xs">📱 Mobile</TabsTrigger>
                <TabsTrigger value="pc" className="text-xs">💻 PC</TabsTrigger>
                <TabsTrigger value="media" className="text-xs">🎵 Media</TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Action Buttons */}
            <div className="grid grid-cols-4 gap-2">
              {getActionsForTab().map((action) => (
                <Button
                  key={action.label}
                  variant="outline"
                  className={cn("flex flex-col h-auto py-3 gap-1 hover:scale-105 transition-transform", action.color)}
                  onClick={() => handleQuickAction(action)}
                  disabled={!isConnected && !["dial", "sms", "email", "camera", "weather", "set_alarm", "set_timer", "set_reminder"].includes(action.command)}
                >
                  {action.icon}
                  <span className="text-[10px]">{action.label}</span>
                </Button>
              ))}
            </div>

            {/* Utilities Row */}
            {activeTab === "all" && (
              <div className="grid grid-cols-4 gap-2">
                {utilityActions.map((action) => (
                  <Button
                    key={action.label}
                    variant="outline"
                    className={cn("flex flex-col h-auto py-3 gap-1 hover:scale-105 transition-transform", action.color)}
                    onClick={() => handleQuickAction(action)}
                  >
                    {action.icon}
                    <span className="text-[10px]">{action.label}</span>
                  </Button>
                ))}
              </div>
            )}

            {/* Media & System Controls */}
            <Card className="border-border/40">
              <CardContent className="p-3 space-y-3">
                {/* Media Controls */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium flex items-center gap-1">
                    <Music className="h-3 w-3" /> Media
                  </span>
                  <div className="flex gap-1">
                    {mediaActions.map((action) => (
                      <Button
                        key={action.label}
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleQuickAction(action)}
                        disabled={!isConnected}
                      >
                        {action.icon}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Volume */}
                <div className="flex items-center gap-3">
                  <Volume1 className="h-4 w-4 text-muted-foreground" />
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={volume}
                    onChange={(e) => handleVolumeChange(parseInt(e.target.value))}
                    className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    disabled={!isConnected}
                  />
                  <span className="text-xs w-8 text-right">{volume}%</span>
                </div>

                {/* Brightness */}
                <div className="flex items-center gap-3">
                  <Sun className="h-4 w-4 text-muted-foreground" />
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={brightness}
                    onChange={(e) => handleBrightnessChange(parseInt(e.target.value))}
                    className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
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

                <h2 className="text-lg font-semibold mb-1">Hey, I'm JARVIS!</h2>
                <p className="text-muted-foreground text-sm mb-4 max-w-xs">
                  Your AI assistant. Control your PC, set timers, make calls, and more!
                </p>

                {/* Suggested Commands */}
                <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
                  {suggestedCommands.map((cmd, i) => (
                    <Button
                      key={i}
                      variant="outline"
                      size="sm"
                      className="justify-start gap-2 text-xs h-auto py-2"
                      onClick={() => handleSendMessage(cmd.text)}
                    >
                      {cmd.icon}
                      <span className="truncate">{cmd.text}</span>
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
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
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
                  className={cn("shrink-0", isListening && "animate-pulse")}
                >
                  {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </Button>
              )}
              <Input
                placeholder="Ask me anything..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
                disabled={isProcessing}
                className="flex-1"
              />
              <Button 
                onClick={() => handleSendMessage()} 
                disabled={isProcessing || !inputText.trim()} 
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
