import { useCallback } from "react";
import { addLog } from "@/components/IssueLog";

export function useCommandLogger() {
  const logCommand = useCallback(
    (commandType: string, success: boolean, details?: string) => {
      if (success) {
        addLog("info", "web", `Command "${commandType}" executed successfully`, details);
      } else {
        addLog("error", "web", `Command "${commandType}" failed`, details);
      }
    },
    []
  );

  const logError = useCallback((context: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    addLog("error", "web", `${context}: ${message}`);
  }, []);

  const logWarning = useCallback((message: string, details?: string) => {
    addLog("warn", "web", message, details);
  }, []);

  const logInfo = useCallback((message: string, details?: string) => {
    addLog("info", "web", message, details);
  }, []);

  return { logCommand, logError, logWarning, logInfo };
}
