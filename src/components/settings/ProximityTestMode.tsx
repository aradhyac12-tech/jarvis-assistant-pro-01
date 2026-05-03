import { useCallback, useState } from "react";
import { CheckCircle2, XCircle, Loader2, Play, RotateCcw, FlaskConical, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type StepStatus = "idle" | "running" | "pass" | "fail" | "skipped";

interface Step {
  id: string;
  label: string;
  detail?: string;
  status: StepStatus;
  message?: string;
  durationMs?: number;
}

const INITIAL_STEPS: Step[] = [
  { id: "baseline", label: "Verify agent reachable & PC unlocked", status: "idle" },
  { id: "simulate-away", label: "Simulate owner AWAY", status: "idle" },
  { id: "verify-lock", label: "Verify PC locked", detail: "Polls lock state for up to 8s", status: "idle" },
  { id: "simulate-home", label: "Simulate owner HOME", status: "idle" },
  { id: "wait-unlock-seq", label: "Wait for unlock sequence", detail: "Space → 4s → PIN → 2s → Enter", status: "idle" },
  { id: "verify-unlock", label: "Verify PC unlocked", detail: "Polls lock state for up to 15s", status: "idle" },
];

function StatusIcon({ status }: { status: StepStatus }) {
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "fail") return <XCircle className="h-4 w-4 text-destructive" />;
  if (status === "skipped") return <Clock className="h-4 w-4 text-muted-foreground" />;
  return <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />;
}

export function ProximityTestMode() {
  const { sendCommand } = useDeviceCommands();
  const { toast } = useToast();
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [running, setRunning] = useState(false);
  const [overall, setOverall] = useState<"idle" | "pass" | "fail">("idle");

  const updateStep = useCallback((id: string, patch: Partial<Step>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const pollLockState = useCallback(
    async (expected: boolean, timeoutMs: number, intervalMs = 1000) => {
      const start = Date.now();
      let last: boolean | null = null;
      while (Date.now() - start < timeoutMs) {
        const res = await sendCommand("get_lock_state", {}, { awaitResult: true, timeoutMs: 5000 });
        const locked = (res as any)?.result?.is_locked;
        if (typeof locked === "boolean") {
          last = locked;
          if (locked === expected) return { ok: true, locked, elapsed: Date.now() - start };
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      return { ok: false, locked: last, elapsed: Date.now() - start };
    },
    [sendCommand]
  );

  const reset = useCallback(() => {
    setSteps(INITIAL_STEPS.map((s) => ({ ...s, status: "idle", message: undefined, durationMs: undefined })));
    setOverall("idle");
  }, []);

  const runTest = useCallback(async () => {
    setRunning(true);
    setOverall("idle");
    setSteps(INITIAL_STEPS.map((s) => ({ ...s, status: "idle", message: undefined, durationMs: undefined })));

    const fail = (id: string, msg: string) => {
      updateStep(id, { status: "fail", message: msg });
      setOverall("fail");
      toast({ title: "Test failed", description: msg, variant: "destructive" });
    };

    try {
      // Step 1 — baseline
      updateStep("baseline", { status: "running" });
      const t0 = Date.now();
      const baseline = await sendCommand("get_lock_state", {}, { awaitResult: true, timeoutMs: 6000 });
      const baselineLocked = (baseline as any)?.result?.is_locked;
      if ((baseline as any)?.success === false || typeof baselineLocked !== "boolean") {
        fail("baseline", "Could not reach PC agent. Make sure it's running and connected.");
        return;
      }
      if (baselineLocked) {
        updateStep("baseline", {
          status: "pass",
          message: "PC currently locked — will simulate HOME first to start clean.",
          durationMs: Date.now() - t0,
        });
        // Pre-unlock for clean test
        await sendCommand("proximity_simulate", { state: "home" }, { awaitResult: true, timeoutMs: 8000 });
        await new Promise((r) => setTimeout(r, 12000));
      } else {
        updateStep("baseline", { status: "pass", message: "PC unlocked & agent reachable.", durationMs: Date.now() - t0 });
      }

      // Step 2 — simulate away
      updateStep("simulate-away", { status: "running" });
      const t1 = Date.now();
      const away = await sendCommand("proximity_simulate", { state: "away" }, { awaitResult: true, timeoutMs: 8000 });
      if ((away as any)?.success === false) {
        fail("simulate-away", (away as any)?.error || "Simulate-away command failed");
        return;
      }
      updateStep("simulate-away", { status: "pass", message: "AWAY signal sent.", durationMs: Date.now() - t1 });

      // Step 3 — verify locked
      updateStep("verify-lock", { status: "running" });
      const t2 = Date.now();
      const lockResult = await pollLockState(true, 10000, 800);
      if (!lockResult.ok) {
        fail("verify-lock", `PC did not lock within 10s (last state: ${lockResult.locked === null ? "unknown" : lockResult.locked ? "locked" : "unlocked"})`);
        return;
      }
      updateStep("verify-lock", { status: "pass", message: `Locked after ${(lockResult.elapsed / 1000).toFixed(1)}s.`, durationMs: lockResult.elapsed });

      // Step 4 — simulate home
      updateStep("simulate-home", { status: "running" });
      const t3 = Date.now();
      const home = await sendCommand("proximity_simulate", { state: "home" }, { awaitResult: true, timeoutMs: 8000 });
      if ((home as any)?.success === false) {
        fail("simulate-home", (home as any)?.error || "Simulate-home command failed");
        return;
      }
      updateStep("simulate-home", { status: "pass", message: "HOME signal sent — unlock sequence starting.", durationMs: Date.now() - t3 });

      // Step 5 — wait unlock sequence (Space → 4s → PIN → 2s → Enter ≈ 9s)
      updateStep("wait-unlock-seq", { status: "running", message: "Waiting ~10s for keystroke sequence…" });
      const t4 = Date.now();
      await new Promise((r) => setTimeout(r, 10000));
      updateStep("wait-unlock-seq", { status: "pass", message: "Sequence window elapsed.", durationMs: Date.now() - t4 });

      // Step 6 — verify unlocked
      updateStep("verify-unlock", { status: "running" });
      const t5 = Date.now();
      const unlockResult = await pollLockState(false, 15000, 1000);
      if (!unlockResult.ok) {
        fail("verify-unlock", `PC still locked after unlock sequence. Check PIN matches Windows password (current: ${unlockResult.locked === null ? "unknown" : unlockResult.locked ? "locked" : "unlocked"}).`);
        return;
      }
      updateStep("verify-unlock", { status: "pass", message: `Unlocked after ${(unlockResult.elapsed / 1000).toFixed(1)}s.`, durationMs: unlockResult.elapsed });

      setOverall("pass");
      toast({ title: "✅ Proximity test passed", description: "Lock & unlock both work correctly." });
    } catch (e: any) {
      fail("baseline", e?.message || "Unexpected test error");
    } finally {
      setRunning(false);
    }
  }, [pollLockState, sendCommand, toast, updateStep]);

  return (
    <Card className="border-border/10 bg-card/40 backdrop-blur-sm rounded-2xl shadow-sm">
      <CardHeader className="pb-2 pt-5 px-5">
        <CardTitle className="flex items-center justify-between text-sm font-semibold tracking-wide uppercase text-muted-foreground">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
              <FlaskConical className="h-4 w-4 text-primary" />
            </div>
            Guided Test Mode
          </div>
          {overall !== "idle" && (
            <Badge
              variant={overall === "pass" ? "default" : "destructive"}
              className="gap-1 text-[10px] normal-case font-medium"
            >
              {overall === "pass" ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
              {overall === "pass" ? "All passed" : "Failed"}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-1 space-y-4">
        <p className="text-xs text-muted-foreground">
          Simulates owner AWAY then HOME and verifies your PC locks, runs the unlock sequence
          (Space → 4s → PIN → 2s → Enter), and unlocks. Run this near the PC so you can watch.
        </p>

        <div className="space-y-1.5 rounded-xl border border-border/10 bg-secondary/20 p-3">
          {steps.map((step, idx) => (
            <div
              key={step.id}
              className={cn(
                "flex items-start gap-3 py-1.5",
                idx !== steps.length - 1 && "border-b border-border/10"
              )}
            >
              <div className="mt-0.5 w-4 flex justify-center">
                <StatusIcon status={step.status} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={cn(
                    "text-xs font-medium",
                    step.status === "fail" && "text-destructive",
                    step.status === "pass" && "text-foreground",
                    step.status === "idle" && "text-muted-foreground"
                  )}>
                    {step.label}
                  </p>
                  {step.durationMs !== undefined && (
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {(step.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
                {step.detail && (
                  <p className="text-[10px] text-muted-foreground/80">{step.detail}</p>
                )}
                {step.message && (
                  <p className={cn(
                    "text-[10px] mt-0.5",
                    step.status === "fail" ? "text-destructive" : "text-muted-foreground"
                  )}>
                    {step.message}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Button
            onClick={runTest}
            disabled={running}
            className="flex-1 h-9 rounded-xl"
            size="sm"
          >
            {running ? (
              <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> Running test…</>
            ) : (
              <><Play className="h-3.5 w-3.5 mr-2" /> Run guided test</>
            )}
          </Button>
          <Button
            onClick={reset}
            disabled={running}
            variant="outline"
            size="sm"
            className="h-9 rounded-xl"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
