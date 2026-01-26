import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Home } from "lucide-react";

export function BackButton({ showHome = true }: { showHome?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Don't show on hub (home)
  if (location.pathname === "/hub") return null;

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => navigate(-1)}
        className="h-8 w-8"
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      {showHome && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/hub")}
          className="h-8 w-8"
        >
          <Home className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
