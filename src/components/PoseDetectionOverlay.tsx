import { useRef, useEffect, useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * MediaPipe Pose detection overlay for surveillance.
 * Draws skeletal landmarks on a canvas over the video feed.
 * Uses the MediaPipe Pose CDN for lightweight integration.
 */

interface PoseDetectionOverlayProps {
  /** The source image URL (blob URL or data URL) to analyze */
  frameUrl: string | null;
  /** Whether detection is enabled */
  enabled: boolean;
  /** Callback when a human is detected */
  onHumanDetected?: (landmarks: NormalizedLandmark[], confidence: number) => void;
  /** Overlay CSS class */
  className?: string;
}

interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

// MediaPipe Pose connections (pairs of landmark indices)
const POSE_CONNECTIONS: [number, number][] = [
  // Torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // Left arm
  [11, 13], [13, 15],
  // Right arm
  [12, 14], [14, 16],
  // Left leg
  [23, 25], [25, 27],
  // Right leg
  [24, 26], [26, 28],
  // Face outline
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  // Shoulders to ears
  [9, 10],
  // Wrists to hands
  [15, 17], [15, 19], [15, 21],
  [16, 18], [16, 20], [16, 22],
  // Ankles to feet
  [27, 29], [27, 31],
  [28, 30], [28, 32],
];

// Color palette for skeleton parts
const LIMB_COLORS: Record<string, string> = {
  torso: "#00ff88",
  leftArm: "#ff6b6b",
  rightArm: "#4ecdc4",
  leftLeg: "#ffd93d",
  rightLeg: "#6c5ce7",
  face: "#a8e6cf",
  hands: "#ff8a80",
  feet: "#80cbc4",
};

function getConnectionColor(i1: number, i2: number): string {
  if ([11, 12, 23, 24].includes(i1) && [11, 12, 23, 24].includes(i2)) return LIMB_COLORS.torso;
  if ([11, 13, 15].includes(i1) && [11, 13, 15].includes(i2)) return LIMB_COLORS.leftArm;
  if ([12, 14, 16].includes(i1) && [12, 14, 16].includes(i2)) return LIMB_COLORS.rightArm;
  if ([23, 25, 27].includes(i1) && [23, 25, 27].includes(i2)) return LIMB_COLORS.leftLeg;
  if ([24, 26, 28].includes(i1) && [24, 26, 28].includes(i2)) return LIMB_COLORS.rightLeg;
  if (i1 <= 10 && i2 <= 10) return LIMB_COLORS.face;
  if ([15, 16, 17, 18, 19, 20, 21, 22].includes(i1)) return LIMB_COLORS.hands;
  if ([27, 28, 29, 30, 31, 32].includes(i1)) return LIMB_COLORS.feet;
  return "#ffffff";
}

/**
 * Lightweight pose detection using canvas-based heuristic analysis.
 * For full MediaPipe, a CDN script would be loaded, but this provides
 * a fast CPU-based human silhouette detector using skin-tone + motion.
 */
export function PoseDetectionOverlay({
  frameUrl,
  enabled,
  onHumanDetected,
  className,
}: PoseDetectionOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyzerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevFrameRef = useRef<ImageData | null>(null);
  const [humanCount, setHumanCount] = useState(0);
  const [confidence, setConfidence] = useState(0);
  const [landmarks, setLandmarks] = useState<NormalizedLandmark[]>([]);
  const frameCountRef = useRef(0);
  const poseModelRef = useRef<any>(null);
  const loadingRef = useRef(false);

  // Load MediaPipe Pose via CDN
  const loadPoseModel = useCallback(async () => {
    if (poseModelRef.current || loadingRef.current) return;
    loadingRef.current = true;

    try {
      // Load MediaPipe scripts from CDN
      const loadScript = (src: string) =>
        new Promise<void>((resolve, reject) => {
          if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
          }
          const s = document.createElement("script");
          s.src = src;
          s.crossOrigin = "anonymous";
          s.onload = () => resolve();
          s.onerror = () => reject(new Error(`Failed to load ${src}`));
          document.head.appendChild(s);
        });

      await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/pose.js");

      const win = window as any;
      if (win.Pose) {
        const pose = new win.Pose({
          locateFile: (file: string) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`,
        });

        pose.setOptions({
          modelComplexity: 0, // Lite model for speed
          smoothLandmarks: true,
          enableSegmentation: false,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        pose.onResults((results: any) => {
          if (results.poseLandmarks && results.poseLandmarks.length > 0) {
            const lm: NormalizedLandmark[] = results.poseLandmarks.map((l: any) => ({
              x: l.x,
              y: l.y,
              z: l.z,
              visibility: l.visibility ?? 0,
            }));
            const avgVis = lm.reduce((s, l) => s + l.visibility, 0) / lm.length;
            setLandmarks(lm);
            setHumanCount(1);
            setConfidence(Math.round(avgVis * 100));
            onHumanDetected?.(lm, avgVis);
          } else {
            setLandmarks([]);
            setHumanCount(0);
            setConfidence(0);
          }
        });

        await pose.initialize();
        poseModelRef.current = pose;
        console.log("[PoseDetection] MediaPipe Pose model loaded (lite)");
      }
    } catch (err) {
      console.warn("[PoseDetection] MediaPipe load failed, using fallback:", err);
    }
    loadingRef.current = false;
  }, [onHumanDetected]);

  // Process frame
  useEffect(() => {
    if (!enabled || !frameUrl) return;

    frameCountRef.current++;
    // Only analyze every 5th frame for performance
    if (frameCountRef.current % 5 !== 0) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = async () => {
      // If MediaPipe is loaded, use it
      if (poseModelRef.current) {
        try {
          if (!analyzerCanvasRef.current) {
            analyzerCanvasRef.current = document.createElement("canvas");
          }
          const ac = analyzerCanvasRef.current;
          ac.width = img.width;
          ac.height = img.height;
          const ctx = ac.getContext("2d");
          if (!ctx) return;
          ctx.drawImage(img, 0, 0);
          await poseModelRef.current.send({ image: ac });
        } catch {
          // Silently fail individual frame
        }
      } else {
        // Fallback: simple motion-based human detection
        if (!analyzerCanvasRef.current) {
          analyzerCanvasRef.current = document.createElement("canvas");
        }
        const ac = analyzerCanvasRef.current;
        const w = Math.min(img.width, 160);
        const h = Math.round((img.height / img.width) * w);
        ac.width = w;
        ac.height = h;
        const ctx = ac.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        const frame = ctx.getImageData(0, 0, w, h);

        if (prevFrameRef.current?.width === w && prevFrameRef.current?.height === h) {
          const prev = prevFrameRef.current;
          let motionPixels = 0;
          let skinPixels = 0;
          const total = w * h;

          for (let i = 0; i < frame.data.length; i += 4) {
            const r = frame.data[i], g = frame.data[i + 1], b = frame.data[i + 2];
            // Motion detection
            const diff = Math.abs(r - prev.data[i]) + Math.abs(g - prev.data[i + 1]) + Math.abs(b - prev.data[i + 2]);
            if (diff > 40) motionPixels++;
            // Skin tone detection (rough)
            if (r > 95 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15 && r - b > 15) {
              skinPixels++;
            }
          }

          const motionPct = (motionPixels / total) * 100;
          const skinPct = (skinPixels / total) * 100;

          // Heuristic: motion + skin tone = likely human
          if (motionPct > 1 && skinPct > 2) {
            const conf = Math.min(95, Math.round((motionPct * 2 + skinPct * 3)));
            setHumanCount(1);
            setConfidence(conf);
            // Generate approximate bounding box landmarks
            const approxLandmarks: NormalizedLandmark[] = [
              { x: 0.5, y: 0.15, z: 0, visibility: 0.8 }, // nose
            ];
            setLandmarks(approxLandmarks);
            onHumanDetected?.(approxLandmarks, conf / 100);
          } else {
            setHumanCount(0);
            setConfidence(0);
            setLandmarks([]);
          }
        }
        prevFrameRef.current = frame;
      }
    };
    img.src = frameUrl;
  }, [frameUrl, enabled, onHumanDetected]);

  // Load model when enabled
  useEffect(() => {
    if (enabled) loadPoseModel();
  }, [enabled, loadPoseModel]);

  // Draw skeleton overlay
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !landmarks.length || landmarks.length < 2) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (landmarks.length >= 33) {
      // Full MediaPipe skeleton
      // Draw connections
      for (const [i1, i2] of POSE_CONNECTIONS) {
        const l1 = landmarks[i1];
        const l2 = landmarks[i2];
        if (!l1 || !l2 || l1.visibility < 0.3 || l2.visibility < 0.3) continue;

        const color = getConnectionColor(i1, i2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.shadowColor = color;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(l1.x * canvas.width, l1.y * canvas.height);
        ctx.lineTo(l2.x * canvas.width, l2.y * canvas.height);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Draw landmarks
      for (let i = 0; i < landmarks.length; i++) {
        const lm = landmarks[i];
        if (lm.visibility < 0.3) continue;

        const x = lm.x * canvas.width;
        const y = lm.y * canvas.height;
        const radius = i <= 10 ? 3 : 5;

        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }, [landmarks]);

  if (!enabled) return null;

  return (
    <div className={cn("absolute inset-0 pointer-events-none", className)}>
      <canvas
        ref={canvasRef}
        width={640}
        height={480}
        className="absolute inset-0 w-full h-full"
      />
      {/* Human detection badge */}
      <div className="absolute top-2 left-2 flex gap-1">
        {humanCount > 0 ? (
          <Badge className="bg-red-500/90 text-white border-red-600 text-[10px] gap-1 animate-pulse">
            🧍 Human Detected ({confidence}%)
          </Badge>
        ) : (
          <Badge variant="secondary" className="bg-black/50 backdrop-blur text-[10px]">
            👁 Scanning...
          </Badge>
        )}
      </div>
    </div>
  );
}
