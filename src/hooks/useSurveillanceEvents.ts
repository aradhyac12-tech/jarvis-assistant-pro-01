import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export interface SurveillanceEvent {
  id: string;
  device_id: string;
  user_id: string;
  event_type: string;
  confidence: number;
  recognized: boolean;
  recognized_label: string | null;
  recognition_confidence: number | null;
  screenshot_url: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

export function useSurveillanceEvents() {
  const { selectedDevice } = useDeviceContext();
  const { user } = useAuth();
  const { toast } = useToast();
  const [events, setEvents] = useState<SurveillanceEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Fetch recent events
  const fetchEvents = useCallback(async (limit = 50) => {
    if (!selectedDevice?.id || !user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("surveillance_events")
        .select("*")
        .eq("device_id", selectedDevice.id)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      setEvents((data as SurveillanceEvent[]) || []);
    } catch (err) {
      console.error("Failed to fetch surveillance events:", err);
    }
    setLoading(false);
  }, [selectedDevice?.id, user]);

  // Save a new event with optional screenshot
  const saveEvent = useCallback(async (params: {
    event_type: "motion" | "human" | "intruder" | "owner_recognized" | "call_started" | "call_ended";
    confidence: number;
    recognized?: boolean;
    recognized_label?: string | null;
    recognition_confidence?: number;
    screenshot_blob?: Blob | null;
    metadata?: Record<string, any>;
  }) => {
    if (!selectedDevice?.id || !user) return null;

    let screenshot_url: string | null = null;

    // Upload screenshot if provided
    if (params.screenshot_blob) {
      const filename = `${user.id}/${selectedDevice.id}/${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("surveillance-screenshots")
        .upload(filename, params.screenshot_blob, { contentType: "image/jpeg", upsert: false });
      
      if (!uploadError) {
        const { data: urlData } = supabase.storage
          .from("surveillance-screenshots")
          .getPublicUrl(filename);
        // For private buckets, use signed URL
        const { data: signedData } = await supabase.storage
          .from("surveillance-screenshots")
          .createSignedUrl(filename, 60 * 60 * 24 * 15); // 15 days
        screenshot_url = signedData?.signedUrl || urlData?.publicUrl || null;
      }
    }

    const { data, error } = await supabase
      .from("surveillance_events")
      .insert({
        device_id: selectedDevice.id,
        user_id: user.id,
        event_type: params.event_type,
        confidence: params.confidence,
        recognized: params.recognized || false,
        recognized_label: params.recognized_label || null,
        recognition_confidence: params.recognition_confidence || 0,
        screenshot_url,
        metadata: params.metadata || {},
      })
      .select()
      .single();

    if (error) {
      console.error("Failed to save surveillance event:", error);
      return null;
    }

    // Add to local state
    setEvents(prev => [data as SurveillanceEvent, ...prev].slice(0, 100));
    return data as SurveillanceEvent;
  }, [selectedDevice?.id, user]);

  // Delete an event
  const deleteEvent = useCallback(async (eventId: string) => {
    const { error } = await supabase
      .from("surveillance_events")
      .delete()
      .eq("id", eventId);
    if (!error) {
      setEvents(prev => prev.filter(e => e.id !== eventId));
    }
  }, []);

  // Clear all events for device
  const clearEvents = useCallback(async () => {
    if (!selectedDevice?.id) return;
    const { error } = await supabase
      .from("surveillance_events")
      .delete()
      .eq("device_id", selectedDevice.id);
    if (!error) {
      setEvents([]);
      toast({ title: "Event history cleared" });
    }
  }, [selectedDevice?.id, toast]);

  // Realtime subscription for push alerts
  useEffect(() => {
    if (!selectedDevice?.id || !user) return;

    const channel = supabase
      .channel(`surveillance_${selectedDevice.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "surveillance_events",
          filter: `device_id=eq.${selectedDevice.id}`,
        },
        (payload) => {
          const newEvent = payload.new as SurveillanceEvent;
          setEvents(prev => [newEvent, ...prev].slice(0, 100));
          
          // Push notification for intruder events
          if (newEvent.event_type === "intruder" || (newEvent.event_type === "human" && !newEvent.recognized)) {
            toast({
              title: "🚨 Intruder Alert!",
              description: `Unknown person detected (${newEvent.confidence}% confidence)`,
              variant: "destructive",
            });

            // Browser notification
            if ("Notification" in window && Notification.permission === "granted") {
              new Notification("🚨 Surveillance Alert", {
                body: `Intruder detected at ${new Date(newEvent.created_at).toLocaleTimeString()} (${newEvent.confidence}% confidence)`,
                icon: "/favicon.ico",
                tag: "surveillance-alert",
              });
            }
          }
        }
      )
      .subscribe();

    realtimeChannelRef.current = channel;

    return () => {
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
    };
  }, [selectedDevice?.id, user, toast]);

  // Request notification permission on mount
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return {
    events,
    loading,
    saveEvent,
    deleteEvent,
    clearEvents,
    fetchEvents,
  };
}
