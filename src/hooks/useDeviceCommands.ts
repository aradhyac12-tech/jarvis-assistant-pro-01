import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { addLog } from "@/components/IssueLog";

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
    async (commandId: string, sessionToken: string, options: SendCommandOptions = {}) => {
      const timeoutMs = options.timeoutMs ?? 12000;
      const pollIntervalMs = options.pollIntervalMs ?? 500;
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        try {
          const response = await supabase.functions.invoke("device-commands", {
            body: { action: "poll", commandId },
            headers: { "x-session-token": sessionToken },
          });

          if (response.error) {
            await sleep(pollIntervalMs);
            continue;
          }

          const data = response.data;
          if (!data || data.status === "pending") {
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
        } catch {
          await sleep(pollIntervalMs);
        }
      }

      return { success: false, error: "Timed out waiting for PC" } as const;
    },
    []
  );

  const sendCommand = useCallback(
    async (commandType: string, payload: Record<string, unknown> = {}, options?: SendCommandOptions) => {
      const startTime = Date.now();
      
      try {
        const sessionToken = session?.session_token;
        const deviceId = selectedDevice?.id || session?.device_id;

        if (!sessionToken) {
          const errorMsg = "No active session";
          addLog("error", "web", `Command "${commandType}" failed: ${errorMsg}`);
          toast({
            title: "Not Paired",
            description: "Please pair with your PC first.",
            variant: "destructive",
          });
          return { success: false, error: errorMsg } as const;
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

        addLog("info", "web", `Sending command: ${commandType}`, JSON.stringify(payload).slice(0, 100));

        // Use edge function for secure command insertion
        const response = await supabase.functions.invoke("device-commands", {
          body: { 
            action: "insert", 
            commandType, 
            payload 
          },
          headers: { "x-session-token": sessionToken },
        });

        if (response.error) {
          throw new Error(response.error.message || "Failed to send command");
        }

        const data = response.data;
        if (!data?.success) {
          throw new Error(data?.error || "Failed to send command");
        }

        const commandId = data.commandId;
        console.log(`Command sent: ${commandType}`, { payload, commandId, deviceId });

        if (!commandId || !options?.awaitResult) {
          addLog("info", "web", `Command "${commandType}" queued`, `ID: ${commandId}`);
          return { success: true, commandId } as const;
        }

        const awaited = await waitForCommandResult(commandId, sessionToken, options);
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
