import { useState, useRef, useEffect, useCallback } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { 
  Keyboard, Mouse, Clipboard, Monitor, Send, Copy, 
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  Loader2, Check, RefreshCw
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";

export default function RemoteControl() {
  const [textInput, setTextInput] = useState("");
  const [clipboardText, setClipboardText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [isLoadingScreenshot, setIsLoadingScreenshot] = useState(false);
  const trackpadRef = useRef<HTMLDivElement>(null);
  const lastPosition = useRef({ x: 0, y: 0 });
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();

  // Handle physical keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only capture when textarea is not focused
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;
      
      e.preventDefault();
      
      const key = e.key;
      const keys: string[] = [];
      
      if (e.ctrlKey) keys.push("ctrl");
      if (e.altKey) keys.push("alt");
      if (e.shiftKey && keys.length > 0) keys.push("shift");
      if (e.metaKey) keys.push("win");
      
      if (keys.length > 0 && key !== "Control" && key !== "Alt" && key !== "Shift" && key !== "Meta") {
        keys.push(key.toLowerCase());
        sendCommand("key_combo", { keys });
        setLastKey(keys.join("+"));
      } else if (key.length === 1) {
        sendCommand("type_text", { text: key });
        setLastKey(key);
      } else {
        sendCommand("press_key", { key: key.toLowerCase() });
        setLastKey(key);
      }
      
      setTimeout(() => setLastKey(null), 500);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sendCommand]);

  const sendKeyboard = async () => {
    if (!textInput.trim()) return;
    setIsSending(true);
    await sendCommand("type_text", { text: textInput });
    toast({ title: "Text Sent", description: `Typed: ${textInput.slice(0, 30)}${textInput.length > 30 ? "..." : ""}` });
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
    
    setTimeout(() => setLastKey(null), 300);
  };

  const quickKeys = [
    { label: "Enter", key: "enter" },
    { label: "Esc", key: "escape" },
    { label: "Tab", key: "tab" },
    { label: "Space", key: "space" },
    { label: "Backspace", key: "backspace" },
    { label: "Delete", key: "delete" },
    { label: "Ctrl+C", key: "ctrl+c" },
    { label: "Ctrl+V", key: "ctrl+v" },
    { label: "Ctrl+Z", key: "ctrl+z" },
    { label: "Alt+Tab", key: "alt+tab" },
    { label: "Win", key: "win" },
    { label: "Ctrl+A", key: "ctrl+a" },
    { label: "F5", key: "f5" },
    { label: "F11", key: "f11" },
    { label: "Home", key: "home" },
    { label: "End", key: "end" },
  ];

  // Trackpad handling
  const handleTrackpadStart = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const point = "touches" in e ? e.touches[0] : e;
    lastPosition.current = { x: point.clientX, y: point.clientY };
  }, []);

  const handleTrackpadMove = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (!("buttons" in e) || e.buttons !== 1) {
      if (!("touches" in e)) return;
    }
    
    const point = "touches" in e ? e.touches[0] : e;
    const deltaX = (point.clientX - lastPosition.current.x) * 2;
    const deltaY = (point.clientY - lastPosition.current.y) * 2;
    
    lastPosition.current = { x: point.clientX, y: point.clientY };
    
    if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
      sendCommand("mouse_move", { x: Math.round(deltaX), y: Math.round(deltaY), relative: true });
    }
  }, [sendCommand]);

  const handleMouseClick = async (button: string = "left", clicks: number = 1) => {
    await sendCommand("mouse_click", { button, clicks });
    toast({ title: "Click", description: `${button} click` });
  };

  const handleMouseScroll = async (direction: "up" | "down") => {
    await sendCommand("mouse_scroll", { amount: direction === "up" ? 3 : -3 });
  };

  const handleArrowMove = async (direction: "up" | "down" | "left" | "right") => {
    const moves: Record<string, { x: number; y: number }> = {
      up: { x: 0, y: -20 },
      down: { x: 0, y: 20 },
      left: { x: -20, y: 0 },
      right: { x: 20, y: 0 },
    };
    await sendCommand("mouse_move", { ...moves[direction], relative: true });
  };

  // Clipboard
  const sendClipboardToPC = async () => {
    if (!clipboardText.trim()) return;
    await sendCommand("set_clipboard", { content: clipboardText });
    toast({ title: "Clipboard Sent", description: "Text copied to PC clipboard" });
  };

  const getClipboardFromPC = async () => {
    const result = await sendCommand("get_clipboard", {});
    if (result.success) {
      toast({ title: "Getting Clipboard", description: "Fetching from PC..." });
    }
  };

  // Screenshot
  const takeScreenshot = async () => {
    setIsLoadingScreenshot(true);
    const result = await sendCommand("screenshot", {});
    if (result.success) {
      toast({ title: "Screenshot Requested", description: "Check back in a few seconds" });
    }
    setIsLoadingScreenshot(false);
  };

  return (
    <DashboardLayout>
      <ScrollArea className="h-[calc(100vh-6rem)]">
        <div className="space-y-6 animate-fade-in pr-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold neon-text">Remote Control</h1>
              <p className="text-muted-foreground text-sm md:text-base">Control your PC remotely</p>
            </div>
            {lastKey && (
              <Badge variant="secondary" className="bg-neon-green/10 text-neon-green animate-pulse">
                <Check className="h-3 w-3 mr-1" />
                {lastKey}
              </Badge>
            )}
          </div>

          <Tabs defaultValue="keyboard" className="w-full">
            <TabsList className="grid w-full grid-cols-4 mb-4 md:mb-6">
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
                  <CardTitle className="text-lg md:text-xl">Virtual Keyboard</CardTitle>
                  <CardDescription className="text-sm">
                    Type here or use your physical keyboard (when not in text field)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Textarea 
                      placeholder="Type here to send to PC..." 
                      value={textInput} 
                      onChange={(e) => setTextInput(e.target.value)} 
                      className="min-h-[80px] md:min-h-[100px] text-sm md:text-base"
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
                            "text-xs md:text-sm transition-all",
                            lastKey === k.label && "bg-neon-green/20 border-neon-green"
                          )}
                          onClick={() => sendKey(k.key)}
                        >
                          {k.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="trackpad">
              <Card className="glass-dark border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg md:text-xl">Virtual Trackpad</CardTitle>
                  <CardDescription className="text-sm">Drag to move mouse, tap buttons to click</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div 
                    ref={trackpadRef}
                    className="aspect-video bg-secondary/30 rounded-xl border-2 border-dashed border-border cursor-crosshair touch-none select-none flex items-center justify-center"
                    onMouseDown={handleTrackpadStart}
                    onMouseMove={handleTrackpadMove}
                    onTouchStart={handleTrackpadStart}
                    onTouchMove={handleTrackpadMove}
                  >
                    <p className="text-muted-foreground text-sm md:text-base pointer-events-none">
                      Drag here to move mouse
                    </p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    {/* Arrow keys */}
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
                          Click
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
                        <Button variant="secondary" onClick={() => handleMouseClick("left")}>
                          Left Click
                        </Button>
                        <Button variant="secondary" onClick={() => handleMouseClick("right")}>
                          Right Click
                        </Button>
                        <Button variant="secondary" onClick={() => handleMouseClick("left", 2)}>
                          Double Click
                        </Button>
                        <Button variant="secondary" onClick={() => handleMouseClick("middle")}>
                          Middle Click
                        </Button>
                        <Button variant="secondary" onClick={() => handleMouseScroll("up")}>
                          Scroll Up
                        </Button>
                        <Button variant="secondary" onClick={() => handleMouseScroll("down")}>
                          Scroll Down
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
                  <CardTitle className="text-lg md:text-xl">Clipboard Sync</CardTitle>
                  <CardDescription className="text-sm">Share clipboard between devices</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Textarea 
                    placeholder="Paste text here to send to PC..." 
                    value={clipboardText} 
                    onChange={(e) => setClipboardText(e.target.value)} 
                    className="min-h-[120px] md:min-h-[150px] text-sm md:text-base"
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
                  <CardTitle className="text-lg md:text-xl">Screen View</CardTitle>
                  <CardDescription className="text-sm">View your PC screen</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="aspect-video bg-secondary/30 rounded-xl border border-border flex items-center justify-center overflow-hidden">
                    {screenshot ? (
                      <img src={`data:image/jpeg;base64,${screenshot}`} alt="Screenshot" className="w-full h-full object-contain" />
                    ) : (
                      <div className="text-center p-4">
                        <Monitor className="h-12 w-12 md:h-16 md:w-16 text-muted-foreground mx-auto mb-4" />
                        <p className="text-muted-foreground text-sm md:text-base">Click to take screenshot</p>
                        <Button 
                          className="mt-4 gradient-primary" 
                          onClick={takeScreenshot}
                          disabled={isLoadingScreenshot}
                        >
                          {isLoadingScreenshot ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4 mr-2" />
                          )}
                          Take Screenshot
                        </Button>
                      </div>
                    )}
                  </div>
                  {screenshot && (
                    <Button 
                      className="w-full mt-4" 
                      variant="secondary"
                      onClick={takeScreenshot}
                      disabled={isLoadingScreenshot}
                    >
                      <RefreshCw className={cn("h-4 w-4 mr-2", isLoadingScreenshot && "animate-spin")} />
                      Refresh Screenshot
                    </Button>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </DashboardLayout>
  );
}
