import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bot,
  Wifi,
  WifiOff,
  Send,
  Loader2,
  Settings,
  Trash2,
  MessageSquare,
  Zap,
  Clock,
  CheckCircle2,
  Copy,
  ExternalLink,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useClawdBot, ClawdBotConfig } from "@/hooks/useClawdBot";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";

export function ClawdBotPanel({ className }: { className?: string }) {
  const { toast } = useToast();
  const {
    config,
    status,
    isConnecting,
    messages,
    isTyping,
    connect,
    disconnect,
    sendMessage,
    clearMessages,
  } = useClawdBot();

  const [showSetup, setShowSetup] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [gatewayUrl, setGatewayUrl] = useState(config?.gatewayUrl || "http://localhost:18789");
  const [token, setToken] = useState(config?.token || "");
  const [messageInput, setMessageInput] = useState("");

  // Update form when config changes
  useEffect(() => {
    if (config) {
      setGatewayUrl(config.gatewayUrl);
      setToken(config.token);
    }
  }, [config]);

  const handleConnect = async () => {
    const newConfig: ClawdBotConfig = {
      gatewayUrl: gatewayUrl.trim(),
      token: token.trim(),
    };
    const success = await connect(newConfig);
    if (success) {
      setShowSetup(false);
    }
  };

  const handleSend = async () => {
    if (!messageInput.trim() || isTyping) return;
    const msg = messageInput;
    setMessageInput("");
    await sendMessage(msg);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatUptime = (seconds?: number) => {
    if (!seconds) return "—";
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  };

  return (
    <Card className={cn("border-border/50 overflow-hidden", className)}>
      <CardHeader className="pb-3 space-y-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <div className={cn(
              "p-1.5 rounded-lg",
              status.connected ? "bg-primary/10" : "bg-muted"
            )}>
              <Bot className={cn(
                "h-4 w-4",
                status.connected ? "text-primary" : "text-muted-foreground"
              )} />
            </div>
            ClawdBot
          </CardTitle>
          
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "gap-1 text-xs",
                status.connected 
                  ? "border-primary/50 text-primary" 
                  : "border-muted text-muted-foreground"
              )}
            >
              {status.connected ? (
                <><Wifi className="h-3 w-3" /> Connected</>
              ) : (
                <><WifiOff className="h-3 w-3" /> Offline</>
              )}
            </Badge>
            
            {/* Help Button */}
            <Dialog open={showHelp} onOpenChange={setShowHelp}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <HelpCircle className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Bot className="h-5 w-5 text-primary" />
                    ClawdBot Setup Guide
                  </DialogTitle>
                </DialogHeader>
                
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <h4 className="font-medium text-sm">What is ClawdBot?</h4>
                    <p className="text-sm text-muted-foreground">
                      ClawdBot is a self-hosted AI gateway that lets you run your own AI assistant using Claude. 
                      It provides an OpenAI-compatible API endpoint.
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <h4 className="font-medium text-sm">Quick Setup</h4>
                    <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                      <li>
                        Visit{" "}
                        <a 
                          href="https://clawd.bot" 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-primary hover:underline inline-flex items-center gap-1"
                        >
                          clawd.bot <ExternalLink className="h-3 w-3" />
                        </a>
                      </li>
                      <li>Download and install the gateway for your OS</li>
                      <li>Run the gateway (default port: 18789)</li>
                      <li>Copy your auth token from the gateway console</li>
                      <li>Paste the token below and connect</li>
                    </ol>
                  </div>
                  
                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <Button variant="outline" size="sm" className="w-full">
                        Show Default Configuration
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2 space-y-2">
                      <div className="bg-muted rounded-md p-3 font-mono text-xs space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Gateway URL:</span>
                          <div className="flex items-center gap-1">
                            <span>http://localhost:18789</span>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-5 w-5"
                              onClick={() => copyToClipboard("http://localhost:18789")}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">API Path:</span>
                          <span>/v1/chat/completions</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Status Path:</span>
                          <span>/api/v1/status</span>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                  
                  <div className="p-3 bg-primary/5 border border-primary/20 rounded-md">
                    <p className="text-sm text-primary">
                      <strong>Tip:</strong> Make sure the gateway is running before connecting. 
                      You should see a console window with your auth token.
                    </p>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            
            {/* Settings Button */}
            <Dialog open={showSetup} onOpenChange={setShowSetup}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Settings className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Bot className="h-5 w-5 text-primary" />
                    ClawdBot Gateway
                  </DialogTitle>
                  <DialogDescription>
                    Connect to your self-hosted ClawdBot gateway
                  </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="gateway-url">Gateway URL</Label>
                    <Input
                      id="gateway-url"
                      placeholder="http://localhost:18789"
                      value={gatewayUrl}
                      onChange={(e) => setGatewayUrl(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Default port is 18789 for local installations
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="token">Auth Token</Label>
                    <Input
                      id="token"
                      type="password"
                      placeholder="Enter gateway token from console"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Find this in your ClawdBot gateway console window
                    </p>
                  </div>
                </div>
                
                <DialogFooter className="gap-2">
                  {status.connected && (
                    <Button variant="outline" onClick={disconnect}>
                      Disconnect
                    </Button>
                  )}
                  <Button onClick={handleConnect} disabled={isConnecting || !gatewayUrl}>
                    {isConnecting ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Connecting...</>
                    ) : (
                      "Connect"
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="p-0">
        {!status.connected ? (
          <div className="p-6 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <Bot className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium mb-1">Connect ClawdBot</p>
            <p className="text-xs text-muted-foreground mb-4 max-w-[220px]">
              Self-hosted AI assistant using Claude. Get yours at{" "}
              <a 
                href="https://clawd.bot" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                clawd.bot
              </a>
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowHelp(true)}>
                <HelpCircle className="h-4 w-4 mr-2" />
                How to Setup
              </Button>
              <Button size="sm" onClick={() => setShowSetup(true)}>
                <Zap className="h-4 w-4 mr-2" />
                Connect
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Status Bar */}
            <div className="px-4 py-2 border-b border-border/50 bg-muted/30 flex items-center justify-between">
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-primary" />
                  {status.agentName || "Clawd"}
                </span>
                {status.version && (
                  <span>v{status.version}</span>
                )}
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatUptime(status.uptime)}
                </span>
              </div>
              
              {status.channels && status.channels.length > 0 && (
                <div className="flex gap-1">
                  {status.channels.slice(0, 3).map((ch) => (
                    <Badge key={ch} variant="secondary" className="text-[10px] px-1.5">
                      {ch}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            
            {/* Messages */}
            <ScrollArea className="h-48">
              <div className="p-3 space-y-3">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-36 text-muted-foreground">
                    <MessageSquare className="h-8 w-8 mb-2 opacity-50" />
                    <p className="text-xs">Start a conversation with ClawdBot</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      Try: "What can you help me with?"
                    </p>
                  </div>
                ) : (
                  <>
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={cn(
                          "flex",
                          msg.role === "user" ? "justify-end" : "justify-start"
                        )}
                      >
                        <div
                          className={cn(
                            "max-w-[80%] rounded-xl px-3 py-2",
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
                          )}
                        >
                          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                          <p className={cn(
                            "text-[10px] mt-1",
                            msg.role === "user" 
                              ? "text-primary-foreground/70" 
                              : "text-muted-foreground"
                          )}>
                            {formatTime(msg.timestamp)}
                          </p>
                        </div>
                      </div>
                    ))}
                    
                    {isTyping && (
                      <div className="flex justify-start">
                        <div className="bg-muted rounded-xl px-3 py-2">
                          <div className="flex items-center gap-1">
                            <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                            <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                            <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </ScrollArea>
            
            {/* Input */}
            <div className="p-3 border-t border-border/50 flex gap-2">
              <Input
                placeholder="Ask ClawdBot anything..."
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                className="flex-1 h-9 text-sm"
                disabled={isTyping}
              />
              <Button 
                size="icon" 
                className="h-9 w-9 shrink-0" 
                onClick={handleSend}
                disabled={!messageInput.trim() || isTyping}
              >
                <Send className="h-4 w-4" />
              </Button>
              {messages.length > 0 && (
                <Button 
                  size="icon" 
                  variant="ghost" 
                  className="h-9 w-9 shrink-0" 
                  onClick={clearMessages}
                  title="Clear chat"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
