import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Send,
  Bot,
  User,
  Loader2,
  Mic,
  MicOff,
  Wifi,
  WifiOff,
  Sparkles,
  ArrowLeft,
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

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export function AIAssistant() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [inputText, setInputText] = useState("");
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

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const handleVoiceCommand = useCallback(async (text: string) => {
    const userMessage: Message = { id: Date.now().toString(), role: "user", content: text, timestamp: new Date() };
    setMessages((prev) => [...prev, userMessage]);
    await processAIMessage(text);
  }, []);

  const processAIMessage = async (text: string) => {
    setIsProcessing(true);
    try {
      const lowerText = text.toLowerCase();

      // ── Mobile-native actions ──
      if (/^(call|dial|phone)\s+/i.test(lowerText)) {
        const target = text.replace(/^(call|dial|phone)\s+/i, "").trim();
        if (/on\s+(whatsapp|wp)/i.test(lowerText)) {
          const name = target.replace(/\s+on\s+(whatsapp|wp)/i, "").trim();
          addAssistantMessage(`Opening WhatsApp call to ${name}...`);
          window.open(`https://wa.me/?text=Calling+${encodeURIComponent(name)}`, "_blank");
          return;
        }
        if (/on\s+(instagram|insta)/i.test(lowerText)) {
          const name = target.replace(/\s+on\s+(instagram|insta)/i, "").trim();
          addAssistantMessage(`Opening Instagram for ${name}...`);
          window.open(`instagram://user?username=${encodeURIComponent(name)}`, "_blank");
          return;
        }
        if (/on\s+(snapchat|snap)/i.test(lowerText)) {
          const name = target.replace(/\s+on\s+(snapchat|snap)/i, "").trim();
          addAssistantMessage(`Opening Snapchat for ${name}...`);
          window.open(`snapchat://add/${encodeURIComponent(name)}`, "_blank");
          return;
        }
        const isNumber = /^[\d\+\-\s\(\)]+$/.test(target);
        addAssistantMessage(`Calling ${target}...`);
        window.location.href = isNumber ? `tel:${target.replace(/\s/g, "")}` : `tel:`;
        return;
      }

      if (/whatsapp|wp\s/i.test(lowerText)) {
        const msgMatch = text.match(/(?:saying|message|msg|text)\s+(.+)/i);
        const msg = msgMatch?.[1] || "";
        addAssistantMessage(`Opening WhatsApp${msg ? ` with message: "${msg}"` : ""}...`);
        window.open(msg ? `https://wa.me/?text=${encodeURIComponent(msg)}` : `https://wa.me/`, "_blank");
        return;
      }

      if (/^(text|sms|message)\s+/i.test(lowerText)) {
        const rest = text.replace(/^(text|sms|message)\s+/i, "").trim();
        const parts = rest.match(/^(\S+)\s+(.*)/);
        if (parts) {
          addAssistantMessage(`Sending text to ${parts[1]}: "${parts[2]}"`);
          window.location.href = `sms:?body=${encodeURIComponent(parts[2])}`;
        } else {
          addAssistantMessage("Opening messaging...");
          window.location.href = "sms:";
        }
        return;
      }

      if (/^(email|mail)\s+/i.test(lowerText)) {
        const rest = text.replace(/^(email|mail)\s+/i, "").trim();
        addAssistantMessage(`Opening email${rest ? ` to ${rest}` : ""}...`);
        const emailTarget = rest.includes("@") ? rest : "";
        window.location.href = emailTarget ? `mailto:${emailTarget}` : "mailto:";
        return;
      }

      if (lowerText.includes("timer") || lowerText.includes("alarm")) {
        const match = lowerText.match(/(\d+)\s*(min|minute|sec|second|hour)/);
        if (match) {
          const amount = parseInt(match[1]);
          const unit = match[2];
          const ms = unit.startsWith("min") ? amount * 60000 : unit.startsWith("sec") ? amount * 1000 : amount * 3600000;
          addAssistantMessage(`⏰ Timer set for ${amount} ${unit}(s). I'll notify you when done!`);
          setTimeout(() => {
            toast({ title: "⏰ Timer Complete!", description: `Your ${amount} ${unit} timer is done!` });
            if (voiceEnabled) speak(`Your ${amount} ${unit} timer is complete.`);
            if ("Notification" in window && Notification.permission === "granted") {
              new Notification("Timer Complete", { body: `Your ${amount} ${unit} timer is done!`, icon: "/favicon.ico" });
            }
          }, ms);
          return;
        }
      }

      // ── PC commands via AI backend ──
      const headers: Record<string, string> = {};
      if (session?.session_token) {
        headers["x-session-token"] = session.session_token;
      }

      const { data, error } = await supabase.functions.invoke("jarvis-chat", {
        body: { message: text },
        headers,
      });

      if (error) throw new Error(error.message || "Failed to get AI response");

      const responseText = data?.response ?? "";
      addAssistantMessage(responseText);

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

  const addAssistantMessage = (content: string) => {
    const msg: Message = {
      id: (Date.now() + Math.random()).toString(),
      role: "assistant",
      content,
      timestamp: new Date(),
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
          break;
        case "set_brightness":
          await sendCommand("set_brightness", { level: cmd.level }, { awaitResult: true, timeoutMs: 4000 });
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
        case "join_zoom": {
          const meetingId = cmd.meeting_id || cmd.meetingId || "";
          const meetingLink = cmd.meeting_link || cmd.meetingLink || "";
          if (meetingLink) {
            const zoomUrl = String(meetingLink).replace("https://zoom.us/j/", "zoommtg://zoom.us/join?confno=").replace("https://us04web.zoom.us/j/", "zoommtg://zoom.us/join?confno=");
            await sendCommand("open_url", { url: zoomUrl }, { awaitResult: true, timeoutMs: 10000 });
          } else if (meetingId) {
            await sendCommand("open_url", { url: `zoommtg://zoom.us/join?confno=${meetingId}` }, { awaitResult: true, timeoutMs: 10000 });
          }
          break;
        }
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

  const toggleVoice = useCallback(() => {
    if (isListening) {
      stopListening();
      stopSpeaking();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening, stopSpeaking]);

  const voiceMode = isSpeaking ? "speaking" : isListening ? "listening" : "idle";
  const isVoiceActive = isListening || isSpeaking;

  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
      {/* Subtle background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -left-32 w-64 h-64 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute top-1/3 -right-32 w-72 h-72 rounded-full bg-primary/3 blur-3xl" />
      </div>

      {/* Header */}
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
                {isWakeWordActive ? '🟢 Wake word detected' : isListening ? '🎤 Listening...' : isConnected ? "PC Connected" : "Mobile Only"}
              </p>
            </div>
          </div>

          <Badge
            variant="outline"
            className={cn(
              "text-[10px] gap-1 h-6 rounded-full",
              isConnected ? "border-emerald-500/40 text-emerald-500" : "border-border"
            )}
          >
            {isConnected ? <Wifi className="h-2.5 w-2.5" /> : <WifiOff className="h-2.5 w-2.5" />}
            {isConnected ? "PC" : "Off"}
          </Badge>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden relative z-10">
        <ScrollArea className="flex-1 px-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
              {/* Glassmorphic Orb */}
              <div className="relative mb-8">
                <div className={cn(
                  "w-44 h-44 rounded-full glass-orb flex items-center justify-center transition-all duration-500",
                  isVoiceActive && "scale-110"
                )}>
                  <CircularWaveform
                    isActive={isVoiceActive}
                    mode={voiceMode}
                    size={140}
                    className="absolute inset-3"
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Bot className={cn(
                      "w-12 h-12 transition-all",
                      isVoiceActive ? "text-primary" : "text-muted-foreground"
                    )} />
                  </div>
                </div>
                {isVoiceActive && (
                  <>
                    <div className="absolute inset-0 rounded-full border border-primary/20 animate-ping" style={{ animationDuration: "2s" }} />
                    <div className="absolute -inset-3 rounded-full border border-primary/10 animate-ping" style={{ animationDuration: "3s" }} />
                  </>
                )}
              </div>

              <h2 className="text-2xl font-bold mb-2 bg-gradient-to-r from-primary to-foreground bg-clip-text text-transparent">
                Hey, I'm JARVIS
              </h2>
              <p className="text-muted-foreground text-sm mb-1 max-w-[280px] text-center">
                Say <span className="text-primary font-semibold">"Jarvis"</span> or type anything below.
              </p>
              <p className="text-muted-foreground/50 text-[11px]">
                I can control your PC, make calls, set timers & more.
              </p>
            </div>
          ) : (
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

        {/* Interim Transcript */}
        {interimTranscript && (
          <div className="mx-4 mb-2 px-3 py-2 glass-morphism rounded-xl">
            <p className="text-xs text-muted-foreground italic truncate">
              🎤 {interimTranscript}
            </p>
          </div>
        )}

        {/* Input Bar */}
        <div className="p-3 glass-morphism-strong border-t border-border/10">
          <div className="flex gap-2 items-center">
            {voiceSupported && (
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleVoice}
                className={cn(
                  "h-11 w-11 rounded-full shrink-0 transition-all",
                  isListening
                    ? "bg-primary text-primary-foreground shadow-[0_0_20px_hsl(var(--primary)/0.4)] animate-pulse"
                    : "hover:bg-primary/10"
                )}
              >
                {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </Button>
            )}
            <Input
              ref={inputRef}
              placeholder={isListening ? "Listening..." : "Ask me anything..."}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
              disabled={isProcessing}
              className="flex-1 rounded-full border-border/30 bg-card/50 h-11 px-4 text-sm"
            />
            <Button
              onClick={() => handleSendMessage()}
              disabled={isProcessing || !inputText.trim()}
              size="icon"
              className="h-11 w-11 rounded-full shrink-0"
            >
              {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AIAssistant;
