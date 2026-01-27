import { useState, useCallback, useRef, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

export interface ClawdBotConfig {
  gatewayUrl: string;
  token: string;
}

export interface ClawdBotStatus {
  connected: boolean;
  version?: string;
  uptime?: number;
  channels?: string[];
  agentName?: string;
}

export interface ClawdMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const STORAGE_KEY = "clawdbot_config";

export function useClawdBot() {
  const { toast } = useToast();
  
  const [config, setConfig] = useState<ClawdBotConfig | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  
  const [status, setStatus] = useState<ClawdBotStatus>({ connected: false });
  const [isConnecting, setIsConnecting] = useState(false);
  const [messages, setMessages] = useState<ClawdMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  // Save config to localStorage
  const saveConfig = useCallback((newConfig: ClawdBotConfig) => {
    setConfig(newConfig);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
  }, []);

  // Clear config
  const clearConfig = useCallback(() => {
    setConfig(null);
    localStorage.removeItem(STORAGE_KEY);
    setStatus({ connected: false });
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  // Check gateway status via REST API
  const checkStatus = useCallback(async (): Promise<boolean> => {
    if (!config) return false;
    
    setIsConnecting(true);
    try {
      const url = config.gatewayUrl.replace(/\/$/, "");
      const response = await fetch(`${url}/api/v1/status`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
      });
      
      if (!response.ok) {
        throw new Error(`Status check failed: ${response.status}`);
      }
      
      const data = await response.json();
      setStatus({
        connected: true,
        version: data.version,
        uptime: data.uptime,
        channels: data.channels || [],
        agentName: data.agent?.name || "Clawd",
      });
      
      return true;
    } catch (error) {
      console.error("ClawdBot status check failed:", error);
      setStatus({ connected: false });
      return false;
    } finally {
      setIsConnecting(false);
    }
  }, [config]);

  // Connect to gateway
  const connect = useCallback(async (newConfig: ClawdBotConfig): Promise<boolean> => {
    saveConfig(newConfig);
    setIsConnecting(true);
    
    try {
      const url = newConfig.gatewayUrl.replace(/\/$/, "");
      const response = await fetch(`${url}/api/v1/status`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${newConfig.token}`,
          "Content-Type": "application/json",
        },
      });
      
      if (!response.ok) {
        throw new Error(`Connection failed: ${response.status}`);
      }
      
      const data = await response.json();
      setStatus({
        connected: true,
        version: data.version,
        uptime: data.uptime,
        channels: data.channels || [],
        agentName: data.agent?.name || "Clawd",
      });
      
      toast({ title: "Connected to ClawdBot", description: `Gateway v${data.version}` });
      return true;
    } catch (error) {
      console.error("ClawdBot connection failed:", error);
      setStatus({ connected: false });
      toast({ 
        title: "Connection Failed", 
        description: "Could not connect to ClawdBot gateway",
        variant: "destructive" 
      });
      return false;
    } finally {
      setIsConnecting(false);
    }
  }, [saveConfig, toast]);

  // Send message via OpenAI-compatible API
  const sendMessage = useCallback(async (content: string): Promise<string | null> => {
    if (!config || !status.connected) {
      toast({ title: "Not Connected", variant: "destructive" });
      return null;
    }
    
    const userMessage: ClawdMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date(),
    };
    
    setMessages(prev => [...prev, userMessage]);
    setIsTyping(true);
    
    try {
      const url = config.gatewayUrl.replace(/\/$/, "");
      const response = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-3-sonnet",
          messages: [
            ...messages.map(m => ({ role: m.role, content: m.content })),
            { role: "user", content },
          ],
          stream: false,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }
      
      const data = await response.json();
      const assistantContent = data.choices?.[0]?.message?.content || "No response";
      
      const assistantMessage: ClawdMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: assistantContent,
        timestamp: new Date(),
      };
      
      setMessages(prev => [...prev, assistantMessage]);
      return assistantContent;
    } catch (error) {
      console.error("ClawdBot message failed:", error);
      toast({ 
        title: "Message Failed", 
        description: "Could not send message to ClawdBot",
        variant: "destructive" 
      });
      return null;
    } finally {
      setIsTyping(false);
    }
  }, [config, status.connected, messages, toast]);

  // Invoke a tool/skill directly
  const invokeTool = useCallback(async (
    toolName: string, 
    params: Record<string, unknown>
  ): Promise<unknown> => {
    if (!config || !status.connected) {
      throw new Error("Not connected to ClawdBot");
    }
    
    try {
      const url = config.gatewayUrl.replace(/\/$/, "");
      const response = await fetch(`${url}/tools/invoke`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tool: toolName,
          parameters: params,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Tool invocation failed: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error("Tool invocation failed:", error);
      throw error;
    }
  }, [config, status.connected]);

  // Clear chat history
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  // Auto-reconnect on mount if config exists
  useEffect(() => {
    if (config && !status.connected && !isConnecting) {
      checkStatus();
    }
  }, [config, status.connected, isConnecting, checkStatus]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return {
    config,
    status,
    isConnecting,
    messages,
    isTyping,
    connect,
    disconnect: clearConfig,
    sendMessage,
    invokeTool,
    clearMessages,
    checkStatus,
  };
}
