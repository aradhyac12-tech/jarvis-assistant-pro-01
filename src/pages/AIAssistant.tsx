import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
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
  Wifi,
  WifiOff,
  Sparkles,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  VolumeX,
  Volume1,
  CloudSun,
  MessageSquare,
  Phone,
  Mail,
  Settings,
  Zap,
  Timer,
  Bell,
  AlarmClock,
  Camera,
  PhoneCall,
  Instagram,
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useWebSpeechTTS } from "@/hooks/useWebSpeechTTS";
import { useContinuousVoice } from "@/hooks/useContinuousVoice";
import { CircularWaveform } from "@/components/AudioWaveform";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

// ── Types ──────────────────────────────────────────────────────
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  type?: "text" | "weather" | "alarm" | "reminder" | "media" | "call" | "action";
}

// ── Suggested Commands ─────────────────────────────────────────
const suggestedCommands = [
  { text: "What's the weather?", icon: <CloudSun className="h-4 w-4" />, color: "from-sky-500/20 to-blue-500/20" },
  { text: "Play some music", icon: <Music className="h-4 w-4" />, color: "from-pink-500/20 to-purple-500/20" },
  { text: "Open Chrome on PC", icon: <Globe className="h-4 w-4" />, color: "from-green-500/20 to-emerald-500/20" },
  { text: "Set a timer for 5 min", icon: <Timer className="h-4 w-4" />, color: "from-amber-500/20 to-orange-500/20" },
  { text: "Call Mom", icon: <Phone className="h-4 w-4" />, color: "from-green-500/20 to-teal-500/20" },
  { text: "Send a WhatsApp message", icon: <MessageSquare className="h-4 w-4" />, color: "from-emerald-500/20 to-green-500/20" },
  { text: "Lock my PC", icon: <Lock className="h-4 w-4" />, color: "from-orange-500/20 to-red-500/20" },
  { text: "Search Google for news", icon: <Search className="h-4 w-4" />, color: "from-blue-500/20 to-indigo-500/20" },
];

// ── Quick Action Chips ─────────────────────────────────────────
const quickChips = [
  { icon: <Phone className="h-3.5 w-3.5" />, label: "Call", cmd: "call" },
  { icon: <MessageSquare className="h-3.5 w-3.5" />, label: "Text", cmd: "sms" },
  { icon: <Mail className="h-3.5 w-3.5" />, label: "Email", cmd: "email" },
  { icon: <Play className="h-3.5 w-3.5" />, label: "Play/Pause", cmd: "media_play" },
  { icon: <SkipForward className="h-3.5 w-3.5" />, label: "Next", cmd: "media_next" },
  { icon: <Lock className="h-3.5 w-3.5" />, label: "Lock PC", cmd: "lock" },
  { icon: <Moon className="h-3.5 w-3.5" />, label: "Sleep", cmd: "sleep" },
  { icon: <AlarmClock className="h-3.5 w-3.5" />, label: "Alarm", cmd: "alarm" },
  { icon: <Camera className="h-3.5 w-3.5" />, label: "Camera", cmd: "camera" },
  { icon: <CloudSun className="h-3.5 w-3.5" />, label: "Weather", cmd: "weather" },
];

export function AIAssistant() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [inputText, setInputText] = useState("");
  const [volume, setVolume] = useState(50);
  const [brightness, setBrightness] = useState(50);
  const [showControls, setShowControls] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { session } = useDeviceSession();
  const isConnected = !!session?.session_token;
  const navigate = useNavigate();

  const { speak, stopSpeaking, isSpeaking } = useWebSpeechTTS({ rate: 1.0, pitch: 1.0 });

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

  // ── Voice Command Handler ────────────────────────────────────
  const handleVoiceCommand = useCallback(async (text: string) => {
    const userMessage: Message = { id: Date.now().toString(), role: "user", content: text, timestamp: new Date() };
    setMessages((prev) => [...prev, userMessage]);
    await processAIMessage(text);
  }, []);

  // ── Core AI Processing ───────────────────────────────────────
  const processAIMessage = async (text: string) => {
    setIsProcessing(true);
    try {
      const lowerText = text.toLowerCase();

      // ── Mobile-Native Actions (handled locally) ──────────────
      // Proper calling: "call Mom", "call +1234567890"
      if (/^(call|dial|phone)\s+/i.test(lowerText)) {
        const target = text.replace(/^(call|dial|phone)\s+/i, "").trim();
        const isNumber = /^[\d\+\-\s\(\)]+$/.test(target);
        if (isNumber) {
          addAssistantMessage(`Calling ${target}...`, "call");
          window.location.href = `tel:${target.replace(/\s/g, "")}`;
        } else {
          // Contact name - try intent
          addAssistantMessage(`Calling ${target}... If the contact isn't found, you may need to select them.`, "call");
          window.location.href = `tel:`;
        }
        return;
      }

      // WhatsApp message: "send whatsapp to Mom saying hello"
      if (/whatsapp|wp\s/i.test(lowerText)) {
        const msgMatch = text.match(/(?:saying|message|msg|text)\s+(.+)/i);
        const msg = msgMatch?.[1] || "";
        addAssistantMessage(`Opening WhatsApp${msg ? ` with message: "${msg}"` : ""}...`, "action");
        const wpUrl = msg
          ? `https://wa.me/?text=${encodeURIComponent(msg)}`
          : `https://wa.me/`;
        window.open(wpUrl, "_blank");
        return;
      }

      // Instagram call/message
      if (/instagram|insta\s/i.test(lowerText)) {
        addAssistantMessage("Opening Instagram...", "action");
        window.open("https://instagram.com", "_blank");
        return;
      }

      // Snapchat
      if (/snapchat|snap\s/i.test(lowerText)) {
        addAssistantMessage("Opening Snapchat...", "action");
        window.open("https://snapchat.com", "_blank");
        return;
      }

      // SMS: "text John hello"
      if (/^(text|sms|message)\s+/i.test(lowerText)) {
        const rest = text.replace(/^(text|sms|message)\s+/i, "").trim();
        const parts = rest.match(/^(\S+)\s+(.*)/);
        if (parts) {
          addAssistantMessage(`Sending text to ${parts[1]}: "${parts[2]}"`, "action");
          window.location.href = `sms:?body=${encodeURIComponent(parts[2])}`;
        } else {
          addAssistantMessage("Opening messaging...", "action");
          window.location.href = "sms:";
        }
        return;
      }

      // Email
      if (/^(email|mail)\s+/i.test(lowerText)) {
        const rest = text.replace(/^(email|mail)\s+/i, "").trim();
        addAssistantMessage(`Opening email${rest ? ` to ${rest}` : ""}...`, "action");
        const emailTarget = rest.includes("@") ? rest : "";
        window.location.href = emailTarget ? `mailto:${emailTarget}` : "mailto:";
        return;
      }

      // Weather
      if (lowerText.includes("weather")) {
        addAssistantMessage("Let me check the weather for you...", "weather");
        // Use the AI to get weather info via web search
        if (isConnected) {
          const { data } = await supabase.functions.invoke("jarvis-chat", {
            body: { message: `Search Google for current weather in user's location and tell me` },
            headers: session?.session_token ? { "x-session-token": session.session_token } : {},
          });
          if (data?.response) {
            addAssistantMessage(data.response, "weather");
          }
        } else {
          window.open("https://weather.com", "_blank");
        }
        return;
      }

      // Timer/Alarm
      if (lowerText.includes("timer") || lowerText.includes("alarm")) {
        const match = lowerText.match(/(\d+)\s*(min|minute|sec|second|hour)/);
        if (match) {
          const amount = parseInt(match[1]);
          const unit = match[2];
          const ms = unit.startsWith("min") ? amount * 60000 : unit.startsWith("sec") ? amount * 1000 : amount * 3600000;
          addAssistantMessage(`⏰ Timer set for ${amount} ${unit}(s). I'll notify you when done!`, "alarm");
          setTimeout(() => {
            toast({ title: "⏰ Timer Complete!", description: `Your ${amount} ${unit} timer is done!` });
            if (voiceEnabled) speak(`Your ${amount} ${unit} timer is complete.`);
            // Try native notification
            if ("Notification" in window && Notification.permission === "granted") {
              new Notification("Timer Complete", { body: `Your ${amount} ${unit} timer is done!`, icon: "/favicon.ico" });
            }
          }, ms);
          // Request notification permission
          if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
          }
          return;
        }
      }

      // ── PC Commands (via backend AI) ──────────────────────────
      if (!session?.session_token) {
        // Even without PC connection, try to process with AI for general questions
        const { data, error } = await supabase.functions.invoke("jarvis-chat", {
          body: { message: text },
        });
        if (error) throw error;
        addAssistantMessage(data?.response || "I couldn't process that. Please try again.");
        return;
      }

      const { data, error } = await supabase.functions.invoke("jarvis-chat", {
        body: { message: text },
        headers: { "x-session-token": session.session_token },
      });

      if (error) throw new Error(error.message || "Failed to get AI response");

      const responseText = data?.response ?? "";
      addAssistantMessage(responseText);

      // Execute commands
      const commands = data?.commands as Array<Record<string, unknown>>;
      if (commands?.length > 0) {
        for (const cmd of commands) {
          await executeCommand(cmd);
        }
      }
    } catch (error) {
      console.error("Error:", error);
      const errorMsg = error instanceof Error ? error.message : "Something went wrong.";
      addAssistantMessage(`Sorry, I encountered an error: ${errorMsg}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const addAssistantMessage = (content: string, type?: Message["type"]) => {
    const msg: Message = {
      id: (Date.now() + Math.random()).toString(),
      role: "assistant",
      content,
      timestamp: new Date(),
      type,
    };
    setMessages((prev) => [...prev, msg]);
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
        case "lock": case "sleep": case "shutdown": case "restart": case "screenshot":
          await sendCommand(action, {}, { awaitResult: true, timeoutMs: 4000 });
          break;
        case "search_web":
          await sendCommand("search_web", { engine: cmd.engine || "google", query: cmd.query }, { awaitResult: true, timeoutMs: 10000 });
          break;
        case "open_website":
          await sendCommand("open_website", { site: cmd.site, query: cmd.query || "" }, { awaitResult: true, timeoutMs: 10000 });
          break;
        case "open_url":
          await sendCommand("open_url", { url: cmd.url }, { awaitResult: true, timeoutMs: 10000 });
          break;
        case "make_call":
          window.location.href = `tel:${cmd.number || ""}`;
          break;
        case "send_sms":
          window.location.href = `sms:${cmd.number || ""}?body=${encodeURIComponent((cmd.message as string) || "")}`;
          break;
        case "send_whatsapp":
          window.open(`https://wa.me/?text=${encodeURIComponent((cmd.message as string) || "")}`, "_blank");
          break;
        case "send_email":
          window.location.href = `mailto:${cmd.to || ""}?subject=${encodeURIComponent((cmd.subject as string) || "")}&body=${encodeURIComponent((cmd.body as string) || "")}`;
          break;
        default:
          console.warn("Unhandled command:", action);
      }
    } catch (e) {
      console.error("Command execution error:", e);
    }
  };

  const handleSendMessage = useCallback(
    async (text?: string) => {
      const messageText = text || inputText;
      if (!messageText.trim() || isProcessing) return;
      const userMessage: Message = { id: Date.now().toString(), role: "user", content: messageText, timestamp: new Date() };
      setMessages((prev) => [...prev, userMessage]);
      setInputText("");
      await processAIMessage(messageText);
    },
    [inputText, isProcessing]
  );

  const handleQuickChip = async (cmd: string) => {
    switch (cmd) {
      case "call":
        setInputText("Call ");
        inputRef.current?.focus();
        break;
      case "sms":
        setInputText("Text ");
        inputRef.current?.focus();
        break;
      case "email":
        setInputText("Email ");
        inputRef.current?.focus();
        break;
      case "media_play":
        if (isConnected) await sendCommand("media_control", { action: "play_pause" }, { awaitResult: true, timeoutMs: 4000 });
        break;
      case "media_next":
        if (isConnected) await sendCommand("media_control", { action: "next" }, { awaitResult: true, timeoutMs: 4000 });
        break;
      case "lock":
        if (isConnected) await sendCommand("lock", {}, { awaitResult: true, timeoutMs: 4000 });
        break;
      case "sleep":
        if (isConnected) await sendCommand("sleep", {}, { awaitResult: true, timeoutMs: 4000 });
        break;
      case "alarm":
        setInputText("Set a timer for ");
        inputRef.current?.focus();
        break;
      case "camera":
        try {
          await navigator.mediaDevices.getUserMedia({ video: true });
          toast({ title: "Camera ready" });
        } catch {
          toast({ variant: "destructive", title: "Camera access denied" });
        }
        break;
      case "weather":
        handleSendMessage("What's the weather?");
        break;
    }
  };

  const toggleVoice = useCallback(() => {
    if (isListening) {
      stopListening();
      stopSpeaking();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening, stopSpeaking]);

  const handleVolumeChange = async (val: number[]) => {
    setVolume(val[0]);
    if (isConnected) {
      try { await sendCommand("set_volume", { level: val[0] }, { awaitResult: true, timeoutMs: 4000 }); } catch {}
    }
  };

  const handleBrightnessChange = async (val: number[]) => {
    setBrightness(val[0]);
    if (isConnected) {
      try { await sendCommand("set_brightness", { level: val[0] }, { awaitResult: true, timeoutMs: 4000 }); } catch {}
    }
  };

  const voiceMode = isSpeaking ? "speaking" : isListening ? "listening" : "idle";
  const isVoiceActive = isListening || isSpeaking;

  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
      {/* Background gradient orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -left-32 w-64 h-64 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute top-1/3 -right-32 w-72 h-72 rounded-full bg-accent-purple/5 blur-3xl" />
        <div className="absolute -bottom-32 left-1/3 w-56 h-56 rounded-full bg-accent-cyan/5 blur-3xl" />
      </div>

      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 glass-morphism border-b border-border/20">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="font-semibold text-sm flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-primary" />
                JARVIS
              </h1>
              <p className="text-[10px] text-muted-foreground">
                {isWakeWordActive ? '🟢 Wake word detected' : isListening ? '🎤 Listening...' : isConnected ? "PC Connected" : "Mobile Mode"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] gap-1 h-6 rounded-full",
                isConnected ? "border-[hsl(var(--success))]/40 text-[hsl(var(--success))]" : "border-border"
              )}
            >
              {isConnected ? <Wifi className="h-2.5 w-2.5" /> : <WifiOff className="h-2.5 w-2.5" />}
              {isConnected ? "PC" : "Off"}
            </Badge>

            {voiceSupported && (
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-9 w-9 rounded-full transition-all",
                  isListening && "bg-primary/20 text-primary shadow-[0_0_15px_hsl(var(--primary)/0.3)]"
                )}
                onClick={toggleVoice}
              >
                {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* ── Main Content ────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden relative z-10">
        <ScrollArea className="flex-1 px-4">
          {messages.length === 0 ? (
            /* ── Empty State: Orb + Suggestions ───────────────── */
            <div className="flex flex-col items-center justify-center pt-8 pb-4">
              {/* Glassmorphic Orb */}
              <div className="relative mb-6">
                <div className={cn(
                  "w-36 h-36 rounded-full glass-orb flex items-center justify-center transition-all duration-500",
                  isVoiceActive && "scale-110"
                )}>
                  <CircularWaveform
                    isActive={isVoiceActive}
                    mode={voiceMode}
                    size={120}
                    className="absolute inset-2"
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Bot className={cn(
                      "w-10 h-10 transition-all",
                      isVoiceActive ? "text-primary" : "text-muted-foreground"
                    )} />
                  </div>
                </div>
                {/* Pulse rings */}
                {isVoiceActive && (
                  <>
                    <div className="absolute inset-0 rounded-full border border-primary/20 animate-ping" style={{ animationDuration: "2s" }} />
                    <div className="absolute -inset-3 rounded-full border border-primary/10 animate-ping" style={{ animationDuration: "3s" }} />
                  </>
                )}
              </div>

              <h2 className="text-xl font-bold mb-1 bg-gradient-to-r from-primary to-[hsl(var(--accent-purple))] bg-clip-text text-transparent">
                Hey, I'm JARVIS
              </h2>
              <p className="text-muted-foreground text-xs mb-1 max-w-[260px] text-center">
                Your AI assistant. Say <span className="text-primary font-medium">"Jarvis"</span> to wake me up.
              </p>
              <p className="text-muted-foreground/60 text-[10px] mb-6">
                Control PC • Make Calls • Set Timers • Play Music • Search Web
              </p>

              {/* Quick Action Chips */}
              <div className="flex flex-wrap gap-2 justify-center mb-6 max-w-sm">
                {quickChips.map((chip) => (
                  <button
                    key={chip.cmd}
                    onClick={() => handleQuickChip(chip.cmd)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs",
                      "glass-morphism hover:border-primary/30 transition-all hover:scale-105",
                      "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {chip.icon}
                    {chip.label}
                  </button>
                ))}
              </div>

              {/* Suggested Commands */}
              <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
                {suggestedCommands.map((cmd, i) => (
                  <button
                    key={i}
                    onClick={() => handleSendMessage(cmd.text)}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs text-left",
                      "glass-morphism hover:border-primary/30 transition-all hover:scale-[1.02]",
                      "bg-gradient-to-r", cmd.color
                    )}
                  >
                    <span className="shrink-0 opacity-80">{cmd.icon}</span>
                    <span className="text-foreground/80">{cmd.text}</span>
                  </button>
                ))}
              </div>

              {/* PC Controls Toggle */}
              {isConnected && (
                <button
                  onClick={() => setShowControls(!showControls)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground mt-4 hover:text-foreground transition-colors"
                >
                  <Monitor className="h-3.5 w-3.5" />
                  PC Controls
                  {showControls ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              )}

              {/* PC Controls Panel */}
              {showControls && isConnected && (
                <div className="w-full max-w-sm mt-3 glass-morphism rounded-2xl p-4 space-y-4 animate-fade-in">
                  {/* Media Controls */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <Music className="h-3 w-3" /> Media
                    </span>
                    <div className="flex gap-1">
                      {[
                        { icon: <SkipBack className="h-3.5 w-3.5" />, cmd: "previous" },
                        { icon: <Play className="h-3.5 w-3.5" />, cmd: "play_pause" },
                        { icon: <SkipForward className="h-3.5 w-3.5" />, cmd: "next" },
                        { icon: <VolumeX className="h-3.5 w-3.5" />, cmd: "mute" },
                      ].map((btn) => (
                        <Button
                          key={btn.cmd}
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-full hover:bg-primary/10"
                          onClick={() => sendCommand("media_control", { action: btn.cmd }, { awaitResult: true, timeoutMs: 4000 })}
                        >
                          {btn.icon}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* Volume */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Volume1 className="h-3 w-3" /> Volume
                      </span>
                      <span className="text-[10px] text-muted-foreground">{volume}%</span>
                    </div>
                    <Slider value={[volume]} max={100} step={1} onValueChange={handleVolumeChange} className="w-full" />
                  </div>

                  {/* Brightness */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Sun className="h-3 w-3" /> Brightness
                      </span>
                      <span className="text-[10px] text-muted-foreground">{brightness}%</span>
                    </div>
                    <Slider value={[brightness]} max={100} step={1} onValueChange={handleBrightnessChange} className="w-full" />
                  </div>

                  {/* System Actions */}
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { icon: <Lock className="h-3.5 w-3.5" />, label: "Lock", cmd: "lock" },
                      { icon: <Moon className="h-3.5 w-3.5" />, label: "Sleep", cmd: "sleep" },
                      { icon: <Power className="h-3.5 w-3.5" />, label: "Off", cmd: "shutdown" },
                      { icon: <Zap className="h-3.5 w-3.5" />, label: "Boost", cmd: "boost" },
                    ].map((btn) => (
                      <button
                        key={btn.cmd}
                        onClick={async () => {
                          if (btn.cmd === "boost") {
                            await sendCommand("boost_ram", {}, { awaitResult: true, timeoutMs: 8000 });
                          } else {
                            await sendCommand(btn.cmd, {}, { awaitResult: true, timeoutMs: 4000 });
                          }
                          toast({ title: `${btn.label} executed` });
                        }}
                        className="flex flex-col items-center gap-1 py-2 rounded-xl glass-morphism hover:border-primary/30 transition-all text-xs text-muted-foreground hover:text-foreground"
                      >
                        {btn.icon}
                        <span className="text-[10px]">{btn.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ── Chat Messages ──────────────────────────────────── */
            <div className="space-y-3 py-4">
              {messages.map((msg) => (
                <div key={msg.id} className={cn("flex gap-2.5", msg.role === "user" ? "justify-end" : "justify-start")}>
                  {msg.role === "assistant" && (
                    <div className="w-7 h-7 rounded-full glass-morphism flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="w-3.5 h-3.5 text-primary" />
                    </div>
                  )}
                  <div
                    className={cn(
                      "max-w-[80%] rounded-2xl px-3.5 py-2.5",
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-md"
                        : "glass-morphism rounded-bl-md"
                    )}
                  >
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    <p className={cn(
                      "text-[9px] mt-1 opacity-50",
                      msg.role === "user" ? "text-right" : ""
                    )}>
                      {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  {msg.role === "user" && (
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <User className="w-3.5 h-3.5 text-primary" />
                    </div>
                  )}
                </div>
              ))}
              {isProcessing && (
                <div className="flex gap-2.5">
                  <div className="w-7 h-7 rounded-full glass-morphism flex items-center justify-center">
                    <Bot className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="glass-morphism rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex gap-1.5">
                      <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={scrollRef} />
            </div>
          )}
        </ScrollArea>

        {/* ── Interim Transcript ───────────────────────────────── */}
        {interimTranscript && (
          <div className="mx-4 mb-2 px-3 py-2 glass-morphism rounded-xl">
            <p className="text-xs text-muted-foreground italic truncate">
              🎤 {interimTranscript}
            </p>
          </div>
        )}

        {/* ── Input Bar ────────────────────────────────────────── */}
        <div className="p-3 glass-morphism-strong border-t border-border/10">
          <div className="flex gap-2 items-center">
            {voiceSupported && (
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleVoice}
                className={cn(
                  "h-10 w-10 rounded-full shrink-0 transition-all",
                  isListening
                    ? "bg-primary text-primary-foreground shadow-[0_0_20px_hsl(var(--primary)/0.4)] animate-pulse"
                    : "hover:bg-primary/10"
                )}
              >
                {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </Button>
            )}
            <Input
              ref={inputRef}
              placeholder={isListening ? "Listening..." : "Ask me anything..."}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
              disabled={isProcessing}
              className="flex-1 rounded-full border-border/30 bg-card/50 h-10 px-4 text-sm"
            />
            <Button
              onClick={() => handleSendMessage()}
              disabled={isProcessing || !inputText.trim()}
              size="icon"
              className="h-10 w-10 rounded-full shrink-0"
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AIAssistant;
