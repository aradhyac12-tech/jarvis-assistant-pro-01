import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";

interface AudioWaveformProps {
  isActive: boolean;
  mode: "listening" | "speaking";
  className?: string;
  barCount?: number;
}

export function AudioWaveform({ 
  isActive, 
  mode, 
  className,
  barCount = 12 
}: AudioWaveformProps) {
  const [levels, setLevels] = useState<number[]>(Array(barCount).fill(0.1));
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Start microphone analysis for listening mode
  const startMicAnalysis = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateLevels = () => {
        if (!analyserRef.current) return;
        
        analyserRef.current.getByteFrequencyData(dataArray);
        
        const newLevels: number[] = [];
        const step = Math.floor(dataArray.length / barCount);
        
        for (let i = 0; i < barCount; i++) {
          const value = dataArray[i * step] / 255;
          newLevels.push(Math.max(0.1, value));
        }
        
        setLevels(newLevels);
        animationRef.current = requestAnimationFrame(updateLevels);
      };

      updateLevels();
    } catch (error) {
      console.error("Microphone access error:", error);
      // Fallback to animated bars
      startFallbackAnimation();
    }
  }, [barCount]);

  // Fallback animation when mic not available or for speaking mode
  const startFallbackAnimation = useCallback(() => {
    let frame = 0;
    
    const animate = () => {
      frame++;
      const newLevels = Array(barCount).fill(0).map((_, i) => {
        const phase = (frame / 20) + (i * 0.5);
        const base = mode === "speaking" ? 0.4 : 0.2;
        const amplitude = mode === "speaking" ? 0.5 : 0.3;
        return base + Math.sin(phase) * amplitude * Math.random();
      });
      setLevels(newLevels);
      animationRef.current = requestAnimationFrame(animate);
    };
    
    animate();
  }, [barCount, mode]);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  useEffect(() => {
    if (isActive) {
      if (mode === "listening") {
        startMicAnalysis();
      } else {
        startFallbackAnimation();
      }
    } else {
      cleanup();
      setLevels(Array(barCount).fill(0.1));
    }

    return cleanup;
  }, [isActive, mode, startMicAnalysis, startFallbackAnimation, cleanup, barCount]);

  const colorClass = mode === "listening" 
    ? "bg-neon-cyan" 
    : "bg-neon-blue";

  const glowClass = mode === "listening"
    ? "shadow-[0_0_10px_hsl(var(--neon-cyan))]"
    : "shadow-[0_0_10px_hsl(var(--neon-blue))]";

  return (
    <div className={cn("flex items-end justify-center gap-1 h-16", className)}>
      {levels.map((level, index) => (
        <div
          key={index}
          className={cn(
            "w-1.5 rounded-full transition-all duration-75",
            colorClass,
            isActive && glowClass
          )}
          style={{
            height: `${Math.max(8, level * 100)}%`,
            opacity: isActive ? 0.8 + level * 0.2 : 0.3,
            animationDelay: `${index * 50}ms`,
          }}
        />
      ))}
    </div>
  );
}

// Circular waveform for JARVIS-style orb
interface CircularWaveformProps {
  isActive: boolean;
  mode: "listening" | "speaking" | "idle";
  size?: number;
  className?: string;
}

export function CircularWaveform({
  isActive,
  mode,
  size = 120,
  className,
}: CircularWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const getColor = useCallback(() => {
    switch (mode) {
      case "listening": return "hsl(185, 100%, 55%)"; // cyan
      case "speaking": return "hsl(210, 100%, 60%)"; // blue
      default: return "hsl(210, 100%, 40%)"; // dim blue
    }
  }, [mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let audioData: Uint8Array<ArrayBuffer> | null = null;
    let frame = 0;

    const startMicCapture = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 128;
        source.connect(analyser);
        analyserRef.current = analyser;
        audioData = new Uint8Array(analyser.frequencyBinCount);
      } catch (error) {
        console.error("Mic error:", error);
      }
    };

    const draw = () => {
      frame++;
      const centerX = size / 2;
      const centerY = size / 2;
      const baseRadius = size * 0.3;

      ctx.clearRect(0, 0, size, size);

      if (analyserRef.current && audioData) {
        analyserRef.current.getByteFrequencyData(audioData);
      }

      // Draw multiple rings
      const rings = 3;
      const color = getColor();
      
      for (let ring = 0; ring < rings; ring++) {
        const ringRadius = baseRadius + ring * 8;
        const segments = 64;

        ctx.beginPath();

        for (let i = 0; i <= segments; i++) {
          const angle = (i / segments) * Math.PI * 2;
          
          // Get audio amplitude
          let amplitude = 0;
          if (audioData && isActive) {
            const dataIndex = Math.floor((i / segments) * audioData.length);
            amplitude = (audioData[dataIndex] / 255) * 15;
          } else if (isActive) {
            amplitude = Math.sin(frame / 15 + i * 0.3 + ring) * 8;
          }

          const radius = ringRadius + amplitude;
          const x = centerX + Math.cos(angle) * radius;
          const y = centerY + Math.sin(angle) * radius;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }

        ctx.closePath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 - ring * 0.5;
        ctx.globalAlpha = isActive ? 0.8 - ring * 0.2 : 0.3 - ring * 0.1;
        ctx.stroke();

        // Add glow effect
        if (isActive) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 15;
        }
      }

      // Center glow
      if (isActive) {
        const gradient = ctx.createRadialGradient(
          centerX, centerY, 0,
          centerX, centerY, baseRadius * 0.8
        );
        gradient.addColorStop(0, `${color.replace(")", ", 0.4)")}`);
        gradient.addColorStop(1, "transparent");
        
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(centerX, centerY, baseRadius * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      animationRef.current = requestAnimationFrame(draw);
    };

    if (isActive && mode === "listening") {
      startMicCapture();
    }

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [isActive, mode, size, getColor]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={cn("rounded-full", className)}
    />
  );
}
