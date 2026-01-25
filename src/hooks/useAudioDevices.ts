import { useState, useEffect, useCallback } from "react";

export interface AudioDevice {
  deviceId: string;
  label: string;
  kind: "audioinput" | "audiooutput";
}

export function useAudioDevices() {
  const [inputDevices, setInputDevices] = useState<AudioDevice[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([]);
  const [selectedInput, setSelectedInput] = useState<string>("");
  const [selectedOutput, setSelectedOutput] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const enumerateDevices = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Request permission first to get full device labels
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        // Continue anyway, labels may be empty
      }

      const devices = await navigator.mediaDevices.enumerateDevices();

      const inputs: AudioDevice[] = [];
      const outputs: AudioDevice[] = [];

      devices.forEach((device, index) => {
        if (device.kind === "audioinput") {
          inputs.push({
            deviceId: device.deviceId,
            label: device.label || `Microphone ${index + 1}`,
            kind: "audioinput",
          });
        } else if (device.kind === "audiooutput") {
          outputs.push({
            deviceId: device.deviceId,
            label: device.label || `Speaker ${index + 1}`,
            kind: "audiooutput",
          });
        }
      });

      setInputDevices(inputs);
      setOutputDevices(outputs);

      // Set defaults if not already set
      if (!selectedInput && inputs.length > 0) {
        setSelectedInput(inputs[0].deviceId);
      }
      if (!selectedOutput && outputs.length > 0) {
        setSelectedOutput(outputs[0].deviceId);
      }
    } catch (err) {
      console.error("Error enumerating audio devices:", err);
      setError(err instanceof Error ? err.message : "Failed to get audio devices");
    } finally {
      setLoading(false);
    }
  }, [selectedInput, selectedOutput]);

  useEffect(() => {
    enumerateDevices();

    // Listen for device changes
    const handleDeviceChange = () => {
      enumerateDevices();
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [enumerateDevices]);

  const getInputStream = useCallback(async () => {
    if (!selectedInput) return null;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: selectedInput },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
          channelCount: 1,
        },
      });
      return stream;
    } catch (err) {
      console.error("Error getting input stream:", err);
      setError(err instanceof Error ? err.message : "Failed to get microphone");
      return null;
    }
  }, [selectedInput]);

  return {
    inputDevices,
    outputDevices,
    selectedInput,
    selectedOutput,
    setSelectedInput,
    setSelectedOutput,
    getInputStream,
    refreshDevices: enumerateDevices,
    loading,
    error,
  };
}
