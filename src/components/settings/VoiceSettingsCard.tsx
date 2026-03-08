import { Mic } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface VoiceSettingsCardProps {
  wakeWord: string;
  onWakeWordChange: (value: string) => void;
}

export function VoiceSettingsCard({ wakeWord, onWakeWordChange }: VoiceSettingsCardProps) {
  return (
    <Card className="border-border/10 bg-card/40 backdrop-blur-sm rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-300">
      <CardHeader className="pb-2 pt-5 px-5">
        <CardTitle className="flex items-center gap-3 text-sm font-semibold tracking-wide uppercase text-muted-foreground">
          <div className="w-8 h-8 rounded-xl bg-accent-purple/10 flex items-center justify-center">
            <Mic className="h-4 w-4 text-[hsl(var(--accent-purple))]" />
          </div>
          Voice
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-1">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Wake Word</Label>
          <Input
            value={wakeWord}
            onChange={(e) => onWakeWordChange(e.target.value)}
            className="h-10 text-sm rounded-xl bg-secondary/30 border-border/10 focus:border-primary/40 transition-colors"
          />
        </div>
      </CardContent>
    </Card>
  );
}
