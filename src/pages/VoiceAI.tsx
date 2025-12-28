import { useState, useRef, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, Send, Bot, User, Loader2, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  language?: string;
  timestamp: Date;
}

export default function VoiceAI() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [inputText, setInputText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();

  const { isRecording, toggleRecording, isSupported } = useVoiceRecorder({
    onTranscript: (text) => {
      setInputText(text);
      // Auto-send after voice input
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

  const parseAndExecuteCommands = async (response: string) => {
    const lowerResponse = response.toLowerCase();
    
    // Volume commands
    if (lowerResponse.includes("volume")) {
      const match = response.match(/(\d+)/);
      if (match) {
        await sendCommand("set_volume", { level: parseInt(match[1]) });
      } else if (lowerResponse.includes("mute")) {
        await sendCommand("set_volume", { level: 0 });
      } else if (lowerResponse.includes("max") || lowerResponse.includes("full")) {
        await sendCommand("set_volume", { level: 100 });
      }
    }
    
    // Brightness commands
    if (lowerResponse.includes("brightness")) {
      const match = response.match(/(\d+)/);
      if (match) {
        await sendCommand("set_brightness", { level: parseInt(match[1]) });
      } else if (lowerResponse.includes("dim")) {
        await sendCommand("set_brightness", { level: 25 });
      } else if (lowerResponse.includes("max") || lowerResponse.includes("full")) {
        await sendCommand("set_brightness", { level: 100 });
      }
    }
    
    // App commands
    if (lowerResponse.includes("open") || lowerResponse.includes("launch")) {
      const apps = ["chrome", "notepad", "spotify", "vscode", "terminal", "calculator"];
      for (const app of apps) {
        if (lowerResponse.includes(app)) {
          await sendCommand("open_app", { app_name: app });
          break;
        }
      }
    }
    
    // Power commands
    if (lowerResponse.includes("shutdown") || lowerResponse.includes("shut down")) {
      await sendCommand("shutdown", {});
    } else if (lowerResponse.includes("restart") || lowerResponse.includes("reboot")) {
      await sendCommand("restart", {});
    } else if (lowerResponse.includes("sleep")) {
      await sendCommand("sleep", {});
    } else if (lowerResponse.includes("lock")) {
      await sendCommand("lock", {});
    }
    
    // Music commands
    if (lowerResponse.includes("play") && (lowerResponse.includes("music") || lowerResponse.includes("song"))) {
      const query = response.replace(/play|music|song/gi, "").trim();
      if (query) {
        await sendCommand("play_music", { query });
      }
    }
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
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/jarvis-chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            message: messageText,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to get response");
      }

      const data = await response.json();

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.response,
        language: data.language,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // Parse response for commands to execute
      await parseAndExecuteCommands(data.response);

      // Speak the response using browser TTS or ElevenLabs
      speakResponse(data.response, data.language);
    } catch (error) {
      console.error("Error:", error);
      toast({
        title: "Error",
        description: "Failed to get AI response. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const speakResponse = (text: string, language: string = "en") => {
    // Use browser's built-in TTS as fallback
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
            <p className="text-muted-foreground text-sm md:text-base">Talk to Jarvis in Hindi or English</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Badge variant="secondary" className="bg-neon-green/10 text-neon-green border-neon-green/30 text-xs">
              Voice Active
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
                  Your personal AI assistant. I can control your PC, play music, and much more.
                  {isSupported ? " Tap the mic or type to start!" : " Type a message to start!"}
                </p>
                <div className="flex flex-wrap gap-2 mt-4 md:mt-6 justify-center">
                  {["Set volume 50%", "Open Chrome", "What can you do?"].map((suggestion) => (
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
                      <p className="text-sm md:text-base">{message.content}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs opacity-70">
                          {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        {message.language && (
                          <Badge variant="outline" className="text-xs py-0 px-1.5">
                            {message.language}
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
                  placeholder={isRecording ? "Listening..." : "Type a message or speak..."}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                  className="w-full h-10 md:h-12 px-3 md:px-4 rounded-xl bg-secondary border border-border/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors text-sm md:text-base"
                />
              </div>

              <Button
                size="icon"
                className="h-10 w-10 md:h-12 md:w-12 rounded-xl gradient-primary flex-shrink-0"
                onClick={() => handleSendMessage()}
                disabled={!inputText.trim() || isProcessing}
              >
                {isProcessing ? (
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
