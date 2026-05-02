/**
 * SuppressedCommandBadge — small pill showing how many outgoing commands have
 * been throttled / de-duplicated by the client. Click to reset the counter.
 */
import { useEffect, useState } from "react";
import { ShieldOff } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getSuppressedCount,
  resetSuppressedCount,
  subscribeSuppressed,
} from "@/lib/commandThrottle";

interface Props {
  className?: string;
}

export function SuppressedCommandBadge({ className }: Props) {
  const [count, setCount] = useState(getSuppressedCount());

  useEffect(() => {
    return subscribeSuppressed(() => setCount(getSuppressedCount()));
  }, []);

  if (count === 0) return null;

  return (
    <button
      type="button"
      onClick={resetSuppressedCount}
      title="Commands suppressed by rate-limiter / de-dup. Click to reset."
      className={cn(
        "flex items-center gap-1 px-2 py-1 rounded-lg border border-amber-500/30",
        "bg-amber-500/10 text-amber-400 text-[10px] font-mono font-semibold",
        "hover:bg-amber-500/20 transition-colors",
        className
      )}
    >
      <ShieldOff className="h-3 w-3" />
      {count} suppressed
    </button>
  );
}
