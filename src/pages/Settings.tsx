import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Settings2, User, Bell, Shield, Palette, Mic, Monitor, Link2, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Settings() {
  const [wakeWord, setWakeWord] = useState("Hey Jarvis");
  const [unlockPin, setUnlockPin] = useState("1212");
  const [notifications, setNotifications] = useState(true);
  const { toast } = useToast();

  const handleSave = () => {
    toast({ title: "Settings Saved", description: "Your preferences have been updated" });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in max-w-4xl">
        <div>
          <h1 className="text-3xl font-bold neon-text">Settings</h1>
          <p className="text-muted-foreground">Configure your Jarvis assistant</p>
        </div>

        <div className="grid gap-6">
          <Card className="glass-dark border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Mic className="h-5 w-5 text-primary" />Voice Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Wake Word</Label>
                <Input value={wakeWord} onChange={(e) => setWakeWord(e.target.value)} />
                <p className="text-sm text-muted-foreground">Say this phrase to activate voice commands</p>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-dark border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5 text-primary" />Security</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Unlock PIN</Label>
                <Input type="password" value={unlockPin} onChange={(e) => setUnlockPin(e.target.value)} maxLength={4} />
                <p className="text-sm text-muted-foreground">4-digit PIN to unlock your PC remotely</p>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-dark border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Monitor className="h-5 w-5 text-primary" />Device Connection</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/30">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-neon-green animate-pulse" />
                  <div>
                    <p className="font-medium">My PC</p>
                    <p className="text-sm text-muted-foreground">Connected via Python Agent</p>
                  </div>
                </div>
                <Badge className="bg-neon-green/10 text-neon-green border-neon-green/30">Online</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-dark border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5 text-primary" />Notifications</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Push Notifications</p>
                  <p className="text-sm text-muted-foreground">Receive alerts from your PC</p>
                </div>
                <Switch checked={notifications} onCheckedChange={setNotifications} />
              </div>
            </CardContent>
          </Card>

          <Button onClick={handleSave} className="gradient-primary w-full"><Check className="h-4 w-4 mr-2" />Save Settings</Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
