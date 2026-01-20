import { useState, useRef, useEffect, useCallback } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Smartphone,
  Laptop,
  Bluetooth,
  Headphones,
  Bell,
  BellRing,
  Clipboard,
  ClipboardCopy,
  ClipboardPaste,
  Monitor,
  Camera,
  Mic,
  Battery,
  Wifi,
  Signal,
  Settings,
  RefreshCw,
  Check,
  X,
  ArrowLeftRight,
  Share2,
  Link,
  Unlink,
  MessageSquare,
  Phone,
  PhoneCall,
  Image,
  FolderOpen,
  Cast,
  Airplay,
  Volume2,
  Play,
  Pause,
  SkipForward,
  Loader2,
  Zap,
  Move,
  Maximize,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { addLog } from "@/components/IssueLog";

interface MobileInfo {
  battery: number;
  isCharging: boolean;
  wifiSignal: number;
  cellSignal: number;
  notifications: NotificationItem[];
  runningApps: string[];
  storageUsed: number;
  storageTotal: number;
  ramUsed: number;
  ramTotal: number;
}

interface NotificationItem {
  id: string;
  app: string;
  title: string;
  body: string;
  time: string;
  icon?: string;
}

interface BudsInfo {
  connected: boolean;
  name: string;
  leftBattery: number;
  rightBattery: number;
  caseBattery: number;
  currentDevice: "phone" | "laptop";
}

export default function Samsung() {
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();

  // Samsung Buds State
  const [budsInfo, setBudsInfo] = useState<BudsInfo>({
    connected: true,
    name: "Galaxy Buds Pro",
    leftBattery: 85,
    rightBattery: 78,
    caseBattery: 92,
    currentDevice: "laptop",
  });
  const [switchingBuds, setSwitchingBuds] = useState(false);

  // Mobile Info State
  const [mobileInfo, setMobileInfo] = useState<MobileInfo>({
    battery: 72,
    isCharging: true,
    wifiSignal: 85,
    cellSignal: 65,
    notifications: [
      { id: "1", app: "WhatsApp", title: "John Doe", body: "Hey, are you coming today?", time: "2m ago" },
      { id: "2", app: "Gmail", title: "New Email", body: "Meeting reminder for tomorrow", time: "5m ago" },
      { id: "3", app: "Instagram", title: "New follower", body: "Someone followed you", time: "15m ago" },
    ],
    runningApps: ["WhatsApp", "Chrome", "Settings", "Camera", "Spotify"],
    storageUsed: 85.4,
    storageTotal: 128,
    ramUsed: 5.2,
    ramTotal: 8,
  });

  // Clipboard Sync State
  const [clipboardSyncEnabled, setClipboardSyncEnabled] = useState(true);
  const [pcClipboard, setPcClipboard] = useState("");
  const [phoneClipboard, setPhoneClipboard] = useState("");
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Notification Sync State
  const [notificationSyncEnabled, setNotificationSyncEnabled] = useState(true);
  const [notificationMirror, setNotificationMirror] = useState(true);

  // Screen Share State
  const [screenShareActive, setScreenShareActive] = useState(false);
  const [screenShareDirection, setScreenShareDirection] = useState<"phone_to_pc" | "pc_to_phone">("pc_to_phone");
  const [screenShareQuality, setScreenShareQuality] = useState<"720p" | "1080p" | "4k">("1080p");
  const [screenShareFps, setScreenShareFps] = useState(60);
  const [screenFrame, setScreenFrame] = useState<string | null>(null);
  const screenShareWsRef = useRef<WebSocket | null>(null);
  const [screenShareSessionId, setScreenShareSessionId] = useState<string | null>(null);

  // Phone as Webcam State
  const [phoneWebcamActive, setPhoneWebcamActive] = useState(false);
  const [webcamQuality, setWebcamQuality] = useState<"720p" | "1080p">("1080p");
  const [webcamFps, setWebcamFps] = useState(30);
  const phoneWebcamRef = useRef<HTMLVideoElement>(null);
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  
  // Derive WS URL
  const projectRef = (import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined) ?? "";
  const CAMERA_WS_URL = `wss://${projectRef}.functions.supabase.co/functions/v1/camera-relay`;

  // Call Handling
  const [activeCall, setActiveCall] = useState<{ number: string; name: string; duration: number } | null>(null);

  // Refresh mobile info
  const refreshMobileInfo = useCallback(async () => {
    addLog("info", "web", "Fetching mobile info...");
    const result = await sendCommand("get_mobile_info", {}, { awaitResult: true, timeoutMs: 10000 });
    if (result.success && "result" in result && result.result) {
      const info = result.result as Partial<MobileInfo>;
      setMobileInfo((prev) => ({ ...prev, ...info }));
      addLog("info", "agent", "Mobile info updated");
    }
  }, [sendCommand]);

  // Switch buds between devices
  const switchBudsDevice = useCallback(async () => {
    setSwitchingBuds(true);
    addLog("info", "web", `Switching buds to ${budsInfo.currentDevice === "laptop" ? "phone" : "laptop"}`);
    
    const result = await sendCommand("switch_buds", {
      target: budsInfo.currentDevice === "laptop" ? "phone" : "laptop",
    }, { awaitResult: true, timeoutMs: 10000 });

    if (result.success) {
      setBudsInfo((prev) => ({
        ...prev,
        currentDevice: prev.currentDevice === "laptop" ? "phone" : "laptop",
      }));
      toast({ title: "Buds Switched", description: `Now connected to ${budsInfo.currentDevice === "laptop" ? "Phone" : "Laptop"}` });
      addLog("info", "agent", "Buds switched successfully");
    } else {
      toast({ title: "Switch Failed", variant: "destructive" });
      addLog("error", "agent", "Failed to switch buds");
    }
    setSwitchingBuds(false);
  }, [budsInfo.currentDevice, sendCommand, toast]);

  // Clipboard sync functions
  const syncClipboard = useCallback(async (direction: "to_pc" | "to_phone" | "bidirectional") => {
    setIsSyncing(true);
    addLog("info", "web", `Syncing clipboard: ${direction}`);

    if (direction === "to_pc" || direction === "bidirectional") {
      // Send phone clipboard to PC
      await sendCommand("set_clipboard", { content: phoneClipboard });
    }

    if (direction === "to_phone" || direction === "bidirectional") {
      // Get PC clipboard and store for phone
      const result = await sendCommand("get_clipboard", {}, { awaitResult: true, timeoutMs: 5000 });
      if (result.success && "result" in result && result.result?.content) {
        setPcClipboard(result.result.content as string);
      }
    }

    setLastSyncTime(new Date());
    setIsSyncing(false);
    toast({ title: "Clipboard Synced" });
    addLog("info", "agent", "Clipboard sync completed");
  }, [phoneClipboard, sendCommand, toast]);

  // Copy from PC clipboard to phone
  const copyFromPC = useCallback(async () => {
    const result = await sendCommand("get_clipboard", {}, { awaitResult: true, timeoutMs: 5000 });
    if (result.success && "result" in result && result.result?.content) {
      const content = result.result.content as string;
      setPhoneClipboard(content);
      await navigator.clipboard.writeText(content);
      toast({ title: "Copied from PC", description: content.slice(0, 50) + "..." });
      addLog("info", "web", "Copied from PC clipboard");
    }
  }, [sendCommand, toast]);

  // Paste to PC clipboard from phone
  const pasteToPC = useCallback(async () => {
    const content = await navigator.clipboard.readText();
    setPhoneClipboard(content);
    await sendCommand("set_clipboard", { content });
    toast({ title: "Pasted to PC", description: content.slice(0, 50) + "..." });
    addLog("info", "web", "Pasted to PC clipboard");
  }, [sendCommand, toast]);

  // Handle notification actions
  const dismissNotification = useCallback((id: string) => {
    setMobileInfo((prev) => ({
      ...prev,
      notifications: prev.notifications.filter((n) => n.id !== id),
    }));
    sendCommand("dismiss_notification", { notification_id: id });
    addLog("info", "web", `Dismissed notification: ${id}`);
  }, [sendCommand]);

  const replyToNotification = useCallback(async (id: string, reply: string) => {
    await sendCommand("reply_notification", { notification_id: id, reply });
    toast({ title: "Reply Sent" });
    addLog("info", "web", `Replied to notification: ${id}`);
  }, [sendCommand, toast]);

  // Screen share functions - now with WebSocket for real streaming
  const startScreenShare = useCallback(async () => {
    addLog("info", "web", `Starting screen share: ${screenShareDirection}, ${screenShareQuality}, ${screenShareFps}fps`);
    
    const sessionId = crypto.randomUUID();
    setScreenShareSessionId(sessionId);
    
    // Tell PC to start streaming
    const result = await sendCommand("start_screen_share", {
      direction: screenShareDirection,
      quality: screenShareQuality,
      fps: screenShareFps,
      session_id: sessionId,
    }, { awaitResult: true, timeoutMs: 15000 });

    if (result.success) {
      // Connect WebSocket to receive frames
      const ws = new WebSocket(`${CAMERA_WS_URL}?sessionId=${sessionId}&type=phone&fps=${screenShareFps}&quality=80&streamType=screen`);
      screenShareWsRef.current = ws;
      ws.binaryType = "arraybuffer";
      
      ws.onopen = () => {
        setScreenShareActive(true);
        toast({ title: "Screen Share Started", description: `Streaming at ${screenShareFps} FPS` });
        addLog("info", "web", "Screen share WebSocket connected");
      };
      
      ws.onmessage = (event) => {
        try {
          // Handle binary JPEG frames
          if (event.data instanceof ArrayBuffer) {
            const blob = new Blob([event.data], { type: "image/jpeg" });
            const url = URL.createObjectURL(blob);
            setScreenFrame((prev) => {
              if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
              return url;
            });
            return;
          }
          
          const data = JSON.parse(event.data);
          if ((data.type === "screen_frame" || data.type === "camera_frame") && data.data) {
            setScreenFrame(`data:image/jpeg;base64,${data.data}`);
          }
        } catch {
          // ignore
        }
      };
      
      ws.onclose = () => {
        setScreenShareActive(false);
        setScreenFrame(null);
        addLog("info", "web", "Screen share WebSocket closed");
      };
      
      ws.onerror = () => {
        toast({ title: "Screen Share Error", variant: "destructive" });
      };
    } else {
      toast({ title: "Screen Share Failed", variant: "destructive" });
      addLog("error", "agent", "Failed to start screen share");
    }
  }, [screenShareDirection, screenShareQuality, screenShareFps, sendCommand, toast, CAMERA_WS_URL]);

  const stopScreenShare = useCallback(async () => {
    if (screenShareWsRef.current) {
      screenShareWsRef.current.close();
      screenShareWsRef.current = null;
    }
    await sendCommand("stop_screen_share", {});
    setScreenShareActive(false);
    setScreenFrame(null);
    setScreenShareSessionId(null);
    toast({ title: "Screen Share Stopped" });
    addLog("info", "web", "Screen share stopped");
  }, [sendCommand, toast]);

  // Phone as webcam functions
  const startPhoneWebcam = useCallback(async () => {
    try {
      addLog("info", "web", "Starting phone as webcam");
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: webcamQuality === "1080p" ? 1920 : 1280 },
          height: { ideal: webcamQuality === "1080p" ? 1080 : 720 },
          frameRate: { ideal: webcamFps },
        },
        audio: true,
      });

      setWebcamStream(stream);
      if (phoneWebcamRef.current) {
        phoneWebcamRef.current.srcObject = stream;
      }

      // Start relaying to PC
      await sendCommand("start_phone_webcam", {
        quality: webcamQuality,
        fps: webcamFps,
      }, { awaitResult: true, timeoutMs: 10000 });

      setPhoneWebcamActive(true);
      toast({ title: "Phone Webcam Active", description: "Your phone is now a webcam for your PC" });
      addLog("info", "agent", "Phone webcam started");
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      addLog("error", "web", `Phone webcam error: ${errMsg}`);
      toast({ title: "Webcam Error", description: errMsg, variant: "destructive" });
    }
  }, [webcamQuality, webcamFps, sendCommand, toast]);

  const stopPhoneWebcam = useCallback(async () => {
    if (webcamStream) {
      webcamStream.getTracks().forEach((track) => track.stop());
      setWebcamStream(null);
    }
    if (phoneWebcamRef.current) {
      phoneWebcamRef.current.srcObject = null;
    }
    await sendCommand("stop_phone_webcam", {});
    setPhoneWebcamActive(false);
    toast({ title: "Phone Webcam Stopped" });
    addLog("info", "web", "Phone webcam stopped");
  }, [webcamStream, sendCommand, toast]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (webcamStream) {
        webcamStream.getTracks().forEach((track) => track.stop());
      }
      if (screenShareWsRef.current) {
        screenShareWsRef.current.close();
      }
    };
  }, [webcamStream]);

  return (
    <DashboardLayout>
      <ScrollArea className="h-[calc(100vh-2rem)]">
        <div className="space-y-4 animate-fade-in pr-4 pt-12 md:pt-0">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold neon-text">Samsung Link</h1>
              <p className="text-muted-foreground text-sm">Seamless phone-laptop integration</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={cn(
                "border-neon-green text-neon-green",
                selectedDevice?.is_online && "bg-neon-green/10"
              )}>
                <Laptop className="h-3 w-3 mr-1" />
                {selectedDevice?.name || "Laptop"}
              </Badge>
              <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
              <Badge variant="outline" className="border-neon-cyan text-neon-cyan bg-neon-cyan/10">
                <Smartphone className="h-3 w-3 mr-1" />
                Galaxy S24
              </Badge>
            </div>
          </div>

          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-5 mb-4">
              <TabsTrigger value="overview" className="text-xs">
                <Smartphone className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Overview</span>
              </TabsTrigger>
              <TabsTrigger value="buds" className="text-xs">
                <Headphones className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Buds</span>
              </TabsTrigger>
              <TabsTrigger value="clipboard" className="text-xs">
                <Clipboard className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Clipboard</span>
              </TabsTrigger>
              <TabsTrigger value="notifications" className="text-xs">
                <Bell className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Notifications</span>
              </TabsTrigger>
              <TabsTrigger value="screen" className="text-xs">
                <Cast className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Screen</span>
              </TabsTrigger>
            </TabsList>

            {/* OVERVIEW TAB */}
            <TabsContent value="overview">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Phone Status Card */}
                <Card className="glass-dark border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Smartphone className="h-5 w-5 text-neon-cyan" />
                      Phone Status
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Battery */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2">
                          <Battery className={cn("h-4 w-4", mobileInfo.isCharging && "text-neon-green")} />
                          Battery
                        </span>
                        <span className={cn(
                          mobileInfo.battery < 20 ? "text-destructive" :
                          mobileInfo.battery < 50 ? "text-neon-orange" : "text-neon-green"
                        )}>
                          {mobileInfo.battery}% {mobileInfo.isCharging && "⚡"}
                        </span>
                      </div>
                      <Progress value={mobileInfo.battery} className="h-2" />
                    </div>

                    {/* Signal Strengths */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2">
                            <Wifi className="h-4 w-4" />
                            WiFi
                          </span>
                          <span>{mobileInfo.wifiSignal}%</span>
                        </div>
                        <Progress value={mobileInfo.wifiSignal} className="h-1" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2">
                            <Signal className="h-4 w-4" />
                            Cellular
                          </span>
                          <span>{mobileInfo.cellSignal}%</span>
                        </div>
                        <Progress value={mobileInfo.cellSignal} className="h-1" />
                      </div>
                    </div>

                    {/* Storage & RAM */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span>Storage</span>
                        <span>{mobileInfo.storageUsed.toFixed(1)} / {mobileInfo.storageTotal} GB</span>
                      </div>
                      <Progress value={(mobileInfo.storageUsed / mobileInfo.storageTotal) * 100} className="h-1" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span>RAM</span>
                        <span>{mobileInfo.ramUsed.toFixed(1)} / {mobileInfo.ramTotal} GB</span>
                      </div>
                      <Progress value={(mobileInfo.ramUsed / mobileInfo.ramTotal) * 100} className="h-1" />
                    </div>

                    <Button variant="outline" size="sm" className="w-full" onClick={refreshMobileInfo}>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Refresh
                    </Button>
                  </CardContent>
                </Card>

                {/* Running Apps Card */}
                <Card className="glass-dark border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <FolderOpen className="h-5 w-5 text-neon-purple" />
                      Running Apps
                    </CardTitle>
                    <CardDescription>Apps currently open on phone</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {mobileInfo.runningApps.map((app) => (
                        <Badge key={app} variant="secondary" className="cursor-pointer hover:bg-secondary/80">
                          {app}
                          <X className="h-3 w-3 ml-1 hover:text-destructive" />
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Quick Actions */}
                <Card className="glass-dark border-border/50 md:col-span-2">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Quick Actions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <Button variant="outline" className="h-20 flex-col gap-2" onClick={() => sendCommand("ring_phone", {})}>
                        <Phone className="h-6 w-6 text-neon-green" />
                        <span className="text-xs">Ring Phone</span>
                      </Button>
                      <Button variant="outline" className="h-20 flex-col gap-2" onClick={copyFromPC}>
                        <ClipboardCopy className="h-6 w-6 text-neon-blue" />
                        <span className="text-xs">Copy from PC</span>
                      </Button>
                      <Button variant="outline" className="h-20 flex-col gap-2" onClick={pasteToPC}>
                        <ClipboardPaste className="h-6 w-6 text-neon-purple" />
                        <span className="text-xs">Paste to PC</span>
                      </Button>
                      <Button variant="outline" className="h-20 flex-col gap-2" onClick={() => sendCommand("open_phone_gallery", {})}>
                        <Image className="h-6 w-6 text-neon-pink" />
                        <span className="text-xs">Phone Gallery</span>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* BUDS TAB */}
            <TabsContent value="buds">
              <Card className="glass-dark border-border/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Headphones className="h-5 w-5 text-neon-purple" />
                    Samsung Galaxy Buds
                  </CardTitle>
                  <CardDescription>Seamless audio switching between devices</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Connection Status */}
                  <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/30">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-3 h-3 rounded-full",
                        budsInfo.connected ? "bg-neon-green animate-pulse" : "bg-destructive"
                      )} />
                      <div>
                        <p className="font-medium">{budsInfo.name}</p>
                        <p className="text-sm text-muted-foreground">
                          Connected to {budsInfo.currentDevice === "laptop" ? "Laptop" : "Phone"}
                        </p>
                      </div>
                    </div>
                    <Button
                      onClick={switchBudsDevice}
                      disabled={switchingBuds}
                      className="gradient-primary"
                    >
                      {switchingBuds ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <ArrowLeftRight className="h-4 w-4 mr-2" />
                      )}
                      Switch to {budsInfo.currentDevice === "laptop" ? "Phone" : "Laptop"}
                    </Button>
                  </div>

                  {/* Battery Levels */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-4 rounded-lg bg-secondary/20">
                      <p className="text-sm text-muted-foreground mb-2">Left Bud</p>
                      <p className="text-2xl font-bold text-neon-cyan">{budsInfo.leftBattery}%</p>
                      <Progress value={budsInfo.leftBattery} className="h-1 mt-2" />
                    </div>
                    <div className="text-center p-4 rounded-lg bg-secondary/20">
                      <p className="text-sm text-muted-foreground mb-2">Case</p>
                      <p className="text-2xl font-bold text-neon-green">{budsInfo.caseBattery}%</p>
                      <Progress value={budsInfo.caseBattery} className="h-1 mt-2" />
                    </div>
                    <div className="text-center p-4 rounded-lg bg-secondary/20">
                      <p className="text-sm text-muted-foreground mb-2">Right Bud</p>
                      <p className="text-2xl font-bold text-neon-cyan">{budsInfo.rightBattery}%</p>
                      <Progress value={budsInfo.rightBattery} className="h-1 mt-2" />
                    </div>
                  </div>

                  {/* Visual Device Diagram */}
                  <div className="flex items-center justify-center gap-8 py-6">
                    <div className={cn(
                      "flex flex-col items-center p-4 rounded-xl transition-all",
                      budsInfo.currentDevice === "phone" ? "bg-neon-cyan/20 ring-2 ring-neon-cyan" : "bg-secondary/20"
                    )}>
                      <Smartphone className="h-12 w-12 mb-2" />
                      <span className="text-sm">Phone</span>
                    </div>
                    <div className="flex flex-col items-center">
                      <Headphones className="h-16 w-16 text-neon-purple" />
                      <div className="flex gap-2 mt-2">
                        <div className={cn(
                          "w-2 h-2 rounded-full transition-all",
                          budsInfo.currentDevice === "phone" ? "bg-neon-cyan" : "bg-muted"
                        )} />
                        <div className={cn(
                          "w-2 h-2 rounded-full transition-all",
                          budsInfo.currentDevice === "laptop" ? "bg-neon-blue" : "bg-muted"
                        )} />
                      </div>
                    </div>
                    <div className={cn(
                      "flex flex-col items-center p-4 rounded-xl transition-all",
                      budsInfo.currentDevice === "laptop" ? "bg-neon-blue/20 ring-2 ring-neon-blue" : "bg-secondary/20"
                    )}>
                      <Laptop className="h-12 w-12 mb-2" />
                      <span className="text-sm">Laptop</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* CLIPBOARD TAB */}
            <TabsContent value="clipboard">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="glass-dark border-border/50">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Laptop className="h-5 w-5 text-neon-blue" />
                        PC Clipboard
                      </CardTitle>
                      <Button variant="ghost" size="sm" onClick={copyFromPC}>
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      value={pcClipboard}
                      readOnly
                      placeholder="PC clipboard content will appear here..."
                      className="min-h-[150px] resize-none"
                    />
                    <Button className="w-full mt-3" variant="outline" onClick={copyFromPC}>
                      <ClipboardCopy className="h-4 w-4 mr-2" />
                      Copy to Phone
                    </Button>
                  </CardContent>
                </Card>

                <Card className="glass-dark border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Smartphone className="h-5 w-5 text-neon-cyan" />
                      Phone Clipboard
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      value={phoneClipboard}
                      onChange={(e) => setPhoneClipboard(e.target.value)}
                      placeholder="Paste content here to send to PC..."
                      className="min-h-[150px] resize-none"
                    />
                    <Button className="w-full mt-3 gradient-primary" onClick={pasteToPC}>
                      <ClipboardPaste className="h-4 w-4 mr-2" />
                      Paste to PC
                    </Button>
                  </CardContent>
                </Card>

                {/* Sync Settings */}
                <Card className="glass-dark border-border/50 md:col-span-2">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Clipboard Sync Settings</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>Auto-Sync Clipboard</Label>
                        <p className="text-sm text-muted-foreground">Automatically sync clipboard between devices</p>
                      </div>
                      <Switch checked={clipboardSyncEnabled} onCheckedChange={setClipboardSyncEnabled} />
                    </div>

                    <div className="flex items-center gap-3">
                      <Button
                        onClick={() => syncClipboard("bidirectional")}
                        disabled={isSyncing}
                        className="flex-1"
                      >
                        {isSyncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowLeftRight className="h-4 w-4 mr-2" />}
                        Sync Both Ways
                      </Button>
                      {lastSyncTime && (
                        <span className="text-sm text-muted-foreground">
                          Last synced: {lastSyncTime.toLocaleTimeString()}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* NOTIFICATIONS TAB */}
            <TabsContent value="notifications">
              <div className="space-y-4">
                <Card className="glass-dark border-border/50">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <BellRing className="h-5 w-5 text-neon-orange" />
                        Notification Settings
                      </CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>Notification Sync</Label>
                        <p className="text-sm text-muted-foreground">Show phone notifications on laptop</p>
                      </div>
                      <Switch checked={notificationSyncEnabled} onCheckedChange={setNotificationSyncEnabled} />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>Mirror Notifications</Label>
                        <p className="text-sm text-muted-foreground">Show as system notifications</p>
                      </div>
                      <Switch checked={notificationMirror} onCheckedChange={setNotificationMirror} />
                    </div>
                  </CardContent>
                </Card>

                <Card className="glass-dark border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Phone Notifications</CardTitle>
                    <CardDescription>{mobileInfo.notifications.length} notifications</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[300px]">
                      <div className="space-y-3">
                        {mobileInfo.notifications.map((notif) => (
                          <div key={notif.id} className="p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="text-xs">{notif.app}</Badge>
                                  <span className="text-xs text-muted-foreground">{notif.time}</span>
                                </div>
                                <p className="font-medium mt-1">{notif.title}</p>
                                <p className="text-sm text-muted-foreground">{notif.body}</p>
                              </div>
                              <Button variant="ghost" size="icon" onClick={() => dismissNotification(notif.id)}>
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                            {notif.app === "WhatsApp" || notif.app === "Messages" ? (
                              <div className="flex gap-2 mt-2">
                                <Input placeholder="Quick reply..." className="flex-1" />
                                <Button size="sm" onClick={() => replyToNotification(notif.id, "")}>
                                  Reply
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* SCREEN SHARE TAB */}
            <TabsContent value="screen">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Screen Share */}
                <Card className="glass-dark border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Cast className="h-5 w-5 text-neon-green" />
                      Screen Share
                    </CardTitle>
                    <CardDescription>Share screen between devices (HD 90fps)</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>Direction</Label>
                      <Select value={screenShareDirection} onValueChange={(v) => setScreenShareDirection(v as typeof screenShareDirection)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="phone_to_pc">Phone → PC</SelectItem>
                          <SelectItem value="pc_to_phone">PC → Phone</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Quality</Label>
                        <Select value={screenShareQuality} onValueChange={(v) => setScreenShareQuality(v as typeof screenShareQuality)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="720p">720p HD</SelectItem>
                            <SelectItem value="1080p">1080p FHD</SelectItem>
                            <SelectItem value="4k">4K UHD</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>FPS: {screenShareFps}</Label>
                        <Input
                          type="range"
                          min={30}
                          max={90}
                          value={screenShareFps}
                          onChange={(e) => setScreenShareFps(parseInt(e.target.value))}
                          className="cursor-pointer"
                        />
                      </div>
                    </div>

                    <Button
                      className={cn("w-full", screenShareActive ? "bg-destructive hover:bg-destructive/80" : "gradient-primary")}
                      onClick={screenShareActive ? stopScreenShare : startScreenShare}
                    >
                      {screenShareActive ? (
                        <>
                          <X className="h-4 w-4 mr-2" />
                          Stop Sharing
                        </>
                      ) : (
                        <>
                          <Cast className="h-4 w-4 mr-2" />
                          Start Screen Share
                        </>
                      )}
                    </Button>

                    {screenShareActive && (
                      <div className="aspect-video bg-black rounded-lg overflow-hidden">
                        {screenFrame ? (
                          <img src={screenFrame} alt="Screen" className="w-full h-full object-contain" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                            <Loader2 className="h-8 w-8 animate-spin" />
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Phone as Webcam */}
                <Card className="glass-dark border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Camera className="h-5 w-5 text-neon-cyan" />
                      Phone as Webcam
                    </CardTitle>
                    <CardDescription>Use your phone camera as PC webcam</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Quality</Label>
                        <Select value={webcamQuality} onValueChange={(v) => setWebcamQuality(v as typeof webcamQuality)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="720p">720p HD</SelectItem>
                            <SelectItem value="1080p">1080p FHD</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>FPS: {webcamFps}</Label>
                        <Input
                          type="range"
                          min={15}
                          max={60}
                          value={webcamFps}
                          onChange={(e) => setWebcamFps(parseInt(e.target.value))}
                          className="cursor-pointer"
                        />
                      </div>
                    </div>

                    <Button
                      className={cn("w-full", phoneWebcamActive ? "bg-destructive hover:bg-destructive/80" : "gradient-primary")}
                      onClick={phoneWebcamActive ? stopPhoneWebcam : startPhoneWebcam}
                    >
                      {phoneWebcamActive ? (
                        <>
                          <X className="h-4 w-4 mr-2" />
                          Stop Webcam
                        </>
                      ) : (
                        <>
                          <Camera className="h-4 w-4 mr-2" />
                          Start as Webcam
                        </>
                      )}
                    </Button>

                    <div className="aspect-video bg-black rounded-lg overflow-hidden">
                      <video
                        ref={phoneWebcamRef}
                        autoPlay
                        playsInline
                        muted
                        className={cn("w-full h-full object-cover", !phoneWebcamActive && "hidden")}
                      />
                      {!phoneWebcamActive && (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                          <Camera className="h-12 w-12 opacity-50" />
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </DashboardLayout>
  );
}
