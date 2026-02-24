import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Home } from "lucide-react";

export function BackButton({ showHome = true }: { showHome?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Don't show on hub (home)
  if (location.pathname === "/hub") return null;

  const handleBack = () => {
    // Check if there's history to go back to
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/hub");
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        onClick={handleBack}
        className="h-9 w-9 min-w-[36px]"
      >
        <ArrowLeft className="h-5 w-5" />
      </Button>
      {showHome && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/hub")}
          className="h-9 w-9 min-w-[36px]"
        >
          <Home className="h-5 w-5" />
        </Button>
      )}
    </div>
  );
}
