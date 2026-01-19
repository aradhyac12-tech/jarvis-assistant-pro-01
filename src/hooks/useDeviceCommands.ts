import { useCallback, useMemo, useRef } from "react";
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
  const { session, unpair } = useDeviceSession();
  const { selectedDevice } = useDeviceContext();

  // Deduplicate in-flight awaitResult commands (prevents spam + slowdowns)
  const inFlightRef = useRef(new Map<string, Promise<any>>());

  const isSessionError = (message: string | undefined) => {
    if (!message) return false;
    return /Edge function returned 401|Invalid or expired session|Session expired/i.test(message);
  };

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
            if (isSessionError(response.error.message)) {
              addLog("error", "web", "Session expired. Reconnecting...");
              unpair();
              return { success: false, error: "Session expired. Please reconnect." } as const;
            }

            await sleep(pollIntervalMs);
            continue;
          }

          const data = response.data as any;
          if (!data || data.status === "pending" || data.status === "running") {
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
    [unpair]
  );

  const sendCommand = useCallback(
    async (commandType: string, payload: Record<string, unknown> = {}, options?: SendCommandOptions) => {
      const sessionToken = session?.session_token;
      const deviceId = selectedDevice?.id || session?.device_id;

      if (!sessionToken) {
        const errorMsg = "No active session";
        addLog("error", "web", `Command "${commandType}" failed: ${errorMsg}`);
        toast({
          title: "Not Paired",
          description: "Please connect to your PC first.",
          variant: "destructive",
        });
        return { success: false, error: errorMsg } as const;
      }

      if (!deviceId) {
        const errorMsg = "No device connected";
        addLog("error", "web", `Command "${commandType}" failed: ${errorMsg}`);
        toast({
          title: "No Device Connected",
          description: "Please run the PC agent.",
          variant: "destructive",
        });
        return { success: false, error: errorMsg } as const;
      }

      const startTime = Date.now();
      const shouldDedupe = !!options?.awaitResult;
      const dedupeKey = `${deviceId}:${commandType}:${JSON.stringify(payload)}`;

      if (shouldDedupe) {
        const existing = inFlightRef.current.get(dedupeKey);
        if (existing) return existing;
      }

      const execPromise = (async () => {
        try {
          addLog("info", "web", `Sending command: ${commandType}`, JSON.stringify(payload).slice(0, 140));

          // Retry logic for transient network errors
          let response;
          let retries = 3;
          while (retries > 0) {
            response = await supabase.functions.invoke("device-commands", {
              body: { action: "insert", commandType, payload },
              headers: { "x-session-token": sessionToken },
            });

            // If success or definite session error, break
            if (!response.error || isSessionError(response.error.message)) {
              break;
            }

            // Transient error - retry after short delay
            retries--;
            if (retries > 0) {
              addLog("warn", "web", `Retrying command "${commandType}"... (${3 - retries}/3)`);
              await sleep(500);
            }
          }

          if (response?.error) {
            if (isSessionError(response.error.message)) {
              addLog("error", "web", "Session expired. Please reconnect.");
              unpair();
              toast({
                title: "Session Expired",
                description: "Please reconnect to your PC.",
                variant: "destructive",
              });
              return { success: false, error: "Session expired" } as const;
            }
            throw new Error(response.error.message || "Failed to send command");
          }

          const data = response.data as any;
          if (!data?.success) {
            throw new Error(data?.error || "Failed to send command");
          }

          const commandId = data.commandId as string | undefined;

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
            description: errorMsg,
            variant: "destructive",
          });
          return { success: false, error } as const;
        }
      })();

      if (shouldDedupe) {
        inFlightRef.current.set(dedupeKey, execPromise);
      }

      try {
        return await execPromise;
      } finally {
        if (shouldDedupe) inFlightRef.current.delete(dedupeKey);
      }
    },
    [selectedDevice?.id, session?.device_id, session?.session_token, toast, unpair, waitForCommandResult]
  );

  return useMemo(() => ({ sendCommand }), [sendCommand]);
}
