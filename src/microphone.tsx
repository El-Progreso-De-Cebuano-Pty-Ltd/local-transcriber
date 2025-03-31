// All imports must come first
import { Button } from "antd";
import { AudioMutedOutlined, AudioOutlined } from "@ant-design/icons";
import React, { useCallback, useEffect, useState, useRef } from "react";
import MicrophoneStream from "microphone-stream";

import { AudioStreamer } from "./audiostreamer";
import { audioBucket } from "./audiobucket";
import { KaldiRecognizer } from "vosk-browser";

interface Props {
  recognizer: KaldiRecognizer | undefined;
  ready: boolean;
  loading: boolean;
}

// Polyfill process for microphone-stream - must come after imports but before component
if (typeof window !== 'undefined') {
  // Define process correctly with nextTick directly on the object
  if (!window.process) {
    window.process = {} as any;
  }
  
  // Set process.env
  (window.process as any).env = {
    NODE_ENV: 'development',
    PUBLIC_URL: '/vosk-browser',
  };
  
  // Define nextTick as a direct property of process
  (window.process as any).nextTick = function(callback: Function, ...args: any[]) {
    return setTimeout(() => callback(...args), 0);
  };
  
  // Other process properties
  (window.process as any).browser = true;
  (window.process as any).version = '';
  (window.process as any).platform = 'browser';
}

// Use refs instead of global variables
const Microphone: React.FunctionComponent<Props> = ({
  recognizer,
  loading,
  ready,
}) => {
  const [muted, setMuted] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Use refs to store the stream instances
  const micStreamRef = useRef<any>(null);
  const audioStreamerRef = useRef<AudioStreamer | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const startRecognitionStream = useCallback(async () => {
    if (recognizer) {
      setMuted(true);
      setError(null);

      try {
        if (!micStreamRef.current) {
          // Get user media
          mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
            },
          });

          // Create microphone stream with error handling
          try {
            micStreamRef.current = new MicrophoneStream({
              objectMode: true,
              bufferSize: 1024,
            });
            
            micStreamRef.current.setStream(mediaStreamRef.current);
          } catch (err) {
            console.error("Error creating MicrophoneStream:", err);
            setError("Error accessing microphone. Please check browser permissions.");
            return;
          }
        } else {
          // If we already have a stream, handle pipe switching
          if (audioStreamerRef.current) {
            micStreamRef.current.unpipe(audioStreamerRef.current);
          }
          micStreamRef.current.pipe(audioBucket);
        }

        // Create audio streamer
        audioStreamerRef.current = new AudioStreamer(recognizer, {
          objectMode: true,
        });
      } catch (err) {
        console.error("Error in startRecognitionStream:", err);
        setError("Error starting microphone");
      }
    }
  }, [recognizer]);

  useEffect(() => {
    try {
      startRecognitionStream();
    } catch (err) {
      console.error("Error in recognizer effect:", err);
      setError("Failed to initialize speech recognition");
    }
    
    // Cleanup function
    return () => {
      try {
        if (micStreamRef.current) {
          if (audioStreamerRef.current) {
            micStreamRef.current.unpipe(audioStreamerRef.current);
          }
          micStreamRef.current.unpipe(audioBucket);
          
          // Close the stream if possible
          try {
            micStreamRef.current.destroy();
          } catch (e) {
            // Ignore any errors during cleanup
          }
        }
        
        // Stop all tracks in the media stream
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach(track => track.stop());
        }
      } catch (err) {
        console.error("Error during cleanup:", err);
      }
    };
  }, [recognizer, startRecognitionStream]);

  useEffect(() => {
    setMuted(true);
  }, [loading]);

  useEffect(() => {
    try {
      if (!muted && micStreamRef.current && audioStreamerRef.current) {
        micStreamRef.current.unpipe(audioBucket);
        micStreamRef.current.pipe(audioStreamerRef.current);
      } else if (muted && micStreamRef.current) {
        if (audioStreamerRef.current) {
          micStreamRef.current.unpipe(audioStreamerRef.current);
        }
        micStreamRef.current.pipe(audioBucket);
      }
    } catch (err) {
      console.error("Error toggling microphone:", err);
      setError("Error with microphone");
    }
  }, [muted]);

  const toggleMic = () => {
    setMuted((muted) => !muted);
  };

  if (error) {
    return (
      <Button
        icon={<AudioMutedOutlined />}
        danger
        title={error}
        disabled
      >
        Error
      </Button>
    );
  }

  return (
    <Button
      icon={muted ? <AudioMutedOutlined /> : <AudioOutlined />}
      disabled={!ready || loading}
      onMouseUp={toggleMic}
    >
      Speak
    </Button>
  );
};

export default Microphone;