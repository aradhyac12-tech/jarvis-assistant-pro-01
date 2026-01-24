import { useState, useCallback, useRef, useEffect } from "react";

interface UseWebSpeechTTSOptions {
  voice?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
}

export function useWebSpeechTTS(options: UseWebSpeechTTSOptions = {}) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const queueRef = useRef<string[]>([]);

  // Load available voices
  useEffect(() => {
    if (!window.speechSynthesis) {
      setIsSupported(false);
      return;
    }

    const loadVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices();
      setVoices(availableVoices);
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  // Get preferred voice - prioritize English voices with good quality
  const getPreferredVoice = useCallback((): SpeechSynthesisVoice | null => {
    if (voices.length === 0) return null;

    // Priority order for natural-sounding voices
    const preferredVoices = [
      "Google UK English Male",
      "Google UK English Female", 
      "Microsoft David",
      "Microsoft Mark",
      "Samantha",
      "Daniel",
      "Alex",
    ];

    for (const preferred of preferredVoices) {
      const voice = voices.find(v => v.name.includes(preferred));
      if (voice) return voice;
    }

    // Fallback to any English voice
    const englishVoice = voices.find(v => v.lang.startsWith("en"));
    return englishVoice || voices[0];
  }, [voices]);

  const speak = useCallback((text: string) => {
    if (!window.speechSynthesis) {
      console.warn("Speech synthesis not supported");
      return;
    }

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options.rate || 1.0;
    utterance.pitch = options.pitch || 1.0;
    utterance.volume = options.volume || 1.0;

    const voice = getPreferredVoice();
    if (voice) {
      utterance.voice = voice;
    }

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => {
      setIsSpeaking(false);
      // Process next in queue
      if (queueRef.current.length > 0) {
        const next = queueRef.current.shift();
        if (next) speak(next);
      }
    };
    utterance.onerror = (e) => {
      console.error("Speech error:", e);
      setIsSpeaking(false);
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [options.rate, options.pitch, options.volume, getPreferredVoice]);

  const speakQueued = useCallback((text: string) => {
    if (isSpeaking) {
      queueRef.current.push(text);
    } else {
      speak(text);
    }
  }, [isSpeaking, speak]);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel();
    queueRef.current = [];
    setIsSpeaking(false);
  }, []);

  const pauseSpeaking = useCallback(() => {
    window.speechSynthesis?.pause();
  }, []);

  const resumeSpeaking = useCallback(() => {
    window.speechSynthesis?.resume();
  }, []);

  return {
    speak,
    speakQueued,
    stopSpeaking,
    pauseSpeaking,
    resumeSpeaking,
    isSpeaking,
    isSupported,
    voices,
  };
}
