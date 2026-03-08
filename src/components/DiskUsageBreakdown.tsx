import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  HardDrive, RefreshCw, Loader2, ChevronDown, ChevronUp,
  FolderOpen, Database,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";

interface DriveInfo {
  drive: string;
  label?: string;
  total_gb: number;
  used_gb: number;
  free_gb: number;
  percent: number;
  fs_type?: string;
}

interface FolderSize {
  path: string;
  size_gb: number;
  size_display?: string;
}

function formatGB(gb: number): string {
  if (gb >= 1000) return `${(gb / 1000).toFixed(1)} TB`;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(gb * 1024).toFixed(0)} MB`;
}

function getUsageColor(percent: number): string {
  if (percent >= 90) return "bg-destructive";
  if (percent >= 75) return "bg-amber-500";
  return "bg-primary";
}

export function DiskUsageBreakdown({ className }: { className?: string }) {
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();
  const isConnected = selectedDevice?.is_online || false;

  const [expanded, setExpanded] = useState(false);
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [folders, setFolders] = useState<FolderSize[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDrive, setSelectedDrive] = useState<string | null>(null);
  const [foldersLoading, setFoldersLoading] = useState(false);

  const fetchDrives = useCallback(async () => {
    if (!isConnected) return;
    setLoading(true);
    try {
      const result = await sendCommand("get_disk_usage", {}, { awaitResult: true, timeoutMs: 10000 });
      if (result.success && "result" in result) {
        const r = result.result as any;
        const driveList = r.drives || r.partitions || r.disks || [];
        setDrives(driveList);
        if (driveList.length > 0 && !selectedDrive) {
          setSelectedDrive(driveList[0].drive);
        }
      }
    } catch {}
    setLoading(false);
  }, [isConnected, sendCommand, selectedDrive]);

  const fetchFolders = useCallback(async (drive: string) => {
    if (!isConnected) return;
    setFoldersLoading(true);
    setSelectedDrive(drive);
    try {
      const result = await sendCommand("get_folder_sizes", { path: drive }, { awaitResult: true, timeoutMs: 15000 });
      if (result.success && "result" in result) {
        const r = result.result as any;
        const folderList = r.folders || r.items || [];
        setFolders(
          folderList
            .filter((f: FolderSize) => f.size_gb > 0.01)
            .sort((a: FolderSize, b: FolderSize) => b.size_gb - a.size_gb)
            .slice(0, 15)
        );
      }
    } catch {}
    setFoldersLoading(false);
  }, [isConnected, sendCommand]);

  if (!isConnected) return null;

  return (
    <Card className={cn("border-border/20 bg-card/50", className)}>
      <button
        className="w-full"
        onClick={() => {
          const next = !expanded;
          setExpanded(next);
          if (next && drives.length === 0) fetchDrives();
        }}
      >
        <CardHeader className="pb-1.5 pt-3 px-3">
          <CardTitle className="text-xs flex items-center gap-2">
            <Database className="h-3.5 w-3.5 text-primary" />
            Disk Usage
            {drives.length > 0 && (
              <Badge variant="secondary" className="text-[8px] h-3.5 px-1 ml-1">
                {drives.length} drive{drives.length !== 1 ? "s" : ""}
              </Badge>
            )}
            <div className="ml-auto">
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </div>
          </CardTitle>
        </CardHeader>
      </button>

      {expanded && (
        <CardContent className="px-3 pb-3 pt-0 space-y-2">
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : drives.length === 0 ? (
            <div className="text-center py-3">
              <p className="text-[10px] text-muted-foreground">No drive data</p>
              <Button variant="ghost" size="sm" className="h-6 text-[10px] mt-1" onClick={fetchDrives}>
                <RefreshCw className="h-3 w-3 mr-1" /> Fetch
              </Button>
            </div>
          ) : (
            <>
              {/* Drives */}
              <div className="space-y-1.5">
                {drives.map((drive) => (
                  <button
                    key={drive.drive}
                    className={cn(
                      "w-full rounded-lg border p-2 text-left transition-colors",
                      selectedDrive === drive.drive
                        ? "border-primary/40 bg-primary/5"
                        : "border-border/20 bg-secondary/5 hover:bg-secondary/10"
                    )}
                    onClick={() => fetchFolders(drive.drive)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-medium flex items-center gap-1">
                        <HardDrive className="h-3 w-3 text-muted-foreground" />
                        {drive.drive}
                        {drive.label && (
                          <span className="text-muted-foreground font-normal">({drive.label})</span>
                        )}
                      </span>
                      <span className={cn(
                        "text-[10px] font-mono font-bold",
                        drive.percent >= 90 ? "text-destructive" : drive.percent >= 75 ? "text-amber-500" : "text-foreground"
                      )}>
                        {Math.round(drive.percent)}%
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden bg-muted">
                      <div
                        className={cn("h-full rounded-full transition-all", getUsageColor(drive.percent))}
                        style={{ width: `${Math.min(100, drive.percent)}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-[8px] text-muted-foreground">
                        {formatGB(drive.used_gb)} used
                      </span>
                      <span className="text-[8px] text-muted-foreground">
                        {formatGB(drive.free_gb)} free / {formatGB(drive.total_gb)}
                      </span>
                    </div>
                    {drive.fs_type && (
                      <Badge variant="outline" className="text-[7px] h-3 px-1 mt-1">
                        {drive.fs_type}
                      </Badge>
                    )}
                  </button>
                ))}
              </div>

              {/* Folder breakdown */}
              {selectedDrive && (
                <div className="rounded-lg border border-border/20 bg-secondary/5 overflow-hidden">
                  <div className="flex items-center justify-between px-2 py-1.5 border-b border-border/10">
                    <span className="text-[9px] text-muted-foreground font-medium flex items-center gap-1">
                      <FolderOpen className="h-3 w-3" /> Top folders on {selectedDrive}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 text-[9px] gap-1"
                      onClick={() => fetchFolders(selectedDrive)}
                      disabled={foldersLoading}
                    >
                      <RefreshCw className="h-2.5 w-2.5" />
                    </Button>
                  </div>

                  {foldersLoading ? (
                    <div className="flex justify-center py-3">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : folders.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground text-center py-3">
                      Tap a drive above to scan folders
                    </p>
                  ) : (
                    <ScrollArea className="max-h-48">
                      <div className="divide-y divide-border/10">
                        {folders.map((folder, i) => {
                          const maxSize = folders[0]?.size_gb || 1;
                          const barWidth = Math.max(2, (folder.size_gb / maxSize) * 100);
                          return (
                            <div key={folder.path} className="px-2 py-1.5 space-y-0.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-medium truncate max-w-[65%]">
                                  {folder.path.split(/[/\\]/).pop() || folder.path}
                                </span>
                                <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                                  {folder.size_display || formatGB(folder.size_gb)}
                                </span>
                              </div>
                              <div className="h-1 rounded-full overflow-hidden bg-muted">
                                <div
                                  className="h-full rounded-full bg-primary/60 transition-all"
                                  style={{ width: `${barWidth}%` }}
                                />
                              </div>
                              <p className="text-[8px] text-muted-foreground truncate">{folder.path}</p>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              )}

              <div className="flex justify-end">
                <Button variant="ghost" size="sm" className="h-5 text-[9px] gap-1" onClick={fetchDrives} disabled={loading}>
                  <RefreshCw className="h-2.5 w-2.5" /> Refresh Drives
                </Button>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
