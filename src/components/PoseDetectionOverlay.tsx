import { useRef, useEffect, useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * MediaPipe Pose detection overlay for surveillance.
 * Always-on when enabled — no toggle needed.
 * Draws proper skeletal landmarks covering the full body.
 */

interface PoseDetectionOverlayProps {
  frameUrl: string | null;
  enabled: boolean;
  onHumanDetected?: (landmarks: NormalizedLandmark[], confidence: number) => void;
  className?: string;
}

interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

// MediaPipe Pose connections
const POSE_CONNECTIONS: [number, number][] = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15],
  [12, 14], [14, 16],
  [23, 25], [25, 27],
  [24, 26], [26, 28],
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10],
  [15, 17], [15, 19], [15, 21],
  [16, 18], [16, 20], [16, 22],
  [27, 29], [27, 31],
  [28, 30], [28, 32],
];

// Body part groupings for coloring
function getConnectionColor(i1: number, i2: number): string {
  if ([11, 12, 23, 24].includes(i1) && [11, 12, 23, 24].includes(i2)) return "#00ff88";
  if ([11, 13, 15].includes(i1) && [11, 13, 15].includes(i2)) return "#ff6b6b";
  if ([12, 14, 16].includes(i1) && [12, 14, 16].includes(i2)) return "#4ecdc4";
  if ([23, 25, 27].includes(i1) && [23, 25, 27].includes(i2)) return "#ffd93d";
  if ([24, 26, 28].includes(i1) && [24, 26, 28].includes(i2)) return "#6c5ce7";
  if (i1 <= 10 && i2 <= 10) return "#a8e6cf";
  if ([15, 16, 17, 18, 19, 20, 21, 22].includes(i1)) return "#ff8a80";
  if ([27, 28, 29, 30, 31, 32].includes(i1)) return "#80cbc4";
  return "#ffffff";
}

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
  // Single notification guard — only notify once per detection session
  const hasNotifiedRef = useRef(false);

  // Load MediaPipe Pose via CDN
  const loadPoseModel = useCallback(async () => {
    if (poseModelRef.current || loadingRef.current) return;
    loadingRef.current = true;

    try {
      const loadScript = (src: string) =>
        new Promise<void>((resolve, reject) => {
          if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
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
          modelComplexity: 1, // Full model for better body coverage
          smoothLandmarks: true,
          enableSegmentation: false,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        pose.onResults((results: any) => {
          if (results.poseLandmarks && results.poseLandmarks.length > 0) {
            const lm: NormalizedLandmark[] = results.poseLandmarks.map((l: any) => ({
              x: l.x, y: l.y, z: l.z, visibility: l.visibility ?? 0,
            }));
            const avgVis = lm.reduce((s, l) => s + l.visibility, 0) / lm.length;
            setLandmarks(lm);
            setHumanCount(1);
            setConfidence(Math.round(avgVis * 100));
            // Only notify ONCE per detection session
            if (!hasNotifiedRef.current) {
              hasNotifiedRef.current = true;
              onHumanDetected?.(lm, avgVis);
            }
          } else {
            setLandmarks([]);
            setHumanCount(0);
            setConfidence(0);
            // Reset notification guard when no human detected
            hasNotifiedRef.current = false;
          }
        });

        await pose.initialize();
        poseModelRef.current = pose;
        console.log("[PoseDetection] MediaPipe Pose model loaded");
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
    if (frameCountRef.current % 5 !== 0) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = async () => {
      if (poseModelRef.current) {
        try {
          if (!analyzerCanvasRef.current) analyzerCanvasRef.current = document.createElement("canvas");
          const ac = analyzerCanvasRef.current;
          ac.width = img.width;
          ac.height = img.height;
          const ctx = ac.getContext("2d");
          if (!ctx) return;
          ctx.drawImage(img, 0, 0);
          await poseModelRef.current.send({ image: ac });
        } catch { /* silently fail */ }
      } else {
        // Fallback: motion + skin-tone heuristic
        if (!analyzerCanvasRef.current) analyzerCanvasRef.current = document.createElement("canvas");
        const ac = analyzerCanvasRef.current;
        const w = Math.min(img.width, 160);
        const h = Math.round((img.height / img.width) * w);
        ac.width = w; ac.height = h;
        const ctx = ac.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        const frame = ctx.getImageData(0, 0, w, h);

        if (prevFrameRef.current?.width === w && prevFrameRef.current?.height === h) {
          const prev = prevFrameRef.current;
          let motionPixels = 0, skinPixels = 0;
          const total = w * h;
          for (let i = 0; i < frame.data.length; i += 4) {
            const r = frame.data[i], g = frame.data[i + 1], b = frame.data[i + 2];
            const diff = Math.abs(r - prev.data[i]) + Math.abs(g - prev.data[i + 1]) + Math.abs(b - prev.data[i + 2]);
            if (diff > 40) motionPixels++;
            if (r > 95 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15 && r - b > 15) skinPixels++;
          }
          const motionPct = (motionPixels / total) * 100;
          const skinPct = (skinPixels / total) * 100;

          if (motionPct > 1 && skinPct > 2) {
            const conf = Math.min(95, Math.round(motionPct * 2 + skinPct * 3));
            setHumanCount(1);
            setConfidence(conf);
            // Generate approximate body landmarks for fallback skeleton
            const approxLandmarks: NormalizedLandmark[] = [
              { x: 0.5, y: 0.12, z: 0, visibility: 0.8 },  // 0: nose
              { x: 0.49, y: 0.11, z: 0, visibility: 0.7 },  // 1
              { x: 0.48, y: 0.10, z: 0, visibility: 0.7 },  // 2
              { x: 0.47, y: 0.10, z: 0, visibility: 0.6 },  // 3
              { x: 0.51, y: 0.11, z: 0, visibility: 0.7 },  // 4
              { x: 0.52, y: 0.10, z: 0, visibility: 0.7 },  // 5
              { x: 0.53, y: 0.10, z: 0, visibility: 0.6 },  // 6
              { x: 0.46, y: 0.10, z: 0, visibility: 0.5 },  // 7
              { x: 0.54, y: 0.10, z: 0, visibility: 0.5 },  // 8
              { x: 0.48, y: 0.09, z: 0, visibility: 0.5 },  // 9
              { x: 0.52, y: 0.09, z: 0, visibility: 0.5 },  // 10
              { x: 0.38, y: 0.28, z: 0, visibility: 0.8 },  // 11: left shoulder
              { x: 0.62, y: 0.28, z: 0, visibility: 0.8 },  // 12: right shoulder
              { x: 0.30, y: 0.42, z: 0, visibility: 0.7 },  // 13: left elbow
              { x: 0.70, y: 0.42, z: 0, visibility: 0.7 },  // 14: right elbow
              { x: 0.25, y: 0.55, z: 0, visibility: 0.7 },  // 15: left wrist
              { x: 0.75, y: 0.55, z: 0, visibility: 0.7 },  // 16: right wrist
              { x: 0.23, y: 0.57, z: 0, visibility: 0.5 },  // 17
              { x: 0.77, y: 0.57, z: 0, visibility: 0.5 },  // 18
              { x: 0.22, y: 0.58, z: 0, visibility: 0.5 },  // 19
              { x: 0.78, y: 0.58, z: 0, visibility: 0.5 },  // 20
              { x: 0.24, y: 0.59, z: 0, visibility: 0.5 },  // 21
              { x: 0.76, y: 0.59, z: 0, visibility: 0.5 },  // 22
              { x: 0.42, y: 0.58, z: 0, visibility: 0.8 },  // 23: left hip
              { x: 0.58, y: 0.58, z: 0, visibility: 0.8 },  // 24: right hip
              { x: 0.40, y: 0.73, z: 0, visibility: 0.7 },  // 25: left knee
              { x: 0.60, y: 0.73, z: 0, visibility: 0.7 },  // 26: right knee
              { x: 0.38, y: 0.90, z: 0, visibility: 0.7 },  // 27: left ankle
              { x: 0.62, y: 0.90, z: 0, visibility: 0.7 },  // 28: right ankle
              { x: 0.36, y: 0.93, z: 0, visibility: 0.5 },  // 29
              { x: 0.64, y: 0.93, z: 0, visibility: 0.5 },  // 30
              { x: 0.37, y: 0.95, z: 0, visibility: 0.5 },  // 31
              { x: 0.63, y: 0.95, z: 0, visibility: 0.5 },  // 32
            ];
            setLandmarks(approxLandmarks);
            if (!hasNotifiedRef.current) {
              hasNotifiedRef.current = true;
              onHumanDetected?.(approxLandmarks, conf / 100);
            }
          } else {
            setHumanCount(0);
            setConfidence(0);
            setLandmarks([]);
            hasNotifiedRef.current = false;
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

  // Draw skeleton overlay — proper body coverage
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || landmarks.length < 2) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (landmarks.length >= 33) {
      // Draw body fill (semi-transparent torso polygon)
      const torsoPoints = [11, 12, 24, 23].map(i => landmarks[i]);
      if (torsoPoints.every(p => p.visibility > 0.3)) {
        ctx.fillStyle = "rgba(0, 255, 136, 0.08)";
        ctx.beginPath();
        ctx.moveTo(torsoPoints[0].x * canvas.width, torsoPoints[0].y * canvas.height);
        for (let i = 1; i < torsoPoints.length; i++) {
          ctx.lineTo(torsoPoints[i].x * canvas.width, torsoPoints[i].y * canvas.height);
        }
        ctx.closePath();
        ctx.fill();
      }

      // Draw connections with proper thickness
      for (const [i1, i2] of POSE_CONNECTIONS) {
        const l1 = landmarks[i1];
        const l2 = landmarks[i2];
        if (!l1 || !l2 || l1.visibility < 0.2 || l2.visibility < 0.2) continue;

        const color = getConnectionColor(i1, i2);
        // Thicker lines for major body parts, thinner for face/hands/feet
        const isMajor = (i1 >= 11 && i1 <= 28 && i2 >= 11 && i2 <= 28);
        ctx.strokeStyle = color;
        ctx.lineWidth = isMajor ? 4 : 2;
        ctx.shadowColor = color;
        ctx.shadowBlur = isMajor ? 8 : 4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(l1.x * canvas.width, l1.y * canvas.height);
        ctx.lineTo(l2.x * canvas.width, l2.y * canvas.height);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Draw landmark dots
      for (let i = 0; i < landmarks.length; i++) {
        const lm = landmarks[i];
        if (lm.visibility < 0.2) continue;

        const x = lm.x * canvas.width;
        const y = lm.y * canvas.height;
        // Major joints = bigger dots
        const isMajorJoint = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].includes(i);
        const radius = isMajorJoint ? 6 : i <= 10 ? 2 : 4;

        // Glow effect for major joints
        if (isMajorJoint) {
          ctx.fillStyle = "rgba(255,255,255,0.3)";
          ctx.beginPath();
          ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Draw bounding box around detected person
      const visibleLandmarks = landmarks.filter(l => l.visibility > 0.3);
      if (visibleLandmarks.length > 5) {
        const minX = Math.min(...visibleLandmarks.map(l => l.x)) * canvas.width - 10;
        const maxX = Math.max(...visibleLandmarks.map(l => l.x)) * canvas.width + 10;
        const minY = Math.min(...visibleLandmarks.map(l => l.y)) * canvas.height - 10;
        const maxY = Math.max(...visibleLandmarks.map(l => l.y)) * canvas.height + 10;

        ctx.strokeStyle = "rgba(0, 255, 136, 0.6)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
        ctx.setLineDash([]);
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
      <div className="absolute top-2 left-2 flex gap-1">
        {humanCount > 0 ? (
          <Badge className="bg-red-500/90 text-white border-red-600 text-[10px] gap-1 animate-pulse">
            🧍 Human ({confidence}%)
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
