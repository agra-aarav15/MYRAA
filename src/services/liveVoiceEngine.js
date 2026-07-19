// =====================================================================
// MYRAA Live Voice Engine — Client-side WebSocket for Gemini Live API
// Handles: microphone capture, audio playback, transcriptions, tools
// =====================================================================

const AUDIO_SAMPLE_RATE = 16000; // Mic capture rate for Gemini
const PLAYBACK_SAMPLE_RATE = 24000; // Gemini outputs 24kHz PCM

/**
 * Creates a new LiveVoiceEngine instance.
 * @param {Object} callbacks - Event handlers
 * @param {Function} callbacks.onStatusChange - (status: string) => void
 * @param {Function} callbacks.onTranscription - (role: 'user'|'model', text: string) => void
 * @param {Function} callbacks.onSpeakingChange - (isSpeaking: boolean) => void
 * @param {Function} callbacks.onListeningChange - (isListening: boolean) => void
 * @param {Function} callbacks.onMemorySync - (memories: Array) => void
 * @param {Function} callbacks.onToolResult - (tool: string, result: object) => void
 * @param {Function} callbacks.onError - (error: string) => void
 * @param {Function} callbacks.onTurnComplete - () => void
 * @param {Function} callbacks.onInterrupted - () => void
 * @param {Function} callbacks.onRateLimitUpdate - (rateLimit: object) => void
 */
export function createLiveVoiceEngine(callbacks = {}) {
  let ws = null;
  let audioContext = null;
  let micStream = null;
  let micProcessor = null;
  let isConnected = false;
  let isSpeaking = false;
  let isListening = false;
  let pendingAudioChunks = [];
  let playbackSource = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;

  // ---- Audio Playback (24kHz PCM from Gemini) ----

  function initAudioContext() {
    if (!audioContext || audioContext.state === 'closed') {
      audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: PLAYBACK_SAMPLE_RATE
      });
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    return audioContext;
  }

  function playAudioChunk(base64Audio) {
    try {
      const ctx = initAudioContext();

      // Decode base64 to raw bytes
      const binaryStr = atob(base64Audio);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      // Convert to 16-bit signed PCM Float32
      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768.0;
      }

      // Create audio buffer and play
      const audioBuffer = ctx.createBuffer(1, float32.length, PLAYBACK_SAMPLE_RATE);
      audioBuffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      if (!isSpeaking) {
        isSpeaking = true;
        callbacks.onSpeakingChange?.(true);
      }

      source.onended = () => {
        // Only mark as not speaking if no more chunks pending
        if (pendingAudioChunks.length === 0) {
          isSpeaking = false;
          callbacks.onSpeakingChange?.(false);
        }
      };

      source.start();
      playbackSource = source;
    } catch (e) {
      console.error('[Voice] Audio playback error:', e);
    }
  }

  function stopPlayback() {
    pendingAudioChunks = [];
    if (playbackSource) {
      try { playbackSource.stop(); } catch (e) {}
      playbackSource = null;
    }
    if (isSpeaking) {
      isSpeaking = false;
      callbacks.onSpeakingChange?.(false);
    }
  }

  // ---- Microphone Capture (16kHz PCM to Gemini) ----

  async function startMicrophone() {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: AUDIO_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });

      const ctx = initAudioContext();

      // Create a ScriptProcessor to capture raw audio
      // (AudioWorklet would be better but requires serving a separate file)
      const source = ctx.createMediaStreamSource(micStream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) return;

        const inputData = e.inputBuffer.getChannelData(0);

        // Resample to 16kHz if needed
        const resampledData = resampleAudio(inputData, ctx.sampleRate, AUDIO_SAMPLE_RATE);

        // Convert Float32 to Int16
        const int16 = new Int16Array(resampledData.length);
        for (let i = 0; i < resampledData.length; i++) {
          const s = Math.max(-1, Math.min(1, resampledData[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Convert to base64
        const uint8 = new Uint8Array(int16.buffer);
        let binary = '';
        for (let i = 0; i < uint8.length; i++) {
          binary += String.fromCharCode(uint8[i]);
        }
        const base64 = btoa(binary);

        // Send to server
        ws.send(JSON.stringify({ type: 'audio', audio: base64 }));
      };

      source.connect(processor);
      processor.connect(ctx.destination); // Required for ScriptProcessor to fire

      micProcessor = { source, processor, stream: micStream };

      isListening = true;
      callbacks.onListeningChange?.(true);
      console.log('[Voice] Microphone started');
    } catch (err) {
      console.error('[Voice] Microphone error:', err);
      callbacks.onError?.(`Microphone access denied: ${err.message}`);
    }
  }

  function stopMicrophone() {
    if (micProcessor) {
      try { micProcessor.processor.disconnect(); } catch (e) {}
      try { micProcessor.source.disconnect(); } catch (e) {}
      micProcessor = null;
    }
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
    }
    isListening = false;
    callbacks.onListeningChange?.(false);
    console.log('[Voice] Microphone stopped');
  }

  // Simple linear resampling
  function resampleAudio(inputData, inputRate, outputRate) {
    if (inputRate === outputRate) return inputData;
    const ratio = inputRate / outputRate;
    const outputLength = Math.round(inputData.length / ratio);
    const output = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      const srcIdx = i * ratio;
      const floor = Math.floor(srcIdx);
      const ceil = Math.min(floor + 1, inputData.length - 1);
      const frac = srcIdx - floor;
      output[i] = inputData[floor] * (1 - frac) + inputData[ceil] * frac;
    }
    return output;
  }

  // ---- WebSocket Connection ----

  function connect() {
    const host = window.location.hostname || 'localhost';
    const wsUrl = `ws://${host}:3001/live`;

    console.log('[Voice] Connecting to', wsUrl);
    callbacks.onStatusChange?.('connecting');

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[Voice] WebSocket connected');
      isConnected = true;
      reconnectAttempts = 0;
      callbacks.onStatusChange?.('connected');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'audio':
            playAudioChunk(msg.audio);
            break;

          case 'transcription':
            callbacks.onTranscription?.(msg.role, msg.text);
            break;

          case 'turnComplete':
            callbacks.onTurnComplete?.();
            break;

          case 'interrupted':
            stopPlayback();
            callbacks.onInterrupted?.();
            break;

          case 'memory_sync':
            callbacks.onMemorySync?.(msg.memories);
            break;

          case 'toolResult':
            callbacks.onToolResult?.(msg.tool, msg.result);
            break;

          case 'status':
            callbacks.onStatusChange?.(msg.status);
            if (msg.rateLimit) {
              callbacks.onRateLimitUpdate?.(msg.rateLimit);
            }
            break;

          case 'error':
            callbacks.onError?.(msg.error);
            if (msg.rateLimit) {
              callbacks.onRateLimitUpdate?.(msg.rateLimit);
            }
            break;

          default:
            console.log('[Voice] Unknown message type:', msg.type);
        }
      } catch (e) {
        console.error('[Voice] Message parse error:', e);
      }
    };

    ws.onclose = () => {
      console.log('[Voice] WebSocket closed');
      isConnected = false;
      callbacks.onStatusChange?.('disconnected');
      stopMicrophone();

      // Auto-reconnect with backoff
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        reconnectTimer = setTimeout(() => {
          reconnectAttempts++;
          console.log(`[Voice] Reconnecting (attempt ${reconnectAttempts})...`);
          connect();
        }, delay);
      }
    };

    ws.onerror = (err) => {
      console.error('[Voice] WebSocket error:', err);
    };
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // Prevent auto-reconnect
    stopMicrophone();
    stopPlayback();
    if (ws) {
      ws.close();
      ws = null;
    }
    isConnected = false;
    callbacks.onStatusChange?.('disconnected');
  }

  // ---- Public API ----

  function sendText(text) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'text', text }));
    }
  }

  function sendScreenFrame(base64JpegFrame) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Strip data URL prefix if present
      const frameData = base64JpegFrame.includes(',')
        ? base64JpegFrame.split(',')[1]
        : base64JpegFrame;
      ws.send(JSON.stringify({ type: 'screen_frame', frame: frameData }));
    }
  }

  function sendApiKey(key) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'api_key', key }));
    }
  }

  function toggleMic() {
    if (isListening) {
      stopMicrophone();
    } else {
      startMicrophone();
    }
  }

  function getState() {
    return {
      isConnected,
      isSpeaking,
      isListening,
    };
  }

  return {
    connect,
    disconnect,
    sendText,
    sendScreenFrame,
    sendApiKey,
    startMicrophone,
    stopMicrophone,
    toggleMic,
    stopPlayback,
    getState,
  };
}
