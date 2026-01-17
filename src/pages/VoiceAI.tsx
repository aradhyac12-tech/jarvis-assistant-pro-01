import { useState, useRef, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, Send, Bot, User, Loader2, Volume2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { addLog } from "@/components/IssueLog";

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
}

export default function VoiceAI() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [inputText, setInputText] = useState("");
  const [executingCommands, setExecutingCommands] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { session } = useDeviceSession();

  const { isRecording, toggleRecording, isSupported } = useVoiceRecorder({
    onTranscript: (text) => {
      setInputText(text);
      handleSendMessage(text);
    },
    onError: (error) => {
      toast({
        title: "Voice Error",
        description: error,
        variant: "destructive",
      });
    },
  });

  const waveformBars = Array.from({ length: 20 }, (_, i) => i);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
            payload = { engine: cmd.engine || "google", query: cmd.query };
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
            payload = { action: cmd.action };
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
          
          // Small delay between commands for multi-step operations
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

  const handleSendMessage = async (text?: string) => {
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
      // Build headers - use session token if available
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (session?.session_token) {
        headers["x-session-token"] = session.session_token;
      } else {
        headers["Authorization"] = `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/jarvis-chat`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ message: messageText }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to get response");
      }

      const data = await response.json();

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.response,
        language: data.language,
        timestamp: new Date(),
        commands: data.commands,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // Execute any commands returned by AI
      if (data.commands && data.commands.length > 0) {
        await executeAICommands(data.commands as AICommand[]);
      }

      // Speak the response
      speakResponse(data.response, data.language);
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

  const speakResponse = (text: string, language: string = "en") => {
    if ("speechSynthesis" in window) {
      setIsSpeaking(true);
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = language === "hi" ? "hi-IN" : "en-US";
      utterance.rate = 1;
      utterance.pitch = 1;

      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      window.speechSynthesis.speak(utterance);
    }
  };

  const stopSpeaking = () => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="h-[calc(100vh-6rem)] flex flex-col animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold neon-text">Voice AI</h1>
            <p className="text-muted-foreground text-sm md:text-base">
              Talk to Jarvis - I can control your PC!
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {executingCommands && (
              <Badge variant="secondary" className="bg-neon-purple/10 text-neon-purple border-neon-purple/30 text-xs animate-pulse">
                <Zap className="h-3 w-3 mr-1" />
                Executing...
              </Badge>
            )}
            <Badge variant="secondary" className="bg-neon-green/10 text-neon-green border-neon-green/30 text-xs">
              {session?.session_token ? "Device Paired" : "Voice Active"}
            </Badge>
            <Badge variant="secondary" className="bg-neon-blue/10 text-neon-blue border-neon-blue/30 text-xs hidden md:flex">
              Multi-language
            </Badge>
          </div>
        </div>

        {/* Chat Area */}
        <Card className="flex-1 glass-dark border-border/50 overflow-hidden flex flex-col min-h-0">
          <ScrollArea className="flex-1 p-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4 md:p-8">
                <div className="w-20 h-20 md:w-24 md:h-24 rounded-3xl gradient-primary flex items-center justify-center pulse-neon mb-4 md:mb-6">
                  <Bot className="w-12 h-12 md:w-14 md:h-14 text-primary-foreground" />
                </div>
                <h2 className="text-xl md:text-2xl font-bold mb-2">Hey, I'm Jarvis!</h2>
                <p className="text-muted-foreground max-w-md text-sm md:text-base">
                  Your AI assistant that can control your PC. Try saying:
                </p>
                <div className="flex flex-wrap gap-2 mt-4 md:mt-6 justify-center">
                  {[
                    "Open YouTube and search for music",
                    "Set volume to 50%",
                    "Open Edge and search ChatGPT",
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
                        {message.language && (
                          <Badge variant="outline" className="text-xs py-0 px-1.5">
                            {message.language}
                          </Badge>
                        )}
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
                        <User className="w-5 h-5 md:w-6 md:h-6" />
                      </div>
                    )}
                  </div>
                ))}
                {isProcessing && (
                  <div className="flex gap-2 md:gap-3">
                    <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl gradient-primary flex items-center justify-center">
                      <Bot className="w-5 h-5 md:w-6 md:h-6 text-primary-foreground" />
                    </div>
                    <div className="bg-secondary rounded-2xl px-3 py-2 md:px-4 md:py-3 flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">Thinking...</span>
                    </div>
                  </div>
                )}
                <div ref={scrollRef} />
              </div>
            )}
          </ScrollArea>

          {/* Waveform Visualization */}
          {(isRecording || isSpeaking) && (
            <div className="px-4 py-3 border-t border-border/30 flex items-center justify-center gap-1">
              {waveformBars.map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "w-1 rounded-full waveform-bar",
                    isRecording ? "bg-neon-green" : "bg-neon-blue"
                  )}
                  style={{
                    height: "24px",
                    animationDelay: `${i * 0.05}s`,
                  }}
                />
              ))}
            </div>
          )}

          {/* Input Area */}
          <CardContent className="p-3 md:p-4 border-t border-border/30 flex-shrink-0">
            <div className="flex items-center gap-2 md:gap-3">
              {isSupported && (
                <Button
                  variant={isRecording ? "destructive" : "secondary"}
                  size="icon"
                  className={cn(
                    "h-10 w-10 md:h-12 md:w-12 rounded-xl flex-shrink-0",
                    isRecording && "animate-pulse"
                  )}
                  onClick={toggleRecording}
                  disabled={isProcessing || executingCommands}
                >
                  {isRecording ? (
                    <MicOff className="h-4 w-4 md:h-5 md:w-5" />
                  ) : (
                    <Mic className="h-4 w-4 md:h-5 md:w-5" />
                  )}
                </Button>
              )}

              <div className="flex-1 relative">
                <input
                  type="text"
                  placeholder={
                    isRecording
                      ? "Listening..."
                      : executingCommands
                      ? "Executing commands..."
                      : "Type a command or speak..."
                  }
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                  disabled={isProcessing || executingCommands}
                  className="w-full h-10 md:h-12 px-3 md:px-4 rounded-xl bg-secondary border border-border/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors text-sm md:text-base disabled:opacity-50"
                />
              </div>

              <Button
                size="icon"
                className="h-10 w-10 md:h-12 md:w-12 rounded-xl gradient-primary flex-shrink-0"
                onClick={() => handleSendMessage()}
                disabled={!inputText.trim() || isProcessing || executingCommands}
              >
                {isProcessing || executingCommands ? (
                  <Loader2 className="h-4 w-4 md:h-5 md:w-5 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 md:h-5 md:w-5" />
                )}
              </Button>

              {isSpeaking && (
                <Button
                  variant="secondary"
                  size="icon"
                  className="h-10 w-10 md:h-12 md:w-12 rounded-xl flex-shrink-0"
                  onClick={stopSpeaking}
                >
                  <Volume2 className="h-4 w-4 md:h-5 md:w-5 text-neon-blue animate-pulse" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
