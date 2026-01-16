import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { addLog } from "@/components/IssueLog";
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
  const { session } = useDeviceSession();
  const { selectedDevice } = useDeviceContext();

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
      const startTime = Date.now();
      
      try {
        // Use device from session or selected device
        let deviceId = selectedDevice?.id || session?.device_id;

        if (!deviceId) {
          // Fallback: Get the first online device
          const { data: devices, error: deviceError } = await supabase
            .from("devices")
            .select("id")
            .eq("is_online", true)
            .limit(1);

          if (deviceError) throw deviceError;
          deviceId = devices?.[0]?.id;
        }

        if (!deviceId) {
          const errorMsg = "No device connected";
          addLog("error", "web", `Command "${commandType}" failed: ${errorMsg}`);
          toast({
            title: "No Device Connected",
            description: "Please run the PC agent and pair it first.",
            variant: "destructive",
          });
          return { success: false, error: errorMsg } as const;
        }

        // Generate a placeholder user_id (required by schema but not used for auth)
        const placeholderUserId = session?.device_id || deviceId;

        addLog("info", "web", `Sending command: ${commandType}`, JSON.stringify(payload).slice(0, 100));

        const { data, error } = await supabase
          .from("commands")
          .insert([
            {
              device_id: deviceId,
              command_type: commandType,
              payload: payload as Json,
              status: "pending",
              user_id: placeholderUserId,
            },
          ])
          .select("id")
          .maybeSingle();

        if (error) throw error;

        const commandId = data?.id;
        console.log(`Command sent: ${commandType}`, { payload, commandId, deviceId });

        if (!commandId || !options?.awaitResult) {
          addLog("info", "web", `Command "${commandType}" queued`, `ID: ${commandId}`);
          return { success: true, commandId } as const;
        }

        const awaited = await waitForCommandResult(commandId, options);
        const duration = Date.now() - startTime;
        
        if (awaited.success) {
          addLog("info", "web", `Command "${commandType}" completed in ${duration}ms`);
        } else {
          addLog("error", "web", `Command "${commandType}" failed after ${duration}ms`, awaited.error as string);
        }
        
        return { ...awaited, commandId } as const;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        addLog("error", "web", `Command "${commandType}" error: ${errorMsg}`);
        console.error("Error sending command:", error);
        toast({
          title: "Command Failed",
          description: "Failed to send command to PC",
          variant: "destructive",
        });
        return { success: false, error } as const;
      }
    },
    [toast, session, waitForCommandResult, selectedDevice]
  );

  return { sendCommand };
}
