import { useState, useRef, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, Send, Bot, User, Loader2, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  language?: string;
  timestamp: Date;
}

export default function VoiceAI() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [inputText, setInputText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Waveform animation bars
  const waveformBars = Array.from({ length: 20 }, (_, i) => i);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputText.trim() || isProcessing) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: inputText,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText("");
    setIsProcessing(true);

    try {
      // Call AI edge function
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/jarvis-chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            message: inputText,
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

      // Play audio response if available
      if (data.audioUrl) {
        setIsSpeaking(true);
        const audio = new Audio(data.audioUrl);
        audio.onended = () => setIsSpeaking(false);
        audio.play();
      }
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

  const handleMicToggle = () => {
    if (isRecording) {
      setIsRecording(false);
      toast({ title: "Recording stopped" });
    } else {
      setIsRecording(true);
      toast({ title: "Listening...", description: "Speak now" });
      // Voice recording would be implemented with Web Speech API or similar
    }
  };

  return (
    <DashboardLayout>
      <div className="h-[calc(100vh-6rem)] flex flex-col animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold neon-text">Voice AI</h1>
            <p className="text-muted-foreground">Talk to Jarvis in Hindi or English</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-neon-green/10 text-neon-green border-neon-green/30">
              ElevenLabs Active
            </Badge>
            <Badge variant="secondary" className="bg-neon-blue/10 text-neon-blue border-neon-blue/30">
              Multi-language
            </Badge>
          </div>
        </div>

        {/* Chat Area */}
        <Card className="flex-1 glass-dark border-border/50 overflow-hidden flex flex-col">
          <ScrollArea className="flex-1 p-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8">
                <div className="w-24 h-24 rounded-3xl gradient-primary flex items-center justify-center pulse-neon mb-6">
                  <Bot className="w-14 h-14 text-primary-foreground" />
                </div>
                <h2 className="text-2xl font-bold mb-2">Hey, I'm Jarvis!</h2>
                <p className="text-muted-foreground max-w-md">
                  Your personal AI assistant. I can control your PC, play music, search the web, and much more.
                  Just type or speak to get started!
                </p>
                <div className="flex flex-wrap gap-2 mt-6 justify-center">
                  {["What can you do?", "Play some music", "Check system status", "Open Chrome"].map((suggestion) => (
                    <Button
                      key={suggestion}
                      variant="outline"
                      size="sm"
                      className="border-border/50 hover:border-primary/50"
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
                      "flex gap-3",
                      message.role === "user" ? "justify-end" : "justify-start"
                    )}
                  >
                    {message.role === "assistant" && (
                      <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center flex-shrink-0">
                        <Bot className="w-6 h-6 text-primary-foreground" />
                      </div>
                    )}
                    <div
                      className={cn(
                        "max-w-[70%] rounded-2xl px-4 py-3",
                        message.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground"
                      )}
                    >
                      <p>{message.content}</p>
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
                      <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
                        <User className="w-6 h-6" />
                      </div>
                    )}
                  </div>
                ))}
                {isProcessing && (
                  <div className="flex gap-3">
                    <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center">
                      <Bot className="w-6 h-6 text-primary-foreground" />
                    </div>
                    <div className="bg-secondary rounded-2xl px-4 py-3 flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Thinking...</span>
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
          <CardContent className="p-4 border-t border-border/30">
            <div className="flex items-center gap-3">
              <Button
                variant={isRecording ? "destructive" : "secondary"}
                size="icon"
                className={cn(
                  "h-12 w-12 rounded-xl flex-shrink-0",
                  isRecording && "animate-pulse"
                )}
                onClick={handleMicToggle}
              >
                {isRecording ? (
                  <MicOff className="h-5 w-5" />
                ) : (
                  <Mic className="h-5 w-5" />
                )}
              </Button>

              <div className="flex-1 relative">
                <input
                  type="text"
                  placeholder="Type a message or speak..."
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                  className="w-full h-12 px-4 rounded-xl bg-secondary border border-border/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
                />
              </div>

              <Button
                size="icon"
                className="h-12 w-12 rounded-xl gradient-primary flex-shrink-0"
                onClick={handleSendMessage}
                disabled={!inputText.trim() || isProcessing}
              >
                {isProcessing ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
              </Button>

              {isSpeaking && (
                <Button variant="secondary" size="icon" className="h-12 w-12 rounded-xl flex-shrink-0">
                  <Volume2 className="h-5 w-5 text-neon-blue animate-pulse" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
