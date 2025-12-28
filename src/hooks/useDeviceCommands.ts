import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { Json } from "@/integrations/supabase/types";

export function useDeviceCommands() {
  const { toast } = useToast();

  const sendCommand = useCallback(async (
    commandType: string, 
    payload: Record<string, unknown> = {}
  ) => {
    try {
      // Get the first online device
      const { data: devices, error: deviceError } = await supabase
        .from("devices")
        .select("id")
        .eq("is_online", true)
        .limit(1);

      if (deviceError) throw deviceError;
      
      const deviceId = devices?.[0]?.id;

      if (!deviceId) {
        toast({
          title: "No Device Connected",
          description: "Please run the Python agent on your PC first.",
          variant: "destructive",
        });
        return { success: false, error: "No device connected" };
      }

      // Insert command for the device
      const { data, error } = await supabase
        .from("commands")
        .insert([{
          device_id: deviceId,
          command_type: commandType,
          payload: payload as Json,
          status: "pending",
          user_id: crypto.randomUUID(),
        }])
        .select()
        .maybeSingle();

      if (error) throw error;

      console.log(`Command sent: ${commandType}`, payload);
      
      return { success: true, commandId: data?.id };
    } catch (error) {
      console.error("Error sending command:", error);
      toast({
        title: "Command Failed",
        description: "Failed to send command to PC",
        variant: "destructive",
      });
      return { success: false, error };
    }
  }, [toast]);

  return { sendCommand };
}
