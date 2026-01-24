import { useState, useRef, useEffect, useCallback } from "react";
import { useConversation } from "@elevenlabs/react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
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
  VolumeX,
  Phone,
  PhoneOff,
  Waves,
  Settings,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useElevenLabsTTS } from "@/hooks/useElevenLabsTTS";
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
}

export default function VoiceAI() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [inputText, setInputText] = useState("");
  const [executingCommands, setExecutingCommands] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { session } = useDeviceSession();

  // ElevenLabs TTS for AI responses
  const { speak, stopSpeaking, isSpeaking, isLoading: ttsLoading } = useElevenLabsTTS();

  // Voice conversation state
  const [agentId, setAgentId] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);

  // ElevenLabs Conversation Hook for real-time voice
  const conversation = useConversation({
    onConnect: () => {
      console.log("Connected to ElevenLabs agent");
      addLog("info", "web", "Connected to JARVIS voice agent");
      toast({ title: "Connected", description: "Voice conversation active" });
    },
    onDisconnect: () => {
      console.log("Disconnected from ElevenLabs agent");
      addLog("info", "web", "Disconnected from voice agent");
    },
    onMessage: (message: unknown) => {
      console.log("Agent message:", message);
      const msg = message as Record<string, unknown>;
      
      // Handle different message types
      if (msg?.type === "user_transcript") {
        const event = msg as { user_transcription_event?: { user_transcript?: string } };
        const userText = event.user_transcription_event?.user_transcript;
        if (userText) {
          const userMessage: Message = {
            id: Date.now().toString(),
            role: "user",
            content: userText,
            timestamp: new Date(),
          };
          setMessages(prev => [...prev, userMessage]);
        }
      } else if (msg?.type === "agent_response") {
        const event = msg as { agent_response_event?: { agent_response?: string } };
        const agentText = event.agent_response_event?.agent_response;
        if (agentText) {
          const assistantMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: agentText,
            timestamp: new Date(),
          };
          setMessages(prev => [...prev, assistantMessage]);
        }
      }
    },
    onError: (error) => {
      console.error("Conversation error:", error);
      addLog("error", "web", "Voice conversation error", String(error));
      toast({
        variant: "destructive",
        title: "Voice Error",
        description: "Connection lost. Please try again.",
      });
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Start real-time voice conversation
  const startVoiceConversation = useCallback(async () => {
    if (!agentId.trim()) {
      toast({
        variant: "destructive",
        title: "Agent ID Required",
        description: "Enter your ElevenLabs Agent ID in settings",
      });
      setShowSettings(true);
      return;
    }

    setIsConnecting(true);
    try {
      // Request microphone permission
      await navigator.mediaDevices.getUserMedia({ audio: true });

      // Start with agent ID directly (public agent)
      await conversation.startSession({
        agentId: agentId.trim(),
        connectionType: "webrtc",
      });
    } catch (error) {
      console.error("Failed to start conversation:", error);
      addLog("error", "web", "Failed to start voice conversation", String(error));
      toast({
        variant: "destructive",
        title: "Connection Failed",
        description: error instanceof Error ? error.message : "Could not connect to voice agent",
      });
    } finally {
      setIsConnecting(false);
    }
  }, [agentId, conversation, toast]);

  const stopVoiceConversation = useCallback(async () => {
    await conversation.endSession();
    addLog("info", "web", "Ended voice conversation");
  }, [conversation]);

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
          case "open_app":
            commandType = "open_app";
            payload = { app_name: cmd.app_name };
            break;
          case "open_website":
            commandType = "open_website";
            payload = { site: cmd.site, query: cmd.query || "" };
            break;
          case "search_web":
            commandType = "search_web";
            payload = { engine: cmd.engine || "google", query: cmd.query, press_enter: true };
            break;
          case "play_music":
            commandType = "play_music";
            payload = { query: cmd.query, service: "youtube" };
            break;
          case "set_volume":
            commandType = "set_volume";
            payload = { level: cmd.level };
            break;
          case "set_brightness":
            commandType = "set_brightness";
            payload = { level: cmd.level };
            break;
          case "media_control":
            commandType = "media_control";
            payload = { action: cmd.control || "play_pause" };
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
          case "type_text":
            commandType = "type_text";
            payload = { text: cmd.text };
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

  // Text chat with TTS response
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
    setIsProcessing(true);

    try {
      if (!session?.session_token) {
        throw new Error("Not paired. Please connect your PC first.");
      }

      const { data, error } = await supabase.functions.invoke("jarvis-chat", {
        body: { message: messageText },
        headers: { "x-session-token": session.session_token },
      });

      if (error) {
        throw new Error(error.message || "Failed to get AI response");
      }

      const responseText = (data as any)?.response ?? "";
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: responseText,
        language: (data as any)?.language,
        timestamp: new Date(),
        commands: (data as any)?.commands,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // Speak the response if voice is enabled
      if (voiceEnabled && responseText) {
        speak(responseText);
      }

      // Execute any commands
      if ((data as any)?.commands && (data as any).commands.length > 0) {
        await executeAICommands((data as any).commands as AICommand[]);
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
  }, [inputText, isProcessing, session?.session_token, toast, sendCommand, voiceEnabled, speak]);

  const isConnected = conversation.status === "connected";

  return (
    <DashboardLayout>
      <div className="h-[calc(100vh-6rem)] flex flex-col animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold neon-text">JARVIS AI</h1>
            <p className="text-muted-foreground text-sm md:text-base">
              {isConnected ? "Voice conversation active" : "Your AI assistant with voice"}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* Voice Status */}
            {isConnected && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-neon-green/10 border border-neon-green/30">
                <Waves className="h-4 w-4 text-neon-green animate-pulse" />
                <span className="text-sm text-neon-green">
                  {conversation.isSpeaking ? "Speaking..." : "Listening..."}
                </span>
              </div>
            )}

            {/* TTS Status */}
            {isSpeaking && (
              <Badge variant="secondary" className="bg-neon-blue/10 text-neon-blue border-neon-blue/30">
                <Volume2 className="h-3 w-3 mr-1 animate-pulse" />
                Speaking
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
              <div>
                <Label className="text-sm text-muted-foreground mb-2 block">
                  ElevenLabs Agent ID (for real-time voice)
                </Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Enter your agent ID from ElevenLabs dashboard"
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
                    className="flex-1"
                  />
                  <Button variant="outline" size="sm" onClick={() => setShowSettings(false)}>
                    Done
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Create a voice agent at{" "}
                  <a 
                    href="https://elevenlabs.io/conversational-ai" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    elevenlabs.io/conversational-ai
                  </a>
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
                <div className="w-20 h-20 md:w-24 md:h-24 rounded-3xl gradient-primary flex items-center justify-center pulse-neon mb-4 md:mb-6">
                  <Bot className="w-12 h-12 md:w-14 md:h-14 text-primary-foreground" />
                </div>
                <h2 className="text-xl md:text-2xl font-bold mb-2">Hey, I'm JARVIS!</h2>
                <p className="text-muted-foreground max-w-md text-sm md:text-base mb-4">
                  Your AI assistant with voice. Type a message or start a voice conversation.
                </p>

                {/* Voice Conversation Button */}
                <div className="flex flex-col items-center gap-4 mt-4">
                  {!isConnected ? (
                    <Button
                      size="lg"
                      className="gap-2 gradient-primary hover:opacity-90"
                      onClick={startVoiceConversation}
                      disabled={isConnecting}
                    >
                      {isConnecting ? (
                        <>
                          <Loader2 className="h-5 w-5 animate-spin" />
                          Connecting...
                        </>
                      ) : (
                        <>
                          <Phone className="h-5 w-5" />
                          Start Voice Conversation
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button
                      size="lg"
                      variant="destructive"
                      className="gap-2"
                      onClick={stopVoiceConversation}
                    >
                      <PhoneOff className="h-5 w-5" />
                      End Conversation
                    </Button>
                  )}

                  {!agentId && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Configure Agent ID in settings first
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 mt-6 justify-center">
                  {[
                    "Open YouTube and search for music",
                    "Set volume to 50%",
                    "Play Bohemian Rhapsody",
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
              <div className="space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "flex gap-2 md:gap-3",
                      message.role === "user" ? "justify-end" : "justify-start"
                    )}
                  >
                    {message.role === "assistant" && (
                      <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl gradient-primary flex items-center justify-center flex-shrink-0">
                        <Bot className="w-5 h-5 md:w-6 md:h-6 text-primary-foreground" />
                      </div>
                    )}
                    <div
                      className={cn(
                        "max-w-[80%] md:max-w-[70%] rounded-2xl px-3 py-2 md:px-4 md:py-3",
                        message.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground"
                      )}
                    >
                      <p className="text-sm md:text-base whitespace-pre-wrap">{message.content}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-xs opacity-70">
                          {message.timestamp.toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        {message.commands && message.commands.length > 0 && (
                          <Badge variant="secondary" className="text-xs py-0 px-1.5 bg-neon-purple/20 text-neon-purple">
                            <Zap className="h-2.5 w-2.5 mr-0.5" />
                            {message.commands.length} action{message.commands.length > 1 ? "s" : ""}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {message.role === "user" && (
                      <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
                        <User className="w-5 h-5 md:w-6 md:h-6 text-secondary-foreground" />
                      </div>
                    )}
                  </div>
                ))}
                {isProcessing && (
                  <div className="flex gap-3 justify-start">
                    <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl gradient-primary flex items-center justify-center">
                      <Bot className="w-5 h-5 md:w-6 md:h-6 text-primary-foreground" />
                    </div>
                    <div className="bg-secondary rounded-2xl px-4 py-3">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  </div>
                )}
                <div ref={scrollRef} />
              </div>
            )}
          </ScrollArea>

          {/* Input Area */}
          <CardContent className="border-t border-border/50 pt-4 flex-shrink-0">
            <div className="flex gap-2">
              {/* Voice Controls for Active Conversation */}
              {isConnected && (
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={stopVoiceConversation}
                  title="End voice conversation"
                >
                  <PhoneOff className="h-5 w-5" />
                </Button>
              )}

              {/* Stop TTS */}
              {isSpeaking && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={stopSpeaking}
                  title="Stop speaking"
                >
                  <VolumeX className="h-5 w-5" />
                </Button>
              )}

              <Input
                placeholder={isConnected ? "Voice mode active - speak to me!" : "Type your message..."}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
                disabled={isProcessing}
                className="flex-1"
              />
              <Button
                onClick={() => handleSendMessage()}
                disabled={isProcessing || !inputText.trim()}
                className="gradient-primary"
              >
                {isProcessing ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
