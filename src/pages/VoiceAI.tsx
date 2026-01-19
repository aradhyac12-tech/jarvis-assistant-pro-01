import { useState, useRef, useEffect, useCallback } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Send, Bot, User, Loader2, Zap, Mic, MicOff, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceSession } from "@/hooks/useDeviceSession";
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

  // Voice recognition state
  const [isListening, setIsListening] = useState(false);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [isWaitingForWakeWord, setIsWaitingForWakeWord] = useState(false);
  const recognitionRef = useRef<any>(null);
  const wakeWordRecognitionRef = useRef<any>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Initialize speech recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (SpeechRecognition) {
      // Main recognition for commands
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setIsListening(false);
        handleSendMessage(transcript);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech recognition error:", event.error);
        setIsListening(false);
        if (event.error !== 'no-speech') {
          toast({
            title: "Voice Error",
            description: `Could not recognize speech: ${event.error}`,
            variant: "destructive",
          });
        }
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };

      // Wake word recognition
      wakeWordRecognitionRef.current = new SpeechRecognition();
      wakeWordRecognitionRef.current.continuous = true;
      wakeWordRecognitionRef.current.interimResults = true;
      wakeWordRecognitionRef.current.lang = 'en-US';

      wakeWordRecognitionRef.current.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript.toLowerCase();
          
          // Check for wake word "Jarvis"
          if (transcript.includes('jarvis') || transcript.includes('jarves') || transcript.includes('jarwis')) {
            addLog("info", "web", "Wake word 'Jarvis' detected!");
            
            // Stop wake word listening temporarily
            wakeWordRecognitionRef.current.stop();
            setIsWaitingForWakeWord(false);
            
            // Play acknowledgment sound or visual feedback
            toast({
              title: "👋 Yes?",
              description: "I'm listening...",
            });
            
            // Start listening for command
            setTimeout(() => {
              startListening();
            }, 300);
            
            break;
          }
        }
      };

      wakeWordRecognitionRef.current.onerror = (event: any) => {
        if (event.error === 'no-speech') {
          // Restart wake word listening
          if (wakeWordEnabled && !isListening) {
            setTimeout(() => {
              try {
                wakeWordRecognitionRef.current.start();
                setIsWaitingForWakeWord(true);
              } catch (e) {
                // Already running
              }
            }, 100);
          }
        }
      };

      wakeWordRecognitionRef.current.onend = () => {
        // Restart wake word listening if enabled
        if (wakeWordEnabled && !isListening) {
          setTimeout(() => {
            try {
              wakeWordRecognitionRef.current.start();
              setIsWaitingForWakeWord(true);
            } catch (e) {
              // Already running
            }
          }, 100);
        }
      };
    }

    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (e) {}
      }
      if (wakeWordRecognitionRef.current) {
        try { wakeWordRecognitionRef.current.stop(); } catch (e) {}
      }
    };
  }, [toast, wakeWordEnabled]);

  // Handle wake word toggle
  const handleWakeWordToggle = (enabled: boolean) => {
    setWakeWordEnabled(enabled);
    
    if (enabled && wakeWordRecognitionRef.current) {
      try {
        wakeWordRecognitionRef.current.start();
        setIsWaitingForWakeWord(true);
        toast({
          title: "Wake Word Enabled",
          description: "Say 'Jarvis' to activate voice commands",
        });
      } catch (e) {
        console.error("Failed to start wake word recognition:", e);
      }
    } else if (wakeWordRecognitionRef.current) {
      try {
        wakeWordRecognitionRef.current.stop();
        setIsWaitingForWakeWord(false);
      } catch (e) {}
    }
  };

  const startListening = () => {
    if (!recognitionRef.current) {
      toast({
        title: "Not Supported",
        description: "Voice recognition is not supported in this browser",
        variant: "destructive",
      });
      return;
    }

    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (e) {
      console.error("Failed to start recognition:", e);
      setIsListening(false);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
    setIsListening(false);
  };

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
            // Add press_enter flag to actually search
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
    
    // Restart wake word listening after command execution
    if (wakeWordEnabled && wakeWordRecognitionRef.current) {
      setTimeout(() => {
        try {
          wakeWordRecognitionRef.current.start();
          setIsWaitingForWakeWord(true);
        } catch (e) {}
      }, 500);
    }
  };

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

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: (data as any)?.response ?? "",
        language: (data as any)?.language,
        timestamp: new Date(),
        commands: (data as any)?.commands,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // Execute any commands returned by AI
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
  }, [inputText, isProcessing, session?.session_token, toast, sendCommand]);

  return (
    <DashboardLayout>
      <div className="h-[calc(100vh-6rem)] flex flex-col animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold neon-text">AI Assistant</h1>
            <p className="text-muted-foreground text-sm md:text-base">
              Chat with Jarvis - I can control your PC!
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* Wake Word Toggle */}
            <div className="flex items-center gap-2 p-2 rounded-lg bg-secondary/30">
              <Label htmlFor="wake-word" className="text-xs text-muted-foreground">
                Wake: "Jarvis"
              </Label>
              <Switch
                id="wake-word"
                checked={wakeWordEnabled}
                onCheckedChange={handleWakeWordToggle}
              />
              {isWaitingForWakeWord && (
                <span className="w-2 h-2 rounded-full bg-neon-green animate-pulse" />
              )}
            </div>
            
            {executingCommands && (
              <Badge variant="secondary" className="bg-neon-purple/10 text-neon-purple border-neon-purple/30 text-xs animate-pulse">
                <Zap className="h-3 w-3 mr-1" />
                Executing...
              </Badge>
            )}
            <Badge variant="secondary" className="bg-neon-green/10 text-neon-green border-neon-green/30 text-xs">
              {session?.session_token ? "Device Paired" : "Text Mode"}
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
                  Your AI assistant that can control your PC. Try saying "Jarvis" or click the mic!
                </p>
                <div className="flex flex-wrap gap-2 mt-4 md:mt-6 justify-center">
                  {[
                    "Open YouTube and search for music",
                    "Set volume to 50%",
                    "Search for Python tutorials on ChatGPT",
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

          {/* Input Area */}
          <CardContent className="p-3 md:p-4 border-t border-border/30 flex-shrink-0">
            <div className="flex items-center gap-2 md:gap-3">
              {/* Voice Button */}
              <Button
                size="icon"
                variant={isListening ? "destructive" : "secondary"}
                className={cn(
                  "h-10 w-10 md:h-12 md:w-12 rounded-xl flex-shrink-0",
                  isListening && "animate-pulse"
                )}
                onClick={isListening ? stopListening : startListening}
                disabled={isProcessing || executingCommands}
              >
                {isListening ? (
                  <MicOff className="h-4 w-4 md:h-5 md:w-5" />
                ) : (
                  <Mic className="h-4 w-4 md:h-5 md:w-5" />
                )}
              </Button>

              <div className="flex-1 relative">
                <input
                  type="text"
                  placeholder={
                    isListening
                      ? "Listening..."
                      : executingCommands
                      ? "Executing commands..."
                      : "Type a command or say 'Jarvis'..."
                  }
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                  disabled={isProcessing || executingCommands || isListening}
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
            </div>
            
            {/* Voice status indicator */}
            {(isListening || isWaitingForWakeWord) && (
              <div className="mt-2 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Volume2 className="h-3 w-3 text-primary animate-pulse" />
                <span>{isListening ? "Speak now..." : "Waiting for 'Jarvis'..."}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
