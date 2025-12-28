import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import type { Json } from "@/integrations/supabase/types";

type SendCommandOptions = {
  awaitResult?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
};

type CommandResult = {
  success?: boolean;
  message?: string;
  error?: string;
  [key: string]: unknown;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useDeviceCommands() {
  const { toast } = useToast();
  const { user } = useAuth();

  const waitForCommandResult = useCallback(
    async (commandId: string, options: SendCommandOptions = {}) => {
      const timeoutMs = options.timeoutMs ?? 12000;
      const pollIntervalMs = options.pollIntervalMs ?? 500;
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        const { data, error } = await supabase
          .from("commands")
          .select("status,result")
          .eq("id", commandId)
          .maybeSingle();

        if (error) {
          return { success: false, error } as const;
        }

        if (!data) {
          await sleep(pollIntervalMs);
          continue;
        }

        if (data.status === "pending") {
          await sleep(pollIntervalMs);
          continue;
        }

        const result = (data.result ?? {}) as CommandResult;
        const ok = data.status === "completed" && result.success !== false;

        return {
          success: ok,
          result,
          error: ok ? undefined : (result.error ?? "Command failed"),
        } as const;
      }

      return { success: false, error: "Timed out waiting for PC" } as const;
    },
    []
  );

  const sendCommand = useCallback(
    async (commandType: string, payload: Record<string, unknown> = {}, options?: SendCommandOptions) => {
      try {
        // Get the first online device (single-device setup)
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
            description: "Please run the PC agent first.",
            variant: "destructive",
          });
          return { success: false, error: "No device connected" } as const;
        }

        const userId = user?.id ?? crypto.randomUUID();

        const { data, error } = await supabase
          .from("commands")
          .insert([
            {
              device_id: deviceId,
              command_type: commandType,
              payload: payload as Json,
              status: "pending",
              user_id: userId,
            },
          ])
          .select("id")
          .maybeSingle();

        if (error) throw error;

        const commandId = data?.id;
        console.log(`Command sent: ${commandType}`, { payload, commandId });

        if (!commandId || !options?.awaitResult) {
          return { success: true, commandId } as const;
        }

        const awaited = await waitForCommandResult(commandId, options);
        return { ...awaited, commandId } as const;
      } catch (error) {
        console.error("Error sending command:", error);
        toast({
          title: "Command Failed",
          description: "Failed to send command to PC",
          variant: "destructive",
        });
        return { success: false, error } as const;
      }
    },
    [toast, user?.id, waitForCommandResult]
  );

  return { sendCommand };
}
