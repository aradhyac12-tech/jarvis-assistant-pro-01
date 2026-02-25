import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Bell, BellOff, X, Trash2, Shield, Loader2,
  Clipboard, Send, FileUp, MessageSquare, Reply,
  Smartphone, Monitor, ArrowRight, ExternalLink,
  ClipboardPaste, FolderOpen, Link2, Image, Terminal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useNotificationListener, getAppInfo } from "@/hooks/useNotificationListener";
import { useToast } from "@/hooks/use-toast";

interface KDENotificationPanelProps {
  className?: string;
  onSendClipboard?: () => void;
  onOpenFileTransfer?: () => void;
  onSendCommand?: (cmd: string, payload: Record<string, unknown>) => void;
  isConnected?: boolean;
}

export function KDENotificationPanel({
  className,
  onSendClipboard,
  onOpenFileTransfer,
  onSendCommand,
  isConnected = false,
}: KDENotificationPanelProps) {
  const {
    notifications,
    isListening,
    isNative,
    permissionGranted,
    startListening,
    stopListening,
    dismissNotification,
    clearAll,
  } = useNotificationListener();
  const { toast } = useToast();

  const [toggling, setToggling] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [expandedNotif, setExpandedNotif] = useState<string | null>(null);
  const [commandText, setCommandText] = useState("");
  const [sendingCommand, setSendingCommand] = useState(false);

  const handleToggle = async () => {
    setToggling(true);
    try {
      if (isListening) await stopListening();
      else await startListening();
    } finally {
      setToggling(false);
    }
  };

  const formatTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h`;
    return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const handleSendClipboard = useCallback(() => {
    if (onSendClipboard) onSendClipboard();
    else if (onSendCommand) {
      onSendCommand("clipboard_sync", { direction: "phone_to_pc" });
      toast({ title: "📋 Clipboard sent to PC" });
    }
  }, [onSendClipboard, onSendCommand, toast]);

  const handleReceiveClipboard = useCallback(() => {
    if (onSendCommand) {
      onSendCommand("clipboard_sync", { direction: "pc_to_phone" });
      toast({ title: "📋 Clipboard received from PC" });
    }
  }, [onSendCommand, toast]);

  const handleShareUrl = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && (text.startsWith("http://") || text.startsWith("https://"))) {
        if (onSendCommand) {
          onSendCommand("open_url", { url: text });
          toast({ title: "🔗 URL opened on PC", description: text.slice(0, 60) });
        }
      } else {
        toast({ title: "No URL in clipboard", variant: "destructive" });
      }
    } catch {
      toast({ title: "Clipboard access denied", variant: "destructive" });
    }
  }, [onSendCommand, toast]);

  const handleReply = useCallback((notifId: string) => {
    if (!replyText.trim()) return;
    // In a real implementation, this would use Android's notification reply action
    toast({ title: "Reply sent", description: replyText.slice(0, 40) });
    setReplyText("");
    setReplyingTo(null);
  }, [replyText, toast]);

  const handleRunCommand = useCallback(async () => {
    if (!commandText.trim() || !onSendCommand) return;
    setSendingCommand(true);
    try {
      onSendCommand("run_command", { command: commandText.trim() });
      toast({ title: "⚡ Command sent", description: commandText.trim().slice(0, 60) });
      setCommandText("");
    } finally {
      setSendingCommand(false);
    }
  }, [commandText, onSendCommand, toast]);

  const handleScreenshot = useCallback(() => {
    if (onSendCommand) {
      onSendCommand("take_screenshot", { save: true });
      toast({ title: "📸 Screenshot taken on PC" });
    }
  }, [onSendCommand, toast]);

  const activeNotifications = notifications.filter(n => !n.dismissed);
  const unreadCount = activeNotifications.length;

  // Quick action buttons (KDE Connect style)
  const quickActions = [
    { icon: <Clipboard className="h-4 w-4" />, label: "Send Clipboard", action: handleSendClipboard, color: "text-blue-400" },
    { icon: <ClipboardPaste className="h-4 w-4" />, label: "Get Clipboard", action: handleReceiveClipboard, color: "text-cyan-400" },
    { icon: <FileUp className="h-4 w-4" />, label: "Send Files", action: onOpenFileTransfer || (() => {}), color: "text-emerald-400" },
    { icon: <Link2 className="h-4 w-4" />, label: "Share URL", action: handleShareUrl, color: "text-purple-400" },
    { icon: <Image className="h-4 w-4" />, label: "Screenshot", action: handleScreenshot, color: "text-amber-400" },
    { icon: <FolderOpen className="h-4 w-4" />, label: "Browse Files", action: () => { if (onSendCommand) onSendCommand("open_file_manager", {}); }, color: "text-orange-400" },
  ];

  return (
    <Card className={cn("border-border/50 overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <div className={cn(
            "p-1.5 rounded-lg relative",
            isListening ? "bg-primary/10" : "bg-muted"
          )}>
            <Bell className={cn("h-4 w-4", isListening ? "text-primary" : "text-muted-foreground")} />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </div>
          <span className="font-semibold text-sm">Notifications</span>
        </div>
        <div className="flex items-center gap-2">
          {isListening && activeNotifications.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={clearAll}>
              <Trash2 className="h-3 w-3" /> Clear
            </Button>
          )}
          <Button
            variant={isListening ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={handleToggle}
            disabled={toggling}
          >
            {toggling ? <Loader2 className="h-3 w-3 animate-spin" /> : isListening ? "On" : "Off"}
          </Button>
        </div>
      </div>

      {isListening && isNative && !permissionGranted && (
        <div className="flex items-center gap-2 text-xs text-amber-500 px-4 pb-2">
          <Shield className="h-3 w-3" />
          <span>Grant notification access in Android Settings</span>
        </div>
      )}

      <CardContent className="p-0">
        {/* === QUICK ACTIONS (KDE Connect style) === */}
        {isConnected && (
          <div className="px-3 pt-2 pb-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2 px-1">Quick Actions</p>
            <div className="grid grid-cols-3 gap-1.5">
              {quickActions.map((qa) => (
                <Button
                  key={qa.label}
                  variant="outline"
                  size="sm"
                  className="h-auto py-2.5 px-2 flex flex-col items-center gap-1.5 border-border/20 bg-card/30 hover:bg-secondary/50 active:scale-95 transition-all"
                  onClick={qa.action}
                >
                  <span className={qa.color}>{qa.icon}</span>
                  <span className="text-[10px] font-medium leading-tight text-center">{qa.label}</span>
                </Button>
              ))}
            </div>
            {/* Command input bar */}
            <div className="mt-2 flex gap-1.5">
              <div className="relative flex-1">
                <Terminal className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={commandText}
                  onChange={(e) => setCommandText(e.target.value)}
                  placeholder="Run command on PC..."
                  className="h-8 text-xs pl-8 bg-card/50 border-border/20"
                  onKeyDown={(e) => { if (e.key === "Enter") handleRunCommand(); }}
                />
              </div>
              <Button
                size="sm"
                className="h-8 px-2.5"
                onClick={handleRunCommand}
                disabled={!commandText.trim() || sendingCommand}
              >
                {sendingCommand ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              </Button>
            </div>
          </div>
        )}

        {/* Divider */}
        {isConnected && <div className="h-px bg-border/20 mx-3" />}

        {/* === NOTIFICATIONS LIST === */}
        {!isListening ? (
          <div className="px-4 pb-4 pt-3">
            <div className="p-4 rounded-xl bg-muted/30 flex flex-col items-center text-center">
              <BellOff className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-xs text-muted-foreground">
                Enable to mirror phone notifications to PC
              </p>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 mt-2">
                <Smartphone className="h-3 w-3" />
                <ArrowRight className="h-3 w-3" />
                <Monitor className="h-3 w-3" />
              </div>
            </div>
          </div>
        ) : (
          <ScrollArea className="h-52">
            {activeNotifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <Bell className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-xs">Waiting for notifications...</p>
              </div>
            ) : (
              <div className="px-3 pb-3 pt-2 space-y-1.5">
                {activeNotifications.map((notif) => {
                  const appInfo = getAppInfo(notif.packageName, notif.appName);
                  const isExpanded = expandedNotif === notif.id;
                  const isReplying = replyingTo === notif.id;
                  const isMessaging = ["whatsapp", "telegram", "messenger", "signal", "sms"].some(
                    app => notif.packageName?.toLowerCase().includes(app) || notif.appName?.toLowerCase().includes(app)
                  );

                  return (
                    <div key={notif.id} className="group relative">
                      <div
                        className={cn(
                          "flex items-start gap-3 p-3 rounded-xl transition-colors cursor-pointer",
                          isExpanded ? "bg-secondary/40 border border-border/30" : "bg-muted/20 hover:bg-muted/40"
                        )}
                        onClick={() => setExpandedNotif(isExpanded ? null : notif.id)}
                      >
                        <div
                          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-lg"
                          style={{ backgroundColor: `${appInfo.color}20` }}
                        >
                          {appInfo.emoji}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm truncate">
                              {notif.title || appInfo.name}
                            </span>
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {formatTime(notif.timestamp)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{notif.text}</p>
                          {notif.textLines.length > 1 && !isExpanded && (
                            <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                              +{notif.textLines.length - 1} more
                            </p>
                          )}
                          {isExpanded && notif.textLines.length > 1 && (
                            <div className="mt-1 space-y-0.5">
                              {notif.textLines.slice(1).map((line, i) => (
                                <p key={i} className="text-[11px] text-muted-foreground">{line}</p>
                              ))}
                            </div>
                          )}
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 mt-1.5 font-normal">
                            {appInfo.name}
                          </Badge>
                        </div>

                        <Button
                          variant="ghost" size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 absolute top-2 right-2"
                          onClick={(e) => { e.stopPropagation(); dismissNotification(notif.id); }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>

                      {/* Expanded action buttons */}
                      {isExpanded && (
                        <div className="flex gap-1 mt-1 pl-12">
                          {isMessaging && (
                            <Button
                              variant="ghost" size="sm"
                              className="h-7 text-[10px] gap-1 text-blue-400"
                              onClick={() => { setReplyingTo(isReplying ? null : notif.id); setReplyText(""); }}
                            >
                              <Reply className="h-3 w-3" /> Reply
                            </Button>
                          )}
                          <Button
                            variant="ghost" size="sm"
                            className="h-7 text-[10px] gap-1"
                            onClick={() => {
                              navigator.clipboard.writeText(notif.text || "");
                              toast({ title: "Copied to clipboard" });
                            }}
                          >
                            <Clipboard className="h-3 w-3" /> Copy
                          </Button>
                          <Button
                            variant="ghost" size="sm"
                            className="h-7 text-[10px] gap-1"
                            onClick={(e) => { e.stopPropagation(); dismissNotification(notif.id); }}
                          >
                            <X className="h-3 w-3" /> Dismiss
                          </Button>
                        </div>
                      )}

                      {/* Reply input */}
                      {isReplying && (
                        <div className="flex gap-1.5 mt-1.5 pl-12 pr-2">
                          <Input
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            placeholder="Type reply..."
                            className="h-8 text-xs bg-card/50"
                            autoFocus
                            onKeyDown={(e) => { if (e.key === "Enter") handleReply(notif.id); }}
                          />
                          <Button
                            size="sm" className="h-8 px-2"
                            onClick={() => handleReply(notif.id)}
                            disabled={!replyText.trim()}
                          >
                            <Send className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
