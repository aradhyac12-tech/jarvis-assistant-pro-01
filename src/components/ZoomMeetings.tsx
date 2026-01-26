import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
}

interface ZoomMeetingsProps {
  className?: string;
}

export function ZoomMeetings({ className }: ZoomMeetingsProps) {
  const [activeTab, setActiveTab] = useState<"join" | "saved">("join");
  
  // Join form state
  const [joinMethod, setJoinMethod] = useState<"link" | "id">("link");
  const [meetingLink, setMeetingLink] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const [meetingPassword, setMeetingPassword] = useState("");
  const [saveMeeting, setSaveMeeting] = useState(false);
  const [meetingName, setMeetingName] = useState("");
  
  // Saved meetings
  const [savedMeetings, setSavedMeetings] = useState<SavedMeeting[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isJoining, setIsJoining] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { session } = useDeviceSession();

  // Fetch saved meetings
  const fetchSavedMeetings = async () => {
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
  };

  useEffect(() => {
    fetchSavedMeetings();
  }, []);

  // Extract meeting ID from Zoom link
  const extractMeetingInfo = (link: string) => {
    const match = link.match(/zoom\.us\/j\/(\d+)(?:\?pwd=([^&]+))?/);
    if (match) {
      return { id: match[1], password: match[2] || "" };
    }
    return null;
  };

  // Join meeting
  const handleJoinMeeting = async (meeting?: SavedMeeting) => {
    const joinId = meeting?.id || "new";
    setIsJoining(joinId);
    
    try {
      let payload: { meeting_id?: string; password?: string; meeting_link?: string } = {};
      
      if (meeting) {
        // Joining from saved meeting
        if (meeting.meeting_link) {
          payload.meeting_link = meeting.meeting_link;
        } else if (meeting.meeting_id) {
          payload.meeting_id = meeting.meeting_id;
          if (meeting.meeting_password) {
            payload.password = meeting.meeting_password;
          }
        }
      } else {
        // Joining from form
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
      
      const res = await sendCommand("join_zoom", payload, { awaitResult: true, timeoutMs: 10000 });
      
      if (res.success) {
        toast({
          title: "Joining Zoom",
          description: "Opening Zoom meeting on your PC...",
        });
        
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
      };
      
      if (joinMethod === "link" && meetingLink) {
        meetingData.meeting_link = meetingLink;
        // Also extract ID if present
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
        description: `"${meetingName}" saved for quick access`,
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

  return (
    <Card className={cn("glass-dark border-border/50", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Video className="h-5 w-5 text-primary" />
          Zoom Meetings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "join" | "saved")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="join">Join Meeting</TabsTrigger>
            <TabsTrigger value="saved">
              Saved
              {savedMeetings.length > 0 && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  {savedMeetings.length}
                </Badge>
              )}
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
                Meeting Link
              </Button>
              <Button
                variant={joinMethod === "id" ? "default" : "secondary"}
                size="sm"
                onClick={() => setJoinMethod("id")}
                className={cn(joinMethod === "id" && "gradient-primary")}
              >
                <Key className="h-4 w-4 mr-2" />
                Meeting ID
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
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Video className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{meeting.meeting_name}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDate(meeting.last_used_at)}
                        </div>
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
        </Tabs>
      </CardContent>
    </Card>
  );
}
