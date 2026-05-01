import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Video,
  Link2,
  Key,
  Plus,
  Play,
  Trash2,
  Clock,
  Save,
  Loader2,
  ExternalLink,
  Star,
  X,
  Mic,
  MicOff,
  Camera,
  CameraOff,
  Calendar,
  Image,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { supabase } from "@/integrations/supabase/client";
import { useDeviceSession } from "@/hooks/useDeviceSession";

interface SavedMeeting {
  id: string;
  meeting_name: string;
  meeting_id: string | null;
  meeting_password: string | null;
  meeting_link: string | null;
  last_used_at: string | null;
  created_at: string;
  // New scheduling fields
  auto_join_enabled?: boolean;
  scheduled_time?: string | null;
  scheduled_days?: string[];
  mute_audio?: boolean;
  mute_video?: boolean;
  take_screenshot?: boolean;
  next_scheduled_at?: string | null;
}

interface MeetingJoinLog {
  id: string;
  meeting_id: string;
  joined_at: string;
  screenshot_url: string | null;
  status: string;
  auto_joined: boolean;
}

interface ZoomMeetingsProps {
  className?: string;
}

const DAYS_OF_WEEK = [
  { id: "sunday", label: "Sun" },
  { id: "monday", label: "Mon" },
  { id: "tuesday", label: "Tue" },
  { id: "wednesday", label: "Wed" },
  { id: "thursday", label: "Thu" },
  { id: "friday", label: "Fri" },
  { id: "saturday", label: "Sat" },
];

export function ZoomMeetings({ className }: ZoomMeetingsProps) {
  const [activeTab, setActiveTab] = useState<"join" | "saved" | "schedule" | "screenshots">("join");
  
  // Join form state
  const [joinMethod, setJoinMethod] = useState<"link" | "id">("link");
  const [meetingLink, setMeetingLink] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const [meetingPassword, setMeetingPassword] = useState("");
  const [saveMeeting, setSaveMeeting] = useState(false);
  const [meetingName, setMeetingName] = useState("");
  
  // Join options
  const [muteAudio, setMuteAudio] = useState(true);
  const [muteVideo, setMuteVideo] = useState(true);
  const [takeScreenshot, setTakeScreenshot] = useState(true);
  
  // Saved meetings
  const [savedMeetings, setSavedMeetings] = useState<SavedMeeting[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isJoining, setIsJoining] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [meetingActive, setMeetingActive] = useState(false);
  const [liveMicMuted, setLiveMicMuted] = useState(true);
  const [liveVideoOff, setLiveVideoOff] = useState(true);
  
  // Screenshot gallery
  const [screenshots, setScreenshots] = useState<Array<{ id: string; src: string; timestamp: Date; label?: string }>>([]);
  const [lastScreenshot, setLastScreenshot] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [selectedScreenshot, setSelectedScreenshot] = useState<string | null>(null);
  const zoomPollRef = useRef<number | null>(null);
  
  // Schedule editing
  const [editingSchedule, setEditingSchedule] = useState<string | null>(null);
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [scheduleDays, setScheduleDays] = useState<string[]>([]);
  
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { session } = useDeviceSession();

  // Fetch saved meetings
  const fetchSavedMeetings = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("saved_meetings")
        .select("*")
        .order("last_used_at", { ascending: false, nullsFirst: false });
      
      if (error) throw error;
      setSavedMeetings(data || []);
    } catch (err) {
      console.error("Failed to fetch meetings:", err);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchSavedMeetings();
  }, [fetchSavedMeetings]);

  // Cleanup zoom status poll on unmount
  useEffect(() => {
    return () => {
      if (zoomPollRef.current) clearInterval(zoomPollRef.current);
    };
  }, []);

  // Extract meeting ID from Zoom link
  const extractMeetingInfo = (link: string) => {
    const match = link.match(/zoom\.us\/j\/(\d+)(?:\?pwd=([^&]+))?/);
    if (match) {
      return { id: match[1], password: match[2] || "" };
    }
    return null;
  };

  // Join meeting with enhanced options
  const handleJoinMeeting = async (meeting?: SavedMeeting) => {
    const joinId = meeting?.id || "new";
    setIsJoining(joinId);
    setLastScreenshot(null);
    
    try {
      let payload: {
        meeting_id?: string;
        password?: string;
        meeting_link?: string;
        mute_audio: boolean;
        mute_video: boolean;
        take_screenshot: boolean;
      } = {
        mute_audio: meeting?.mute_audio ?? muteAudio,
        mute_video: meeting?.mute_video ?? muteVideo,
        take_screenshot: meeting?.take_screenshot ?? takeScreenshot,
      };
      
      if (meeting) {
        if (meeting.meeting_link) {
          payload.meeting_link = meeting.meeting_link;
        } else if (meeting.meeting_id) {
          payload.meeting_id = meeting.meeting_id;
          if (meeting.meeting_password) {
            payload.password = meeting.meeting_password;
          }
        }
      } else {
        if (joinMethod === "link" && meetingLink) {
          payload.meeting_link = meetingLink;
        } else if (joinMethod === "id" && meetingId) {
          payload.meeting_id = meetingId;
          if (meetingPassword) {
            payload.password = meetingPassword;
          }
        }
      }
      
      if (!payload.meeting_link && !payload.meeting_id) {
        toast({
          title: "Missing information",
          description: "Please enter a meeting link or meeting ID",
          variant: "destructive",
        });
        setIsJoining(null);
        return;
      }
      
      // Agent returns immediately — Zoom opens in background with a timed sequence
      // initial_wait: time for Zoom app to load (15s if already running, 240s cold start)
      const res = await sendCommand("join_zoom", { 
        ...payload, 
        initial_wait: 240,
        screenshot_wait: 8,   // Capture screenshot 8s after joining
      }, { 
        awaitResult: true, 
        timeoutMs: 35000,
      });
      
      if (res.success) {
        const result = res as any;
        
        setMeetingActive(true);
        setLiveMicMuted(muteAudio);
        setLiveVideoOff(muteVideo);
        
        const wasRunning = result.zoom_was_running;
        toast({
          title: "🎥 Zoom Opening on PC",
          description: wasRunning 
            ? "Zoom was already running — joining now (≈15s)"
            : "Starting Zoom — joining in ≈4 min (cold start)",
        });
        
        // Log the join (using any type since table was just created)
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            await (supabase.from("meeting_join_logs" as any) as any).insert({
              meeting_id: meeting?.id || null,
              user_id: user.id,
              status: "joined",
              auto_joined: false,
              screenshot_url: result.screenshot_path || null,
            });
          }
        } catch (logErr) {
          console.debug("Failed to log join:", logErr);
        }
        
        // Update last_used_at for saved meeting
        if (meeting) {
          await supabase
            .from("saved_meetings")
            .update({ last_used_at: new Date().toISOString() })
            .eq("id", meeting.id);
          fetchSavedMeetings();
        }
        
        // Save meeting if requested
        if (!meeting && saveMeeting && meetingName.trim()) {
          await saveMeetingToDb();
        }
        
        // If agent returned background=true, poll zoom_status every 3s for up to 5 min
        if (result.background) {
          if (zoomPollRef.current) clearInterval(zoomPollRef.current);
          const startPoll = Date.now();
          zoomPollRef.current = window.setInterval(async () => {
            if (Date.now() - startPoll > 300_000) {
              clearInterval(zoomPollRef.current!);
              zoomPollRef.current = null;
              return;
            }
            try {
              const statusRes = await sendCommand("zoom_status", {}, { awaitResult: true, timeoutMs: 5000 });
              const status = (statusRes as any).result ?? statusRes;
              if (status?.join_result?.success) {
                clearInterval(zoomPollRef.current!);
                zoomPollRef.current = null;
                if (status.join_result.screenshot) {
                  const src = `data:image/jpeg;base64,${status.join_result.screenshot}`;
                  setLastScreenshot(src);
                  setScreenshots(prev => [{ id: crypto.randomUUID(), src, timestamp: new Date(), label: "Meeting joined" }, ...prev].slice(0, 50));
                  toast({ title: "✅ Zoom Meeting Joined", description: "Screenshot captured" });
                }
              }
            } catch { /* silent */ }
          }, 3000);
        }

        // Show screenshot preview with base64 data from agent
        if (result.screenshot) {
          const src = `data:image/jpeg;base64,${result.screenshot}`;
          setLastScreenshot(src);
          setScreenshots(prev => [{ id: crypto.randomUUID(), src, timestamp: new Date(), label: "Meeting joined" }, ...prev].slice(0, 50));
          toast({
            title: "✅ Meeting Successfully Joined",
            description: "Screenshot captured - see Screenshots tab",
          });
        } else if (result.screenshot_path) {
          setLastScreenshot("captured");
          toast({
            title: "✅ Meeting Successfully Joined",
            description: "Screenshot saved on PC",
          });
        }
        
        // Clear form
        setMeetingLink("");
        setMeetingId("");
        setMeetingPassword("");
        setMeetingName("");
        setSaveMeeting(false);
      } else {
        toast({
          title: "Failed to join",
          description: (res as any).error || "Could not join meeting",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Join error:", err);
      toast({
        title: "Error",
        description: "Failed to join meeting",
        variant: "destructive",
      });
    }
    
    setIsJoining(null);
  };

  // Save meeting to database
  const saveMeetingToDb = async () => {
    if (!meetingName.trim()) {
      toast({
        title: "Name required",
        description: "Please enter a name for this meeting",
        variant: "destructive",
      });
      return;
    }
    
    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({
          title: "Not authenticated",
          description: "Please log in to save meetings",
          variant: "destructive",
        });
        return;
      }
      
      const meetingData: any = {
        user_id: user.id,
        meeting_name: meetingName.trim(),
        device_id: session?.device_id || null,
        mute_audio: muteAudio,
        mute_video: muteVideo,
        take_screenshot: takeScreenshot,
      };
      
      if (joinMethod === "link" && meetingLink) {
        meetingData.meeting_link = meetingLink;
        const extracted = extractMeetingInfo(meetingLink);
        if (extracted) {
          meetingData.meeting_id = extracted.id;
          meetingData.meeting_password = extracted.password || null;
        }
      } else if (joinMethod === "id" && meetingId) {
        meetingData.meeting_id = meetingId.replace(/[\s\-]/g, "");
        meetingData.meeting_password = meetingPassword || null;
      }
      
      const { error } = await supabase
        .from("saved_meetings")
        .insert(meetingData);
      
      if (error) throw error;
      
      toast({
        title: "Meeting saved",
        description: `"${meetingName}" saved with your preferences`,
      });
      
      fetchSavedMeetings();
      setMeetingName("");
      setSaveMeeting(false);
    } catch (err) {
      console.error("Save error:", err);
      toast({
        title: "Save failed",
        description: "Could not save meeting",
        variant: "destructive",
      });
    }
    setIsSaving(false);
  };

  // Update meeting schedule
  const updateMeetingSchedule = async (meetingId: string, enabled: boolean, time?: string, days?: string[]) => {
    try {
      const updateData: any = {
        auto_join_enabled: enabled,
      };
      
      if (time !== undefined) updateData.scheduled_time = time || null;
      if (days !== undefined) updateData.scheduled_days = days;
      
      const { error } = await supabase
        .from("saved_meetings")
        .update(updateData)
        .eq("id", meetingId);
      
      if (error) throw error;
      
      toast({
        title: enabled ? "Schedule Enabled" : "Schedule Disabled",
        description: enabled ? "Meeting will auto-join at scheduled time" : "Auto-join disabled",
      });
      
      fetchSavedMeetings();
      setEditingSchedule(null);
    } catch (err) {
      console.error("Schedule update error:", err);
      toast({
        title: "Update failed",
        description: "Could not update schedule",
        variant: "destructive",
      });
    }
  };

  // Toggle day in schedule
  const toggleDay = (day: string) => {
    setScheduleDays(prev => 
      prev.includes(day) 
        ? prev.filter(d => d !== day)
        : [...prev, day]
    );
  };

  // Delete saved meeting
  const deleteMeeting = async (id: string) => {
    try {
      await supabase.from("saved_meetings").delete().eq("id", id);
      toast({ title: "Meeting deleted" });
      fetchSavedMeetings();
    } catch (err) {
      toast({
        title: "Delete failed",
        description: "Could not delete meeting",
        variant: "destructive",
      });
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never used";
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  // Take screenshot and add to gallery
  const captureScreenshot = useCallback(async (label?: string) => {
    setIsCapturing(true);
    try {
      const res = await sendCommand("take_screenshot", { quality: 70, scale: 0.5 }, { awaitResult: true, timeoutMs: 10000 });
      if (res.success && (res as any).result?.image) {
        const src = `data:image/jpeg;base64,${(res as any).result.image}`;
        const entry = { id: crypto.randomUUID(), src, timestamp: new Date(), label };
        setScreenshots(prev => [entry, ...prev].slice(0, 50));
        setLastScreenshot(src);
        toast({ title: "📸 Screenshot Captured", description: label || "Zoom meeting screenshot" });
        return src;
      } else {
        toast({ title: "Screenshot Failed", variant: "destructive" });
      }
    } catch {
      toast({ title: "Screenshot Error", variant: "destructive" });
    } finally {
      setIsCapturing(false);
    }
    return null;
  }, [sendCommand, toast]);

  // Mic toggle — sends Alt+A to Zoom, waits for confirmation
  const toggleMic = useCallback(async () => {
    const newState = !liveMicMuted;
    setLiveMicMuted(newState);
    toast({ title: newState ? "🔇 Mic Muted" : "🎤 Mic On", description: "Sent Alt+A to Zoom" });
    try {
      await sendCommand("zoom_mic_toggle", {}, { awaitResult: true, timeoutMs: 5000 });
    } catch {
      setLiveMicMuted(!newState); // revert on failure
      toast({ title: "Mic toggle failed", variant: "destructive" });
    }
  }, [liveMicMuted, sendCommand, toast]);

  // Camera toggle — sends Alt+V to Zoom
  const toggleCamera = useCallback(async () => {
    const newState = !liveVideoOff;
    setLiveVideoOff(newState);
    toast({ title: newState ? "📷 Camera Off" : "📷 Camera On", description: "Sent Alt+V to Zoom" });
    try {
      await sendCommand("zoom_camera_toggle", {}, { awaitResult: true, timeoutMs: 5000 });
    } catch {
      setLiveVideoOff(!newState);
      toast({ title: "Camera toggle failed", variant: "destructive" });
    }
  }, [liveVideoOff, sendCommand, toast]);

  const formatNextSchedule = (meeting: SavedMeeting) => {
    if (!meeting.auto_join_enabled || !meeting.next_scheduled_at) return null;
    const next = new Date(meeting.next_scheduled_at);
    const now = new Date();
    const diffMs = next.getTime() - now.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 60) return `in ${diffMins}m`;
    if (diffMins < 1440) return `in ${Math.floor(diffMins / 60)}h`;
    return next.toLocaleDateString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <Card className={cn("glass-dark border-border/50", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Video className="h-5 w-5 text-primary" />
          Zoom Meetings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="join">Join</TabsTrigger>
            <TabsTrigger value="saved">
              Saved
              {savedMeetings.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs h-5 w-5 p-0 flex items-center justify-center">
                  {savedMeetings.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="screenshots">
              <Image className="h-3 w-3 mr-1" />
              SS
              {screenshots.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs h-4 min-w-[16px] p-0 flex items-center justify-center">
                  {screenshots.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="schedule">
              <Calendar className="h-3 w-3 mr-1" />
              Sched
            </TabsTrigger>
          </TabsList>

          <TabsContent value="join" className="space-y-4 mt-4">
            {/* Join method toggle */}
            <div className="flex gap-2">
              <Button
                variant={joinMethod === "link" ? "default" : "secondary"}
                size="sm"
                onClick={() => setJoinMethod("link")}
                className={cn(joinMethod === "link" && "gradient-primary")}
              >
                <Link2 className="h-4 w-4 mr-2" />
                Link
              </Button>
              <Button
                variant={joinMethod === "id" ? "default" : "secondary"}
                size="sm"
                onClick={() => setJoinMethod("id")}
                className={cn(joinMethod === "id" && "gradient-primary")}
              >
                <Key className="h-4 w-4 mr-2" />
                ID
              </Button>
            </div>

            {/* Link input */}
            {joinMethod === "link" && (
              <div className="space-y-2">
                <Label>Meeting Link</Label>
                <Input
                  placeholder="https://zoom.us/j/123456789?pwd=..."
                  value={meetingLink}
                  onChange={(e) => setMeetingLink(e.target.value)}
                />
              </div>
            )}

            {/* ID + Password inputs */}
            {joinMethod === "id" && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Meeting ID</Label>
                  <Input
                    placeholder="123 456 7890"
                    value={meetingId}
                    onChange={(e) => setMeetingId(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Password (optional)</Label>
                  <Input
                    placeholder="Meeting password"
                    value={meetingPassword}
                    onChange={(e) => setMeetingPassword(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Join options */}
            <div className="grid grid-cols-3 gap-2 p-3 rounded-lg bg-secondary/30">
              <Button
                variant={muteAudio ? "default" : "outline"}
                size="sm"
                onClick={() => setMuteAudio(!muteAudio)}
                className={cn("h-auto py-2 flex-col gap-1", muteAudio && "bg-red-500/20 text-red-400 border-red-500/30")}
              >
                {muteAudio ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                <span className="text-[10px]">{muteAudio ? "Mic Off" : "Mic On"}</span>
              </Button>
              <Button
                variant={muteVideo ? "default" : "outline"}
                size="sm"
                onClick={() => setMuteVideo(!muteVideo)}
                className={cn("h-auto py-2 flex-col gap-1", muteVideo && "bg-red-500/20 text-red-400 border-red-500/30")}
              >
                {muteVideo ? <CameraOff className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
                <span className="text-[10px]">{muteVideo ? "Cam Off" : "Cam On"}</span>
              </Button>
              <Button
                variant={takeScreenshot ? "default" : "outline"}
                size="sm"
                onClick={() => setTakeScreenshot(!takeScreenshot)}
                className={cn("h-auto py-2 flex-col gap-1", takeScreenshot && "bg-green-500/20 text-green-400 border-green-500/30")}
              >
                <Image className="h-4 w-4" />
                <span className="text-[10px]">{takeScreenshot ? "Screenshot" : "No SS"}</span>
              </Button>
            </div>

            {/* Save option */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30">
              <input
                type="checkbox"
                id="save-meeting"
                checked={saveMeeting}
                onChange={(e) => setSaveMeeting(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              <Label htmlFor="save-meeting" className="text-sm cursor-pointer flex-1">
                Save for quick access
              </Label>
            </div>

            {saveMeeting && (
              <div className="space-y-2">
                <Label>Meeting Name</Label>
                <Input
                  placeholder="e.g., Daily Standup, Team Sync"
                  value={meetingName}
                  onChange={(e) => setMeetingName(e.target.value)}
                />
              </div>
            )}

            {/* Join button */}
            <Button
              onClick={() => handleJoinMeeting()}
              disabled={isJoining === "new" || (!meetingLink && !meetingId)}
              className="w-full gradient-primary"
            >
              {isJoining === "new" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Join on PC
            </Button>

            {/* Screenshot Preview */}
            {lastScreenshot && lastScreenshot.startsWith("data:") && (
              <div className="relative rounded-lg overflow-hidden border border-border/50 bg-secondary/30">
                <img src={lastScreenshot} alt="Meeting screenshot" className="w-full h-auto" />
                <div className="absolute top-2 left-2 flex items-center gap-2">
                  <Badge className="bg-primary/80">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Meeting Joined
                  </Badge>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 h-6 w-6 bg-background/50"
                  onClick={() => setLastScreenshot(null)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}

            {/* Live Meeting Controls */}
            {meetingActive && (
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" />
                    Meeting Active
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-6"
                    onClick={() => setMeetingActive(false)}
                  >
                    Dismiss
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {/* Mic toggle - instant click */}
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "h-auto py-3 flex-col gap-1.5",
                      liveMicMuted 
                        ? "bg-destructive/10 text-destructive border-destructive/30" 
                        : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    )}
                    onClick={toggleMic}
                  >
                    {liveMicMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                    <span className="text-[10px] font-medium">{liveMicMuted ? "Mic Off" : "Mic On"}</span>
                  </Button>
                  {/* Camera toggle - instant click */}
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "h-auto py-3 flex-col gap-1.5",
                      liveVideoOff 
                        ? "bg-destructive/10 text-destructive border-destructive/30" 
                        : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    )}
                    onClick={toggleCamera}
                  >
                    {liveVideoOff ? <CameraOff className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
                    <span className="text-[10px] font-medium">{liveVideoOff ? "Cam Off" : "Cam On"}</span>
                  </Button>
                  {/* Screenshot - captures and adds to gallery */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-auto py-3 flex-col gap-1.5 bg-primary/10 text-primary border-primary/30"
                    disabled={isCapturing}
                    onClick={() => captureScreenshot("Zoom meeting")}
                  >
                    {isCapturing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Image className="h-5 w-5" />}
                    <span className="text-[10px] font-medium">Screenshot</span>
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="saved" className="mt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : savedMeetings.length === 0 ? (
              <div className="text-center py-8">
                <Star className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
                <p className="text-muted-foreground text-sm">No saved meetings</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Save meetings for one-tap joining
                </p>
              </div>
            ) : (
              <ScrollArea className="h-[300px]">
                <div className="space-y-2 pr-4">
                  {savedMeetings.map((meeting) => (
                    <div
                      key={meeting.id}
                      className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
                    >
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 relative">
                        <Video className="h-5 w-5 text-primary" />
                        {meeting.auto_join_enabled && (
                          <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-background" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{meeting.meeting_name}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDate(meeting.last_used_at)}
                        </div>
                        {meeting.auto_join_enabled && (
                          <Badge variant="outline" className="mt-1 text-[10px] text-green-400 border-green-500/30">
                            Next: {formatNextSchedule(meeting)}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {meeting.mute_audio && <MicOff className="h-3 w-3 text-red-400" />}
                        {meeting.mute_video && <CameraOff className="h-3 w-3 text-red-400" />}
                        {meeting.take_screenshot && <Image className="h-3 w-3 text-green-400" />}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 hover:bg-primary/10"
                          onClick={() => handleJoinMeeting(meeting)}
                          disabled={isJoining === meeting.id}
                        >
                          {isJoining === meeting.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ExternalLink className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => deleteMeeting(meeting.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          {/* Screenshots Gallery Tab */}
          <TabsContent value="screenshots" className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Screenshots ({screenshots.length})</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  disabled={isCapturing}
                  onClick={() => captureScreenshot("Manual capture")}
                >
                  {isCapturing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Image className="h-3 w-3 mr-1" />}
                  Capture
                </Button>
                {screenshots.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7 text-destructive"
                    onClick={() => { setScreenshots([]); setSelectedScreenshot(null); }}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Clear
                  </Button>
                )}
              </div>
            </div>

            {/* Full-size selected screenshot */}
            {selectedScreenshot && (
              <div className="relative rounded-lg overflow-hidden border border-border/50 bg-secondary/30">
                <img src={selectedScreenshot} alt="Screenshot" className="w-full h-auto" />
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 h-7 w-7 bg-background/70"
                  onClick={() => setSelectedScreenshot(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
                <div className="absolute bottom-2 left-2">
                  <Badge className="bg-background/70 text-foreground text-[10px]">
                    Tap thumbnails to switch
                  </Badge>
                </div>
              </div>
            )}

            {screenshots.length === 0 ? (
              <div className="text-center py-8">
                <Image className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
                <p className="text-muted-foreground text-sm">No screenshots yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Take screenshots during meetings
                </p>
              </div>
            ) : (
              <ScrollArea className="h-[300px]">
                <div className="grid grid-cols-2 gap-2 pr-2">
                  {screenshots.map((ss) => (
                    <div
                      key={ss.id}
                      className={cn(
                        "relative rounded-lg overflow-hidden border cursor-pointer transition-all",
                        selectedScreenshot === ss.src
                          ? "border-primary ring-1 ring-primary/50"
                          : "border-border/30 hover:border-border/60"
                      )}
                      onClick={() => setSelectedScreenshot(ss.src)}
                    >
                      <img src={ss.src} alt="Screenshot" className="w-full h-auto aspect-video object-cover" />
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-background/80 to-transparent p-1.5">
                        <p className="text-[9px] text-muted-foreground truncate">
                          {ss.timestamp.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                          {ss.label && ` • ${ss.label}`}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-1 right-1 h-5 w-5 bg-background/50 opacity-0 group-hover:opacity-100 hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          setScreenshots(prev => prev.filter(s => s.id !== ss.id));
                          if (selectedScreenshot === ss.src) setSelectedScreenshot(null);
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="schedule" className="mt-4 space-y-4">
            {savedMeetings.length === 0 ? (
              <div className="text-center py-8">
                <Calendar className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
                <p className="text-muted-foreground text-sm">No meetings to schedule</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Save a meeting first to set up auto-join
                </p>
              </div>
            ) : (
              <ScrollArea className="h-[350px]">
                <div className="space-y-3 pr-4">
                  {savedMeetings.map((meeting) => (
                    <div key={meeting.id} className="p-3 rounded-lg bg-secondary/30 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Video className="h-4 w-4 text-primary" />
                          <span className="font-medium text-sm">{meeting.meeting_name}</span>
                        </div>
                        <Switch
                          checked={meeting.auto_join_enabled || false}
                          onCheckedChange={(checked) => {
                            if (checked && (!meeting.scheduled_time || !meeting.scheduled_days?.length)) {
                              setEditingSchedule(meeting.id);
                              setScheduleTime(meeting.scheduled_time || "09:00");
                              setScheduleDays(meeting.scheduled_days || []);
                            } else {
                              updateMeetingSchedule(meeting.id, checked);
                            }
                          }}
                        />
                      </div>
                      
                      {(editingSchedule === meeting.id || meeting.auto_join_enabled) && (
                        <div className="space-y-3 pt-2 border-t border-border/50">
                          <div className="flex items-center gap-2">
                            <Label className="text-xs w-12">Time:</Label>
                            <Input
                              type="time"
                              value={editingSchedule === meeting.id ? scheduleTime : (meeting.scheduled_time || "09:00")}
                              onChange={(e) => setScheduleTime(e.target.value)}
                              disabled={editingSchedule !== meeting.id && meeting.auto_join_enabled}
                              className="h-8 text-xs flex-1"
                            />
                          </div>
                          
                          <div className="space-y-1">
                            <Label className="text-xs">Days:</Label>
                            <div className="flex gap-1">
                              {DAYS_OF_WEEK.map((day) => {
                                const isActive = editingSchedule === meeting.id 
                                  ? scheduleDays.includes(day.id)
                                  : meeting.scheduled_days?.includes(day.id);
                                return (
                                  <Button
                                    key={day.id}
                                    variant={isActive ? "default" : "outline"}
                                    size="sm"
                                    className={cn(
                                      "h-7 w-9 p-0 text-[10px]",
                                      isActive && "bg-primary text-primary-foreground"
                                    )}
                                    onClick={() => {
                                      if (editingSchedule === meeting.id) {
                                        toggleDay(day.id);
                                      }
                                    }}
                                    disabled={editingSchedule !== meeting.id && meeting.auto_join_enabled}
                                  >
                                    {day.label}
                                  </Button>
                                );
                              })}
                            </div>
                          </div>
                          
                          {editingSchedule === meeting.id && (
                            <div className="flex gap-2 pt-2">
                              <Button
                                size="sm"
                                onClick={() => updateMeetingSchedule(meeting.id, true, scheduleTime, scheduleDays)}
                                disabled={scheduleDays.length === 0}
                                className="flex-1"
                              >
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Save Schedule
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setEditingSchedule(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          )}
                          
                          {meeting.auto_join_enabled && meeting.next_scheduled_at && editingSchedule !== meeting.id && (
                            <div className="flex items-center gap-2 text-xs text-green-400">
                              <CheckCircle className="h-3 w-3" />
                              Next: {formatNextSchedule(meeting)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
            
            <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
              <p className="flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                Scheduled meetings will auto-join with mic/camera off and take a screenshot
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
