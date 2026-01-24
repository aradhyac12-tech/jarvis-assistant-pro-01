import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface TTSOptions {
  voiceId?: string;
}

export function useElevenLabsTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    queueRef.current = [];
    isPlayingRef.current = false;
    setIsSpeaking(false);
  }, []);

  const playNext = useCallback(async () => {
    if (queueRef.current.length === 0) {
      isPlayingRef.current = false;
      setIsSpeaking(false);
      return;
    }

    isPlayingRef.current = true;
    setIsSpeaking(true);

    const text = queueRef.current.shift()!;

    try {
      const { data, error } = await supabase.functions.invoke("elevenlabs-tts", {
        body: { text },
      });

      if (error || !data?.audioContent) {
        console.error("TTS error:", error);
        playNext();
        return;
      }

      // Use data URI for clean playback
      const audioUrl = `data:audio/mpeg;base64,${data.audioContent}`;
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        audioRef.current = null;
        playNext();
      };

      audio.onerror = () => {
        console.error("Audio playback error");
        audioRef.current = null;
        playNext();
      };

      await audio.play();
    } catch (error) {
      console.error("TTS playback error:", error);
      playNext();
    }
  }, []);

  const speak = useCallback(
    async (text: string, options?: TTSOptions) => {
      if (!text.trim()) return;

      // Add to queue
      queueRef.current.push(text);

      // Start playing if not already
      if (!isPlayingRef.current) {
        setIsLoading(true);
        await playNext();
        setIsLoading(false);
      }
    },
    [playNext]
  );

  const speakImmediate = useCallback(
    async (text: string, options?: TTSOptions) => {
      if (!text.trim()) return;

      // Stop current and clear queue
      stopSpeaking();

      // Play immediately
      setIsLoading(true);
      queueRef.current.push(text);
      await playNext();
      setIsLoading(false);
    },
    [stopSpeaking, playNext]
  );

  return {
    speak,
    speakImmediate,
    stopSpeaking,
    isSpeaking,
    isLoading,
  };
}
