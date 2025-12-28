import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Keyboard, Mouse, Clipboard, Monitor, Send, Copy, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export default function RemoteControl() {
  const [textInput, setTextInput] = useState("");
  const [clipboardText, setClipboardText] = useState("");
  const { toast } = useToast();

  const sendKeyboard = (text: string) => {
    toast({ title: "Text Sent", description: `Typing: ${text.slice(0, 20)}...` });
    setTextInput("");
  };

  const sendKey = (key: string) => {
    toast({ title: "Key Pressed", description: key });
  };

  const quickKeys = [
    { label: "Enter", key: "Enter" }, { label: "Esc", key: "Escape" }, { label: "Tab", key: "Tab" },
    { label: "Space", key: "Space" }, { label: "Backspace", key: "Backspace" }, { label: "Delete", key: "Delete" },
    { label: "Ctrl+C", key: "Ctrl+C" }, { label: "Ctrl+V", key: "Ctrl+V" }, { label: "Ctrl+Z", key: "Ctrl+Z" },
    { label: "Alt+Tab", key: "Alt+Tab" }, { label: "Win", key: "Win" }, { label: "Ctrl+A", key: "Ctrl+A" },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold neon-text">Remote Control</h1>
          <p className="text-muted-foreground">Control your PC remotely</p>
        </div>

        <Tabs defaultValue="keyboard" className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-6">
            <TabsTrigger value="keyboard"><Keyboard className="h-4 w-4 mr-2" />Keyboard</TabsTrigger>
            <TabsTrigger value="trackpad"><Mouse className="h-4 w-4 mr-2" />Trackpad</TabsTrigger>
            <TabsTrigger value="clipboard"><Clipboard className="h-4 w-4 mr-2" />Clipboard</TabsTrigger>
            <TabsTrigger value="screen"><Monitor className="h-4 w-4 mr-2" />Screen</TabsTrigger>
          </TabsList>

          <TabsContent value="keyboard">
            <Card className="glass-dark border-border/50">
              <CardHeader>
                <CardTitle>Virtual Keyboard</CardTitle>
                <CardDescription>Type text to send to your PC</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Textarea placeholder="Type here..." value={textInput} onChange={(e) => setTextInput(e.target.value)} className="min-h-[100px]" />
                </div>
                <Button className="w-full gradient-primary" onClick={() => sendKeyboard(textInput)} disabled={!textInput}>
                  <Send className="h-4 w-4 mr-2" /> Send Text
                </Button>
                <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
                  {quickKeys.map((k) => (
                    <Button key={k.key} variant="secondary" size="sm" onClick={() => sendKey(k.key)}>{k.label}</Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="trackpad">
            <Card className="glass-dark border-border/50">
              <CardHeader>
                <CardTitle>Virtual Trackpad</CardTitle>
                <CardDescription>Control mouse movement</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="aspect-video bg-secondary/30 rounded-xl border-2 border-dashed border-border flex items-center justify-center">
                  <p className="text-muted-foreground">Drag here to move mouse</p>
                </div>
                <div className="grid grid-cols-3 gap-2 max-w-[200px] mx-auto">
                  <div /><Button variant="secondary" size="icon"><ArrowUp className="h-4 w-4" /></Button><div />
                  <Button variant="secondary" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
                  <Button variant="secondary" size="icon" className="bg-primary/20">Click</Button>
                  <Button variant="secondary" size="icon"><ArrowRight className="h-4 w-4" /></Button>
                  <div /><Button variant="secondary" size="icon"><ArrowDown className="h-4 w-4" /></Button><div />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="clipboard">
            <Card className="glass-dark border-border/50">
              <CardHeader>
                <CardTitle>Clipboard Sync</CardTitle>
                <CardDescription>Share clipboard between devices</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea placeholder="Paste text here to send to PC..." value={clipboardText} onChange={(e) => setClipboardText(e.target.value)} className="min-h-[150px]" />
                <div className="flex gap-2">
                  <Button className="flex-1 gradient-primary"><Send className="h-4 w-4 mr-2" />Send to PC</Button>
                  <Button variant="secondary" className="flex-1"><Copy className="h-4 w-4 mr-2" />Get from PC</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="screen">
            <Card className="glass-dark border-border/50">
              <CardHeader>
                <CardTitle>Screen Mirror</CardTitle>
                <CardDescription>View your PC screen</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="aspect-video bg-secondary/30 rounded-xl border border-border flex items-center justify-center">
                  <div className="text-center">
                    <Monitor className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">Connect to view screen</p>
                    <Button className="mt-4 gradient-primary">Start Screen Share</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
