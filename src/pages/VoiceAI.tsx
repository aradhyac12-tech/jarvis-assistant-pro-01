import { useState, useRef, useEffect, useCallback } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { 
  Send, 
  Bot, 
  User, 
  Loader2, 
  Zap, 
  Mic, 
  MicOff, 
  Volume2, 
  VolumeX,
  Phone,
  PhoneOff,
  Settings,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useWebSpeechTTS } from "@/hooks/useWebSpeechTTS";
import { useContinuousVoice } from "@/hooks/useContinuousVoice";
import { AudioWaveform, CircularWaveform } from "@/components/AudioWaveform";
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

  // Free Web Speech TTS (no API key needed!)
  const { speak, stopSpeaking, isSpeaking } = useWebSpeechTTS({
    rate: 1.0,
    pitch: 1.0,
  });

  // Continuous voice recognition with wake word support
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
      toast({
        variant: "destructive",
        title: "Voice Error",
        description: error,
      });
    },
  });

  const [showSettings, setShowSettings] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(true);

  // Update voice mode based on states
  useEffect(() => {
    if (isSpeaking) {
      setVoiceMode("speaking");
    } else if (isListening) {
      setVoiceMode("listening");
    } else {
      setVoiceMode("idle");
    }
  }, [isSpeaking, isListening]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Handle voice command
  const handleVoiceCommand = useCallback(async (text: string) => {
    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);

    // Process with AI
    await processAIMessage(text);
  }, []);

  // Execute commands returned by AI
  const executeAICommands = async (commands: AICommand[]) => {
    if (!commands || commands.length === 0) return;
    
    setExecutingCommands(true);
    addLog("info", "web", `Executing ${commands.length} AI command(s)`);

    for (const cmd of commands) {
      try {
        let commandType = "";
        let payload: Record<string, unknown> = {};

        switch (cmd.action) {
          // App Control
          case "open_app":
            commandType = "open_app";
            payload = { app_name: cmd.app_name };
            break;
          case "close_app":
            commandType = "close_app";
            payload = { app_name: cmd.app_name };
            break;
          case "list_apps":
            commandType = "list_apps";
            break;

          // Media Control
          case "play_music":
            commandType = "play_music";
            payload = { query: cmd.query, service: "youtube" };
            break;
          case "media_control":
            commandType = "media_control";
            payload = { action: cmd.control || "play_pause" };
            break;

          // System Control
          case "set_volume":
            commandType = "set_volume";
            payload = { level: cmd.level };
            break;
          case "set_brightness":
            commandType = "set_brightness";
            payload = { level: cmd.level };
            break;
          case "lock":
            commandType = "lock";
            break;
          case "sleep":
            commandType = "sleep";
            break;
          case "restart":
            commandType = "restart";
            break;
          case "shutdown":
            commandType = "shutdown";
            break;
          case "screenshot":
            commandType = "screenshot";
            break;

          // File Operations
          case "search_files":
            commandType = "search_files";
            payload = { query: cmd.query };
            break;
          case "open_file":
            commandType = "open_file";
            payload = { path: cmd.path };
            break;
          case "open_folder":
            commandType = "open_folder";
            payload = { path: cmd.path };
            break;

          // Web & Search
          case "open_website":
            commandType = "open_website";
            payload = { site: cmd.site, query: cmd.query || "" };
            break;
          case "search_web":
            commandType = "search_web";
            payload = { engine: cmd.engine || "google", query: cmd.query, press_enter: true };
            break;
          case "open_url":
            commandType = "open_url";
            payload = { url: cmd.url };
            break;

          // Input Control
          case "type_text":
            commandType = "type_text";
            payload = { text: cmd.text };
            break;
          case "key_combo":
            commandType = "key_combo";
            payload = { keys: cmd.keys };
            break;

          // Mobile Actions
          case "make_call":
            commandType = "make_call";
            payload = { contact: cmd.contact, number: cmd.number };
            break;
          case "send_sms":
            commandType = "send_sms";
            payload = { contact: cmd.contact, number: cmd.number, message: cmd.message };
            break;
          case "send_whatsapp":
            commandType = "send_whatsapp";
            payload = { contact: cmd.contact, message: cmd.message };
            break;
          case "send_email":
            commandType = "send_email";
            payload = { to: cmd.to, subject: cmd.subject, body: cmd.body };
            break;

          default:
            addLog("warn", "web", `Unknown AI command: ${cmd.action}`);
            continue;
        }

        if (commandType) {
          addLog("info", "web", `AI executing: ${commandType}`, JSON.stringify(payload).slice(0, 100));
          const result = await sendCommand(commandType, payload, { awaitResult: true, timeoutMs: 8000 });
          
          if (!result.success) {
            addLog("error", "web", `AI command failed: ${commandType}`, result.error as string);
          }
          
          if (commands.length > 1) {
            await new Promise(r => setTimeout(r, 1500));
          }
        }
      } catch (error) {
        addLog("error", "web", `AI command error: ${cmd.action}`, String(error));
      }
    }

    setExecutingCommands(false);
  };

  // Process message with AI
  const processAIMessage = async (text: string) => {
    setIsProcessing(true);

    try {
      if (!session?.session_token) {
        throw new Error("Not paired. Please connect your PC first.");
      }

      const { data, error } = await supabase.functions.invoke("jarvis-chat", {
        body: { message: text },
        headers: { "x-session-token": session.session_token },
      });

      if (error) {
        throw new Error(error.message || "Failed to get AI response");
      }

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

      // Speak the response if voice is enabled
      if (voiceEnabled && responseText) {
        speak(responseText);
      }

      // Execute any commands
      if ((data as Record<string, unknown>)?.commands) {
        await executeAICommands((data as Record<string, unknown>).commands as AICommand[]);
      }
    } catch (error) {
      console.error("Error:", error);
      const errorMsg = error instanceof Error ? error.message : "Failed to get AI response";
      addLog("error", "web", "AI chat error", errorMsg);
      toast({
        title: "Error",
        description: errorMsg,
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Text chat handler
  const handleSendMessage = useCallback(async (text?: string) => {
    const messageText = text || inputText;
    if (!messageText.trim() || isProcessing) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: messageText,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText("");
    
    await processAIMessage(messageText);
  }, [inputText, isProcessing, session?.session_token]);

  // Toggle voice conversation
  const toggleVoiceConversation = useCallback(() => {
    if (isListening) {
      stopListening();
      stopSpeaking();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening, stopSpeaking]);

  return (
    <DashboardLayout>
      <div className="h-[calc(100vh-6rem)] flex flex-col animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold neon-text">JARVIS AI</h1>
            <p className="text-muted-foreground text-sm md:text-base">
              {isListening ? (isWakeWordActive ? "Listening for command..." : "Say 'Jarvis' to wake") : "Voice assistant ready"}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* Voice Waveform Status */}
            {(isListening || isSpeaking) && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary/50 border border-border">
                <AudioWaveform 
                  isActive={isListening || isSpeaking} 
                  mode={isSpeaking ? "speaking" : "listening"} 
                  className="h-6"
                  barCount={8}
                />
                <span className="text-sm text-muted-foreground">
                  {isSpeaking ? "Speaking" : isWakeWordActive ? "Active" : "Listening"}
                </span>
              </div>
            )}

            {/* Interim transcript */}
            {interimTranscript && (
              <Badge variant="outline" className="max-w-[200px] truncate">
                {interimTranscript}
              </Badge>
            )}

            {executingCommands && (
              <Badge variant="secondary" className="bg-neon-purple/10 text-neon-purple border-neon-purple/30 text-xs animate-pulse">
                <Zap className="h-3 w-3 mr-1" />
                Executing...
              </Badge>
            )}

            {/* Voice Toggle */}
            <div className="flex items-center gap-2 p-2 rounded-lg bg-secondary/30">
              <Label htmlFor="voice-tts" className="text-xs text-muted-foreground">
                TTS
              </Label>
              <Switch
                id="voice-tts"
                checked={voiceEnabled}
                onCheckedChange={(checked) => {
                  setVoiceEnabled(checked);
                  if (!checked) stopSpeaking();
                }}
              />
            </div>

            {/* Settings */}
            <Button
              variant="outline"
              size="icon"
              onClick={() => setShowSettings(!showSettings)}
              className={cn(showSettings && "border-primary")}
            >
              <Settings className="h-4 w-4" />
            </Button>

            <Badge variant="secondary" className="bg-neon-green/10 text-neon-green border-neon-green/30 text-xs">
              {session?.session_token ? "Device Paired" : "Text Mode"}
            </Badge>
          </div>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <Card className="glass-dark border-border/50 mb-4 p-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">Wake Word Detection</Label>
                  <p className="text-xs text-muted-foreground">Say "Jarvis" to activate voice commands</p>
                </div>
                <Switch
                  checked={wakeWordEnabled}
                  onCheckedChange={setWakeWordEnabled}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">Voice Response</Label>
                  <p className="text-xs text-muted-foreground">AI speaks responses aloud (Free - no API key needed)</p>
                </div>
                <Switch
                  checked={voiceEnabled}
                  onCheckedChange={setVoiceEnabled}
                />
              </div>
              <div className="p-3 rounded-lg bg-neon-green/10 border border-neon-green/30">
                <p className="text-sm text-neon-green flex items-center gap-2">
                  <Volume2 className="h-4 w-4" />
                  Using free browser speech synthesis - unlimited, no API key required!
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Chat Area */}
        <Card className="flex-1 glass-dark border-border/50 overflow-hidden flex flex-col min-h-0">
          <ScrollArea className="flex-1 p-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4 md:p-8">
                {/* JARVIS Orb with Waveform */}
                <div className="relative mb-6">
                  <CircularWaveform 
                    isActive={isListening || isSpeaking} 
                    mode={voiceMode}
                    size={140}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Bot className="w-12 h-12 text-primary" />
                  </div>
                </div>

                <h2 className="text-xl md:text-2xl font-bold mb-2">Hey, I'm JARVIS!</h2>
                <p className="text-muted-foreground max-w-md text-sm md:text-base mb-4">
                  Your AI assistant with free voice. Say "Jarvis" followed by a command, or type below.
                </p>

                {/* Voice Conversation Button */}
                <div className="flex flex-col items-center gap-4 mt-4">
                  {!voiceSupported ? (
                    <p className="text-sm text-muted-foreground">
                      Voice not supported in this browser
                    </p>
                  ) : !isListening ? (
                    <Button
                      size="lg"
                      className="gap-2 gradient-primary hover:opacity-90"
                      onClick={toggleVoiceConversation}
                    >
                      <Phone className="h-5 w-5" />
                      Start Voice Mode
                    </Button>
                  ) : (
                    <Button
                      size="lg"
                      variant="destructive"
                      className="gap-2"
                      onClick={toggleVoiceConversation}
                    >
                      <PhoneOff className="h-5 w-5" />
                      Stop Listening
                    </Button>
                  )}
                </div>

                {/* Capabilities */}
                <div className="flex flex-wrap gap-2 mt-6 justify-center max-w-lg">
                  <Badge variant="outline">🖥️ Open/Close Apps</Badge>
                  <Badge variant="outline">🎵 Play Music</Badge>
                  <Badge variant="outline">🔊 Volume Control</Badge>
                  <Badge variant="outline">☀️ Brightness</Badge>
                  <Badge variant="outline">🔒 Lock PC</Badge>
                  <Badge variant="outline">📁 Search Files</Badge>
                  <Badge variant="outline">🌐 Web Search</Badge>
                  <Badge variant="outline">📞 Call/Text</Badge>
                </div>

                {/* Quick suggestions */}
                <div className="flex flex-wrap gap-2 mt-6 justify-center">
                  {[
                    "Play some music",
                    "Set volume to 50",
                    "Open Chrome",
                    "Lock my PC",
                  ].map((suggestion) => (
                    <Button
                      key={suggestion}
                      variant="outline"
                      size="sm"
                      className="border-border/50 hover:border-primary/50 text-xs md:text-sm"
                      onClick={() => setInputText(suggestion)}
                    >
                      {suggestion}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4 py-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "flex gap-3 animate-fade-in",
                      message.role === "user" ? "justify-end" : "justify-start"
                    )}
                  >
                    {message.role === "assistant" && (
                      <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center shrink-0">
                        <Bot className="w-4 h-4 text-primary-foreground" />
                      </div>
                    )}
                    <div
                      className={cn(
                        "max-w-[80%] md:max-w-[70%] rounded-2xl px-4 py-2",
                        message.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "glass border border-border/50"
                      )}
                    >
                      <p className="text-sm md:text-base whitespace-pre-wrap">{message.content}</p>
                      {message.commands && message.commands.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-border/30">
                          <p className="text-xs opacity-70">
                            {message.commands.length} command{message.commands.length > 1 ? "s" : ""} queued
                          </p>
                        </div>
                      )}
                    </div>
                    {message.role === "user" && (
                      <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                        <User className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                ))}
                {isProcessing && (
                  <div className="flex gap-3 justify-start animate-fade-in">
                    <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center">
                      <Bot className="w-4 h-4 text-primary-foreground" />
                    </div>
                    <div className="glass border border-border/50 rounded-2xl px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Thinking...</span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={scrollRef} />
              </div>
            )}
          </ScrollArea>

          {/* Input Area */}
          <CardContent className="border-t border-border/50 p-3 md:p-4 flex-shrink-0">
            <div className="flex gap-2 items-end">
              {/* Voice button */}
              <Button
                variant={isListening ? "destructive" : "outline"}
                size="icon"
                onClick={toggleVoiceConversation}
                disabled={!voiceSupported}
                className="shrink-0"
              >
                {isListening ? (
                  <MicOff className="h-4 w-4" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </Button>

              {/* Text input */}
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
                  placeholder={isListening ? "Listening... or type here" : "Type a message..."}
                  className="w-full px-4 py-2 rounded-xl bg-secondary/50 border border-border/50 focus:border-primary/50 focus:outline-none text-sm md:text-base"
                  disabled={isProcessing}
                />
              </div>

              {/* Stop speaking button */}
              {isSpeaking && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={stopSpeaking}
                  className="shrink-0"
                >
                  <VolumeX className="h-4 w-4" />
                </Button>
              )}

              {/* Send button */}
              <Button
                onClick={() => handleSendMessage()}
                disabled={!inputText.trim() || isProcessing}
                className="shrink-0 gradient-primary"
                size="icon"
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>

            {/* Voice status bar */}
            {isListening && (
              <div className="mt-3 flex items-center justify-center gap-3">
                <AudioWaveform 
                  isActive={true} 
                  mode="listening" 
                  className="h-8"
                  barCount={16}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
