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
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isWakeWordActiveRef = useRef(false);
  const continuousRef = useRef(continuous);
  const shouldRestartRef = useRef(false);

  // Keep refs in sync with state
  useEffect(() => {
    isWakeWordActiveRef.current = isWakeWordActive;
  }, [isWakeWordActive]);

  useEffect(() => {
    continuousRef.current = continuous;
  }, [continuous]);

  const startListening = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setIsSupported(false);
      onError?.("Speech recognition not supported in this browser");
      return;
    }

    // Clear any pending restart
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }

    // Stop any existing recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    shouldRestartRef.current = true;
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
        const lowerFinal = final.toLowerCase();
        const wakeWordLower = wakeWord.toLowerCase();
        
        if (lowerFinal.includes(wakeWordLower)) {
          setIsWakeWordActive(true);
          isWakeWordActiveRef.current = true;
          
          // Extract command after wake word
          const wakeWordIndex = lowerFinal.indexOf(wakeWordLower);
          const command = final.slice(wakeWordIndex + wakeWord.length).trim();
          if (command) {
            onTranscript(command, true);
            // Reset wake word after processing command
            setTimeout(() => {
              setIsWakeWordActive(false);
              isWakeWordActiveRef.current = false;
            }, 500);
          }
        } else if (isWakeWordActiveRef.current) {
          // Wake word was already detected, process the command
          onTranscript(final, true);
          // Reset wake word after processing
          setTimeout(() => {
            setIsWakeWordActive(false);
            isWakeWordActiveRef.current = false;
          }, 500);
        }
        // Don't send non-wake-word transcripts in wake word mode
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
        shouldRestartRef.current = false;
        return;
      }
      
      // For recoverable errors, will restart in onend if continuous
      if (event.error !== "aborted" && event.error !== "network" && event.error !== "no-speech") {
        onError?.(event.error);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript("");

      // Auto-restart for continuous mode if not explicitly stopped
      if (continuousRef.current && shouldRestartRef.current) {
        restartTimeoutRef.current = setTimeout(() => {
          if (shouldRestartRef.current) {
            startListening();
          }
        }, 200);
      }
    };

    recognitionRef.current = recognition;
    
    try {
      recognition.start();
    } catch (e) {
      console.error("Failed to start recognition:", e);
      // May already be running, try restarting
      restartTimeoutRef.current = setTimeout(() => {
        if (shouldRestartRef.current) {
          startListening();
        }
      }, 500);
    }
  }, [continuous, language, wakeWord, onTranscript, onError]);

  const stopListening = useCallback(() => {
    shouldRestartRef.current = false;
    
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    setIsListening(false);
    setIsWakeWordActive(false);
    isWakeWordActiveRef.current = false;
    setInterimTranscript("");
  }, []);

  const resetWakeWord = useCallback(() => {
    setIsWakeWordActive(false);
    isWakeWordActiveRef.current = false;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      shouldRestartRef.current = false;
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
      }
    };
  }, []);

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
