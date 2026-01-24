import { useState, useRef, useCallback, useEffect } from "react";

interface UseContinuousVoiceOptions {
  onTranscript: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  wakeWord?: string;
  continuous?: boolean;
  language?: string;
}

export function useContinuousVoice({
  onTranscript,
  onError,
  wakeWord = "jarvis",
  continuous = true,
  language = "en-US",
}: UseContinuousVoiceOptions) {
  const [isListening, setIsListening] = useState(false);
  const [isWakeWordActive, setIsWakeWordActive] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [interimTranscript, setInterimTranscript] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const restartTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const startListening = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setIsSupported(false);
      onError?.("Speech recognition not supported in this browser");
      return;
    }

    // Stop any existing recognition
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = continuous;
    recognition.interimResults = true;
    recognition.lang = language;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      setInterimTranscript(interim);

      if (final) {
        // Check for wake word
        const lowerFinal = final.toLowerCase();
        if (lowerFinal.includes(wakeWord.toLowerCase())) {
          setIsWakeWordActive(true);
          // Extract command after wake word
          const wakeWordIndex = lowerFinal.indexOf(wakeWord.toLowerCase());
          const command = final.slice(wakeWordIndex + wakeWord.length).trim();
          if (command) {
            onTranscript(command, true);
          }
        } else if (isWakeWordActive) {
          // If wake word was already detected, process the command
          onTranscript(final, true);
        } else {
          // Still notify for non-wake-word mode
          onTranscript(final, true);
        }
      } else if (interim) {
        onTranscript(interim, false);
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      
      if (event.error === "not-allowed") {
        onError?.("Microphone access denied");
        setIsListening(false);
        return;
      }
      
      if (event.error === "aborted" || event.error === "network") {
        // These are recoverable, restart after delay
        if (continuous) {
          restartTimeoutRef.current = setTimeout(() => {
            startListening();
          }, 1000);
        }
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript("");

      // Auto-restart for continuous mode
      if (continuous && recognitionRef.current) {
        restartTimeoutRef.current = setTimeout(() => {
          startListening();
        }, 100);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [continuous, language, wakeWord, isWakeWordActive, onTranscript, onError]);

  const stopListening = useCallback(() => {
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }

    setIsListening(false);
    setIsWakeWordActive(false);
    setInterimTranscript("");
  }, []);

  const resetWakeWord = useCallback(() => {
    setIsWakeWordActive(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  return {
    isListening,
    isWakeWordActive,
    isSupported,
    interimTranscript,
    startListening,
    stopListening,
    resetWakeWord,
  };
}
