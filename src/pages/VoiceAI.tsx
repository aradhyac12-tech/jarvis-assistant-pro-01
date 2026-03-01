import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useWebSpeechTTS } from "@/hooks/useWebSpeechTTS";
import { useContinuousVoice } from "@/hooks/useContinuousVoice";
import { AudioWaveform, CircularWaveform } from "@/components/AudioWaveform";
import { BackButton } from "@/components/BackButton";
import { addLog } from "@/components/IssueLog";
import { supabase } from "@/integrations/supabase/client";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  language?: string;
  timestamp: Date;
  commands?: Array<Record<string, unknown>>;
}

interface AICommand {
  action: string;
  app_name?: string;
  site?: string;
  query?: string;
  engine?: string;
  level?: number;
  text?: string;
  control?: string;
  path?: string;
  url?: string;
  keys?: string;
  contact?: string;
  number?: string;
  message?: string;
  to?: string;
  subject?: string;
  body?: string;
}

export default function VoiceAI() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [inputText, setInputText] = useState("");
  const [executingCommands, setExecutingCommands] = useState(false);
  const [voiceMode, setVoiceMode] = useState<"idle" | "listening" | "speaking">("idle");
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { session } = useDeviceSession();

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

  const [showSettings, setShowSettings] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(() => localStorage.getItem("voice_tts_enabled") !== "false");
  const [wakeWordEnabled, setWakeWordEnabled] = useState(() => localStorage.getItem("voice_wakeword_enabled") !== "false");

  useEffect(() => localStorage.setItem("voice_tts_enabled", String(voiceEnabled)), [voiceEnabled]);
  useEffect(() => localStorage.setItem("voice_wakeword_enabled", String(wakeWordEnabled)), [wakeWordEnabled]);

  useEffect(() => {
    if (isSpeaking) setVoiceMode("speaking");
    else if (isListening) setVoiceMode("listening");
    else setVoiceMode("idle");
  }, [isSpeaking, isListening]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleVoiceCommand = useCallback(async (text: string) => {
    const userMessage: Message = { id: Date.now().toString(), role: "user", content: text, timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    await processAIMessage(text);
  }, []);

  const executeAICommands = async (commands: AICommand[]) => {
    if (!commands || commands.length === 0) return;
    setExecutingCommands(true);
    addLog("info", "web", `Executing ${commands.length} AI command(s)`);

    for (const cmd of commands) {
      try {
        let commandType = "";
        let payload: Record<string, unknown> = {};

        switch (cmd.action) {
          case "open_app": commandType = "open_app"; payload = { app_name: cmd.app_name }; break;
          case "close_app": commandType = "close_app"; payload = { app_name: cmd.app_name }; break;
          case "list_apps": commandType = "list_apps"; break;
          case "play_music": commandType = "play_music"; payload = { query: cmd.query, service: "youtube" }; break;
          case "media_control": commandType = "media_control"; payload = { action: cmd.control || "play_pause" }; break;
          case "set_volume": commandType = "set_volume"; payload = { level: cmd.level }; break;
          case "set_brightness": commandType = "set_brightness"; payload = { level: cmd.level }; break;
          case "lock": commandType = "lock"; break;
          case "sleep": commandType = "sleep"; break;
          case "restart": commandType = "restart"; break;
          case "shutdown": commandType = "shutdown"; break;
          case "screenshot": commandType = "screenshot"; break;
          case "search_files": commandType = "search_files"; payload = { query: cmd.query }; break;
          case "open_file": commandType = "open_file"; payload = { path: cmd.path }; break;
          case "open_folder": commandType = "open_folder"; payload = { path: cmd.path }; break;
          case "open_website": commandType = "open_website"; payload = { site: cmd.site, query: cmd.query || "" }; break;
          case "search_web": commandType = "search_web"; payload = { engine: cmd.engine || "google", query: cmd.query, press_enter: true }; break;
          case "open_url": commandType = "open_url"; payload = { url: cmd.url }; break;
          case "type_text": commandType = "type_text"; payload = { text: cmd.text }; break;
          case "key_combo": commandType = "key_combo"; payload = { keys: cmd.keys }; break;
          case "make_call": commandType = "make_call"; payload = { contact: cmd.contact, number: cmd.number }; break;
          case "send_sms": commandType = "send_sms"; payload = { contact: cmd.contact, number: cmd.number, message: cmd.message }; break;
          case "send_whatsapp": commandType = "send_whatsapp"; payload = { contact: cmd.contact, message: cmd.message }; break;
          case "send_email": commandType = "send_email"; payload = { to: cmd.to, subject: cmd.subject, body: cmd.body }; break;
          default: addLog("warn", "web", `Unknown AI command: ${cmd.action}`); continue;
        }

        if (commandType) {
          addLog("info", "web", `Executing: ${commandType}`);
          const result = await sendCommand(commandType, payload, { awaitResult: true, timeoutMs: 8000 });
          if (!result.success) {
            addLog("error", "web", `Command failed: ${commandType}`, result.error as string);
          }
          if (commands.length > 1) await new Promise(r => setTimeout(r, 1000));
        }
      } catch (error) {
        addLog("error", "web", `Command error: ${cmd.action}`, String(error));
      }
    }
    setExecutingCommands(false);
  };

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
        language: (data as Record<string, unknown>)?.language as string,
        timestamp: new Date(),
        commands: (data as Record<string, unknown>)?.commands as Array<Record<string, unknown>>,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      if (voiceEnabled && responseText) speak(responseText);
      if ((data as Record<string, unknown>)?.commands) {
        await executeAICommands((data as Record<string, unknown>).commands as AICommand[]);
      }
    } catch (error) {
      console.error("Error:", error);
      const errorMsg = error instanceof Error ? error.message : "Failed to get AI response";
      addLog("error", "web", "AI chat error", errorMsg);
      toast({ title: "Error", description: errorMsg, variant: "destructive" });
    } finally {
      setIsProcessing(false);
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

  const toggleVoiceConversation = useCallback(() => {
    if (isListening) { stopListening(); stopSpeaking(); }
    else startListening();
  }, [isListening, startListening, stopListening, stopSpeaking]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/95 backdrop-blur-sm">
        <div className="flex items-center justify-between h-14 px-4 max-w-4xl mx-auto">
          <div className="flex items-center gap-3">
            <BackButton />
            <div>
              <h1 className="font-semibold text-sm">JARVIS AI</h1>
              <p className="text-xs text-muted-foreground">
                {isListening ? (isWakeWordActive ? "Listening..." : "Say 'Jarvis'") : "Voice ready"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {(isListening || isSpeaking) && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50">
                <AudioWaveform isActive={isListening || isSpeaking} mode={isSpeaking ? "speaking" : "listening"} className="h-5" barCount={6} />
                <span className="text-xs text-muted-foreground">{isSpeaking ? "Speaking" : "Listening"}</span>
              </div>
            )}

            {interimTranscript && (
              <Badge variant="outline" className="max-w-[150px] truncate text-xs">{interimTranscript}</Badge>
            )}

            {executingCommands && (
              <Badge variant="secondary" className="text-xs animate-pulse gap-1">
                <Zap className="h-3 w-3" /> Running
              </Badge>
            )}

            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50">
              <Label htmlFor="voice-tts" className="text-xs text-muted-foreground">TTS</Label>
              <Switch
                id="voice-tts"
                checked={voiceEnabled}
                onCheckedChange={(checked) => { setVoiceEnabled(checked); if (!checked) stopSpeaking(); }}
                className="scale-75"
              />
            </div>

            <Button variant="ghost" size="icon" onClick={() => setShowSettings(!showSettings)} className={cn("h-8 w-8", showSettings && "bg-muted")}>
              <Settings className="h-4 w-4" />
            </Button>

            <Badge variant="outline" className="text-xs">
              {session?.session_token ? "Paired" : "Text Only"}
            </Badge>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto p-4 space-y-4 h-[calc(100vh-3.5rem)] flex flex-col">
        {/* Settings Panel */}
        {showSettings && (
          <Card className="border-border/40">
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">Wake Word</Label>
                  <p className="text-xs text-muted-foreground">Say "Jarvis" to activate</p>
                </div>
                <Switch checked={wakeWordEnabled} onCheckedChange={setWakeWordEnabled} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">Voice Response</Label>
                  <p className="text-xs text-muted-foreground">AI speaks responses (Free - no API)</p>
                </div>
                <Switch checked={voiceEnabled} onCheckedChange={setVoiceEnabled} />
              </div>
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                <p className="text-sm text-primary flex items-center gap-2">
                  <Volume2 className="h-4 w-4" /> Free browser speech - unlimited, no key needed
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Chat Area */}
        <Card className="flex-1 border-border/40 overflow-hidden flex flex-col min-h-0">
          <ScrollArea className="flex-1 p-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6">
                <div className="relative mb-6">
                  <CircularWaveform isActive={isListening || isSpeaking} mode={voiceMode} size={120} />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Bot className="w-10 h-10 text-primary" />
                  </div>
                </div>

                <h2 className="text-xl font-semibold mb-2">Hey, I'm JARVIS!</h2>
                <p className="text-muted-foreground max-w-sm text-sm mb-4">
                  Your AI assistant with free voice. Say "Jarvis" or type below.
                </p>

                <div className="flex flex-col items-center gap-3">
                  {!voiceSupported ? (
                    <p className="text-sm text-muted-foreground">Voice not supported</p>
                  ) : !isListening ? (
                    <Button size="lg" className="gap-2" onClick={toggleVoiceConversation}>
                      <Mic className="w-4 h-4" /> Start Listening
                    </Button>
                  ) : (
                    <Button size="lg" variant="destructive" className="gap-2" onClick={toggleVoiceConversation}>
                      <MicOff className="w-4 h-4" /> Stop
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((msg) => (
                  <div key={msg.id} className={cn("flex gap-3", msg.role === "user" ? "justify-end" : "justify-start")}>
                    {msg.role === "assistant" && (
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Bot className="w-4 h-4 text-primary" />
                      </div>
                    )}
                    <div className={cn(
                      "max-w-[80%] rounded-2xl px-4 py-2.5",
                      msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                    )}>
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      <p className="text-[10px] opacity-60 mt-1">
                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    {msg.role === "user" && (
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <User className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                ))}
                {isProcessing && (
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <Bot className="w-4 h-4 text-primary" />
                    </div>
                    <div className="bg-muted rounded-2xl px-4 py-3">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </div>
                  </div>
                )}
                <div ref={scrollRef} />
              </div>
            )}
          </ScrollArea>

          {/* Input */}
          <div className="p-4 border-t border-border/40">
            <div className="flex gap-2">
              {voiceSupported && (
                <Button variant={isListening ? "destructive" : "outline"} size="icon" onClick={toggleVoiceConversation} className="shrink-0">
                  {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </Button>
              )}
              <Input
                placeholder="Type a message..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
                disabled={isProcessing}
                className="flex-1"
              />
              <Button onClick={() => handleSendMessage()} disabled={isProcessing || !inputText.trim()} size="icon" className="shrink-0">
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
