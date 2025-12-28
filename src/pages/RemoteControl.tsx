import { useState, useRef, useEffect, useCallback } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { 
  Keyboard, Mouse, Clipboard, Monitor, Send, Copy, 
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  Loader2, Check, RefreshCw, Play, Pause, SkipForward, SkipBack,
  Volume2, ToggleLeft, ToggleRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { supabase } from "@/integrations/supabase/client";

export default function RemoteControl() {
  const [textInput, setTextInput] = useState("");
  const [clipboardText, setClipboardText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [isLoadingScreenshot, setIsLoadingScreenshot] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamFps, setStreamFps] = useState(5);
  const [rawKeyMode, setRawKeyMode] = useState(false);
  const trackpadRef = useRef<HTMLDivElement>(null);
  const lastPosition = useRef({ x: 0, y: 0 });
  const streamInterval = useRef<NodeJS.Timeout | null>(null);
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();

  // Handle physical keyboard input - both raw and text modes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Only capture when not in text input
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;
      
      e.preventDefault();
      
      const key = e.key;
      const code = e.code;
      
      // Build key combo
      const modifiers: string[] = [];
      if (e.ctrlKey) modifiers.push("ctrl");
      if (e.altKey) modifiers.push("alt");
      if (e.shiftKey && modifiers.length > 0) modifiers.push("shift");
      if (e.metaKey) modifiers.push("win");
      
      if (modifiers.length > 0 && !["Control", "Alt", "Shift", "Meta"].includes(key)) {
        modifiers.push(key.toLowerCase());
        sendCommand("key_combo", { keys: modifiers });
        setLastKey(modifiers.join("+"));
      } else if (rawKeyMode || key.length > 1) {
        // Raw mode or special keys
        sendCommand("press_key", { key: key.toLowerCase() });
        setLastKey(key);
      } else {
        // Text mode - send as typed text
        sendCommand("type_text", { text: key });
        setLastKey(key);
      }
      
      setTimeout(() => setLastKey(null), 300);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sendCommand, rawKeyMode]);

  const sendKeyboard = async () => {
    if (!textInput.trim()) return;
    setIsSending(true);
    await sendCommand("type_text", { text: textInput });
    toast({ title: "Text Sent", description: `Typed: ${textInput.slice(0, 30)}...` });
    setTextInput("");
    setIsSending(false);
  };

  const sendKey = async (key: string) => {
    setLastKey(key);
    
    if (key.includes("+")) {
      const keys = key.toLowerCase().split("+").map(k => k.trim());
      await sendCommand("key_combo", { keys });
    } else {
      await sendCommand("press_key", { key: key.toLowerCase() });
    }
    
    setTimeout(() => setLastKey(null), 200);
  };

  const quickKeys = [
    { label: "Enter", key: "enter" },
    { label: "Esc", key: "escape" },
    { label: "Tab", key: "tab" },
    { label: "Space", key: "space" },
    { label: "⌫", key: "backspace" },
    { label: "Del", key: "delete" },
    { label: "Ctrl+C", key: "ctrl+c" },
    { label: "Ctrl+V", key: "ctrl+v" },
    { label: "Ctrl+Z", key: "ctrl+z" },
    { label: "Ctrl+S", key: "ctrl+s" },
    { label: "Alt+Tab", key: "alt+tab" },
    { label: "Win", key: "win" },
    { label: "Ctrl+A", key: "ctrl+a" },
    { label: "F5", key: "f5" },
    { label: "F11", key: "f11" },
    { label: "PrtSc", key: "printscreen" },
  ];

  // Trackpad handling with reduced lag
  const handleTrackpadStart = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const point = "touches" in e ? e.touches[0] : e;
    lastPosition.current = { x: point.clientX, y: point.clientY };
  }, []);

  const handleTrackpadMove = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (!("buttons" in e) || e.buttons !== 1) {
      if (!("touches" in e)) return;
    }
    
    const point = "touches" in e ? e.touches[0] : e;
    const deltaX = (point.clientX - lastPosition.current.x) * 2.5;
    const deltaY = (point.clientY - lastPosition.current.y) * 2.5;
    
    lastPosition.current = { x: point.clientX, y: point.clientY };
    
    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
      sendCommand("mouse_move", { x: Math.round(deltaX), y: Math.round(deltaY), relative: true });
    }
  }, [sendCommand]);

  const handleMouseClick = async (button: string = "left", clicks: number = 1) => {
    await sendCommand("mouse_click", { button, clicks });
  };

  const handleMouseScroll = async (direction: "up" | "down") => {
    await sendCommand("mouse_scroll", { amount: direction === "up" ? 5 : -5 });
  };

  const handleArrowMove = async (direction: "up" | "down" | "left" | "right") => {
    const moves: Record<string, { x: number; y: number }> = {
      up: { x: 0, y: -30 },
      down: { x: 0, y: 30 },
      left: { x: -30, y: 0 },
      right: { x: 30, y: 0 },
    };
    await sendCommand("mouse_move", { ...moves[direction], relative: true });
  };

  // Media controls
  const handleMediaControl = async (action: string) => {
    await sendCommand("media_control", { action });
    toast({ title: "Media", description: action.replace("_", " ") });
  };

  // Clipboard
  const sendClipboardToPC = async () => {
    if (!clipboardText.trim()) return;
    await sendCommand("set_clipboard", { content: clipboardText });
    toast({ title: "Clipboard Sent", description: "Text copied to PC clipboard" });
  };

  const getClipboardFromPC = async () => {
    const result = await sendCommand("get_clipboard", {});
    // Listen for command result
    toast({ title: "Getting Clipboard", description: "Fetching from PC..." });
  };

  // Screenshot / Streaming
  const [streamStatus, setStreamStatus] = useState<"idle" | "starting" | "active" | "stopping">("idle");
  const [lastFrameTime, setLastFrameTime] = useState<number>(0);
  const streamAbortRef = useRef<boolean>(false);

  const takeScreenshot = async () => {
    setIsLoadingScreenshot(true);
    try {
      const result = await sendCommand("screenshot", { quality: 75, scale: 0.6 }, { awaitResult: true, timeoutMs: 5000 });
      if (result.success && "result" in result && result.result?.image) {
        setScreenshot(result.result.image as string);
      }
    } catch (error) {
      console.error("Screenshot error:", error);
    }
    setIsLoadingScreenshot(false);
  };

  const startStreaming = async () => {
    setStreamStatus("starting");
    streamAbortRef.current = false;
    
    await sendCommand("start_stream", { fps: streamFps, quality: 40 });
    setIsStreaming(true);
    setStreamStatus("active");
    
    // Improved frame polling loop
    const pollFrames = async () => {
      while (!streamAbortRef.current) {
        try {
          const result = await sendCommand("get_frame", {}, { awaitResult: true, timeoutMs: 3000 });
          if (result.success && "result" in result && result.result?.image) {
            setScreenshot(result.result.image as string);
            setLastFrameTime(Date.now());
          }
        } catch (e) {
          console.error("Frame poll error:", e);
        }
        
        await new Promise(r => setTimeout(r, 1000 / streamFps));
      }
    };
    
    pollFrames();
  };

  const stopStreaming = async () => {
    setStreamStatus("stopping");
    streamAbortRef.current = true;
    
    if (streamInterval.current) {
      clearInterval(streamInterval.current);
      streamInterval.current = null;
    }
    
    await sendCommand("stop_stream", {});
    setIsStreaming(false);
    setStreamStatus("idle");
    toast({ title: "Streaming Stopped" });
  };

  const toggleStreaming = async () => {
    if (isStreaming || streamStatus === "active") {
      await stopStreaming();
    } else {
      await startStreaming();
    }
  };

  // Cleanup streaming on unmount
  useEffect(() => {
    return () => {
      streamAbortRef.current = true;
      if (streamInterval.current) {
        clearInterval(streamInterval.current);
      }
    };
  }, []);

  return (
    <DashboardLayout>
      <ScrollArea className="h-[calc(100vh-2rem)]">
        <div className="space-y-4 animate-fade-in pr-4 pt-12 md:pt-0">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold neon-text">Remote Control</h1>
              <p className="text-muted-foreground text-sm">Control your PC remotely</p>
            </div>
            {lastKey && (
              <Badge variant="secondary" className="bg-neon-green/10 text-neon-green animate-pulse">
                <Check className="h-3 w-3 mr-1" />
                {lastKey}
              </Badge>
            )}
          </div>

          {/* Media Controls Bar */}
          <Card className="glass-dark border-border/50">
            <CardContent className="p-3">
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <Button variant="secondary" size="sm" onClick={() => handleMediaControl("previous")}>
                  <SkipBack className="h-4 w-4" />
                </Button>
                <Button variant="secondary" size="sm" onClick={() => handleMediaControl("play_pause")}>
                  <Play className="h-4 w-4" />
                </Button>
                <Button variant="secondary" size="sm" onClick={() => handleMediaControl("next")}>
                  <SkipForward className="h-4 w-4" />
                </Button>
                <div className="w-px h-6 bg-border mx-2" />
                <Button variant="secondary" size="sm" onClick={() => handleMediaControl("volume_down")}>
                  <Volume2 className="h-4 w-4" />
                  <ArrowDown className="h-3 w-3" />
                </Button>
                <Button variant="secondary" size="sm" onClick={() => handleMediaControl("mute")}>
                  <Volume2 className="h-4 w-4" />
                </Button>
                <Button variant="secondary" size="sm" onClick={() => handleMediaControl("volume_up")}>
                  <Volume2 className="h-4 w-4" />
                  <ArrowUp className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="keyboard" className="w-full">
            <TabsList className="grid w-full grid-cols-4 mb-4">
              <TabsTrigger value="keyboard" className="text-xs md:text-sm">
                <Keyboard className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Keyboard</span>
              </TabsTrigger>
              <TabsTrigger value="trackpad" className="text-xs md:text-sm">
                <Mouse className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Trackpad</span>
              </TabsTrigger>
              <TabsTrigger value="clipboard" className="text-xs md:text-sm">
                <Clipboard className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Clipboard</span>
              </TabsTrigger>
              <TabsTrigger value="screen" className="text-xs md:text-sm">
                <Monitor className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Screen</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="keyboard">
              <Card className="glass-dark border-border/50">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">Virtual Keyboard</CardTitle>
                      <CardDescription className="text-sm">
                        Type or use your physical keyboard
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor="raw-mode" className="text-sm">Raw Keys</Label>
                      <Switch 
                        id="raw-mode" 
                        checked={rawKeyMode} 
                        onCheckedChange={setRawKeyMode}
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Textarea 
                      placeholder="Type here to send to PC..." 
                      value={textInput} 
                      onChange={(e) => setTextInput(e.target.value)} 
                      className="min-h-[80px] text-sm"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && e.ctrlKey) {
                          e.preventDefault();
                          sendKeyboard();
                        }
                      }}
                    />
                  </div>
                  <Button 
                    className="w-full gradient-primary" 
                    onClick={sendKeyboard} 
                    disabled={!textInput || isSending}
                  >
                    {isSending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    Send Text (Ctrl+Enter)
                  </Button>
                  
                  <div className="border-t border-border/30 pt-4">
                    <p className="text-sm text-muted-foreground mb-3">Quick Keys</p>
                    <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
                      {quickKeys.map((k) => (
                        <Button 
                          key={k.key} 
                          variant="secondary" 
                          size="sm" 
                          className={cn(
                            "text-xs transition-all",
                            lastKey === k.label && "bg-neon-green/20 border-neon-green"
                          )}
                          onClick={() => sendKey(k.key)}
                        >
                          {k.label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* Arrow keys for text navigation */}
                  <div className="border-t border-border/30 pt-4">
                    <p className="text-sm text-muted-foreground mb-3">Navigation</p>
                    <div className="flex justify-center">
                      <div className="grid grid-cols-3 gap-1">
                        <div />
                        <Button variant="secondary" size="sm" onClick={() => sendKey("up")}>
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <div />
                        <Button variant="secondary" size="sm" onClick={() => sendKey("left")}>
                          <ArrowLeft className="h-4 w-4" />
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => sendKey("down")}>
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => sendKey("right")}>
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="trackpad">
              <Card className="glass-dark border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Virtual Trackpad</CardTitle>
                  <CardDescription className="text-sm">Drag to move mouse, tap to click</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div 
                    ref={trackpadRef}
                    className="aspect-video bg-secondary/30 rounded-xl border-2 border-dashed border-border cursor-crosshair touch-none select-none flex items-center justify-center min-h-[200px]"
                    onMouseDown={handleTrackpadStart}
                    onMouseMove={handleTrackpadMove}
                    onTouchStart={handleTrackpadStart}
                    onTouchMove={handleTrackpadMove}
                  >
                    <p className="text-muted-foreground text-sm pointer-events-none">
                      Drag here to move mouse
                    </p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    {/* Arrow keys for cursor */}
                    <div className="flex flex-col items-center gap-2">
                      <p className="text-xs text-muted-foreground mb-1">Move Cursor</p>
                      <div className="grid grid-cols-3 gap-1">
                        <div />
                        <Button variant="secondary" size="sm" onClick={() => handleArrowMove("up")}>
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <div />
                        <Button variant="secondary" size="sm" onClick={() => handleArrowMove("left")}>
                          <ArrowLeft className="h-4 w-4" />
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => handleMouseClick("left")}>
                          •
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => handleArrowMove("right")}>
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                        <div />
                        <Button variant="secondary" size="sm" onClick={() => handleArrowMove("down")}>
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <div />
                      </div>
                    </div>

                    {/* Click buttons */}
                    <div className="flex flex-col items-center gap-2">
                      <p className="text-xs text-muted-foreground mb-1">Click Actions</p>
                      <div className="grid grid-cols-2 gap-2 w-full">
                        <Button variant="secondary" size="sm" onClick={() => handleMouseClick("left")}>
                          Left
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => handleMouseClick("right")}>
                          Right
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => handleMouseClick("left", 2)}>
                          Double
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => handleMouseClick("middle")}>
                          Middle
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => handleMouseScroll("up")}>
                          Scroll ↑
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => handleMouseScroll("down")}>
                          Scroll ↓
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="clipboard">
              <Card className="glass-dark border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Clipboard Sync</CardTitle>
                  <CardDescription className="text-sm">Share clipboard between devices</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Textarea 
                    placeholder="Paste text here to send to PC..." 
                    value={clipboardText} 
                    onChange={(e) => setClipboardText(e.target.value)} 
                    className="min-h-[120px] text-sm"
                  />
                  <div className="flex gap-2">
                    <Button 
                      className="flex-1 gradient-primary" 
                      onClick={sendClipboardToPC}
                      disabled={!clipboardText}
                    >
                      <Send className="h-4 w-4 mr-2" />
                      Send to PC
                    </Button>
                    <Button variant="secondary" className="flex-1" onClick={getClipboardFromPC}>
                      <Copy className="h-4 w-4 mr-2" />
                      Get from PC
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="screen">
              <Card className="glass-dark border-border/50">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">Screen Mirror</CardTitle>
                      <CardDescription className="text-sm">View your PC screen in real-time</CardDescription>
                    </div>
                    {isStreaming && (
                      <Badge className={cn(
                        "animate-pulse",
                        streamStatus === "active" ? "bg-neon-green/20 text-neon-green" : "bg-neon-orange/20 text-neon-orange"
                      )}>
                        <span className="w-2 h-2 rounded-full bg-current mr-2" />
                        {streamStatus === "starting" ? "Starting..." : 
                         streamStatus === "stopping" ? "Stopping..." : 
                         `LIVE • ${streamFps} FPS`}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="aspect-video bg-secondary/30 rounded-xl border border-border flex items-center justify-center overflow-hidden relative">
                    {screenshot ? (
                      <>
                        <img 
                          src={`data:image/jpeg;base64,${screenshot}`} 
                          alt="Screenshot" 
                          className="w-full h-full object-contain" 
                        />
                        {isStreaming && lastFrameTime > 0 && (
                          <div className="absolute bottom-2 right-2 text-xs bg-background/80 px-2 py-1 rounded">
                            Last frame: {Math.round((Date.now() - lastFrameTime) / 1000)}s ago
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-center p-4">
                        <Monitor className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <p className="text-muted-foreground text-sm">
                          {streamStatus === "starting" ? "Starting stream..." : "Click to take screenshot or start streaming"}
                        </p>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-4 flex-wrap">
                    <Button 
                      onClick={takeScreenshot}
                      disabled={isLoadingScreenshot || isStreaming}
                      variant="secondary"
                    >
                      {isLoadingScreenshot ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-2" />
                      )}
                      Screenshot
                    </Button>
                    
                    <Button 
                      onClick={toggleStreaming}
                      disabled={streamStatus === "starting" || streamStatus === "stopping"}
                      className={isStreaming ? "bg-destructive hover:bg-destructive/90" : "gradient-primary"}
                    >
                      {streamStatus === "starting" ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Starting...
                        </>
                      ) : streamStatus === "stopping" ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Stopping...
                        </>
                      ) : isStreaming ? (
                        <>
                          <Pause className="h-4 w-4 mr-2" />
                          Stop Stream
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4 mr-2" />
                          Start Stream
                        </>
                      )}
                    </Button>
                    
                    <div className="flex items-center gap-2">
                      <Label className="text-sm">FPS:</Label>
                      <Slider
                        value={[streamFps]}
                        onValueChange={([v]) => setStreamFps(v)}
                        min={1}
                        max={10}
                        step={1}
                        className="w-24"
                        disabled={isStreaming}
                      />
                      <span className="text-sm w-6">{streamFps}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </DashboardLayout>
  );
}
