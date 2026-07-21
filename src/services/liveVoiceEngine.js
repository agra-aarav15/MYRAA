// =====================================================================
// MYRAA Live Voice Engine — Client-side WebSocket for Gemini Live API
// Handles: microphone capture, audio playback, transcriptions, tools
// =====================================================================
//
// v1.2.0 rewrite — fixes robotic/delayed audio:
//   • Gapless chunk scheduler (nextStartTime cursor) — no more silence gaps
//     or overlaps between PCM frames.
//   • Real jitter buffer with a small pre-roll (60ms) — late frames don't
//     cause dropouts.
//   • stopPlayback() now tracks ALL scheduled sources in a Set and kills
//     every one (old code only stopped the last → mute button looked dead).
//   • Anti-aliased downsampling (one-pole LPF before decimation) — removes
//     the harsh/robotic aliasing from 48k→16k mic resampling.
//   • Exposes getAnalyser() so the 3D avatar can drive lip-sync from real
//     audio energy (see AvatarCanvas.jsx Phase 3).
//   • Every audio op is wrapped so a WS hiccup never stalls the 60 FPS loop.
// =====================================================================

const AUDIO_SAMPLE_RATE = 16000; // Mic capture rate for Gemini
const PLAYBACK_SAMPLE_RATE = 24000; // Gemini outputs 24kHz PCM

// Jitter buffer / scheduler tuning
const PREROLL_MS = 60;            // Buffer this much audio before first play
const MAX_SCHEDULE_AHEAD_S = 0.3; // Never schedule more than 300ms into the future
const STALE_CURSOR_S = 1.0;       // If nextStartTime lags >1s behind clock, resync

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
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;

  // ---- Playback scheduling state ----
  let activeSources = new Set();      // every scheduled BufferSource (for full stop)
  let pendingAudioChunks = [];        // jitter buffer queue of {float32, durationS}
  let nextStartTime = 0;              // gapless scheduling cursor (seconds, ctx time)
  let drainScheduled = false;         // is a drainQueue() microtask already pending?
  let analyser = null;                // AnalyserNode tapped by avatar lip-sync
  let analyserData = null;            // reused Uint8Array for analyser reads

  // ---- Audio Playback (24kHz PCM from Gemini) ----

  function initAudioContext() {
    if (!audioContext || audioContext.state === 'closed') {
      audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: PLAYBACK_SAMPLE_RATE
      });
      // Build the analyser once and wire it to destination so any source
      // connected to analyser is audible AND measurable.
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      analyser.connect(audioContext.destination);
      analyserData = new Uint8Array(analyser.frequencyBinCount);
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    return audioContext;
  }

  /**
   * Decode a base64 PCM chunk and enqueue it into the jitter buffer.
   * Safe to call from the WS onmessage handler; never throws into the loop.
   */
  function playAudioChunk(base64Audio) {
    try {
      initAudioContext();

      // Decode base64 → raw bytes
      const binaryStr = atob(base64Audio);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      // 16-bit signed PCM → Float32 [-1, 1]
      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768.0;
      }

      const durationS = float32.length / PLAYBACK_SAMPLE_RATE;
      pendingAudioChunks.push({ float32, durationS });

      if (!isSpeaking) {
        isSpeaking = true;
        callbacks.onSpeakingChange?.(true);
      }

      // Kick off draining if not already scheduled. Using a microtask keeps
      // this off the hot WS path so we never block frame delivery.
      if (!drainScheduled) {
        drainScheduled = true;
        Promise.resolve().then(drainQueue);
      }
    } catch (e) {
      console.error('[Voice] Audio playback error:', e);
    }
  }

  /**
   * Pop buffered chunks and schedule them gaplessly on the AudioContext
   * timeline. Honors the pre-roll (wait until we have PREROLL_MS buffered
   * before the very first play) and the max-schedule-ahead guard.
   */
  function drainQueue() {
    drainScheduled = false;
    try {
      if (!audioContext) return;
      const ctx = audioContext;
      const now = ctx.currentTime;

      // First-time init of the cursor: prime it just past 'now' so we have
      // a small lead. Only do this once per speaking turn.
      if (nextStartTime === 0 || nextStartTime < now - STALE_CURSOR_S) {
        nextStartTime = now + 0.02;
      }

      // Pre-roll: on the first chunk of a turn, wait until we've buffered
      // enough to ride out minor network jitter.
      const bufferedMs = pendingAudioChunks.reduce((s, c) => s + c.durationS * 1000, 0);
      const isStartingFresh = activeSources.size === 0 && pendingAudioChunks.length > 0;
      if (isStartingFresh && bufferedMs < PREROLL_MS) {
        // Re-arm the drainer for the next tick.
        if (!drainScheduled) {
          drainScheduled = true;
          setTimeout(() => Promise.resolve().then(drainQueue), 20);
        }
        return;
      }

      while (pendingAudioChunks.length > 0) {
        // Never schedule too far ahead — if the WS catches up in a burst,
        // spread the rest across subsequent ticks.
        if (nextStartTime - now > MAX_SCHEDULE_AHEAD_S) break;

        const { float32, durationS } = pendingAudioChunks.shift();
        const buffer = ctx.createBuffer(1, float32.length, PLAYBACK_SAMPLE_RATE);
        buffer.getChannelData(0).set(float32);

        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(analyser); // analyser → destination (set up in init)

        const startAt = Math.max(nextStartTime, now);
        src.start(startAt);
        nextStartTime = startAt + durationS;

        activeSources.add(src);
        src.onended = () => {
          activeSources.delete(src);
          // Turn is over only when everything is drained AND nothing is
          // still sounding.
          if (activeSources.size === 0 && pendingAudioChunks.length === 0) {
            if (isSpeaking) {
              isSpeaking = false;
              callbacks.onSpeakingChange?.(false);
            }
            nextStartTime = 0;
          }
        };
      }

      // If there's still buffered audio we deferred (schedule-ahead guard),
      // re-arm the drainer shortly.
      if (pendingAudioChunks.length > 0 && !drainScheduled) {
        drainScheduled = true;
        setTimeout(() => Promise.resolve().then(drainQueue), 30);
      }
    } catch (e) {
      console.error('[Voice] drainQueue error:', e);
      drainScheduled = false;
    }
  }

  /**
   * Stop ALL scheduled playback (mute / interrupt). Old code only tracked the
   * most recent source, so already-scheduled chunks kept playing and the mute
   * button looked dead.
   */
  function stopPlayback() {
    pendingAudioChunks = [];
    drainScheduled = false;
    activeSources.forEach((src) => {
      try { src.onended = null; src.stop(); } catch (e) { /* already ended */ }
    });
    activeSources.clear();
    nextStartTime = 0;
    if (isSpeaking) {
      isSpeaking = false;
      callbacks.onSpeakingChange?.(false);
    }
  }

  /**
   * Returns the live AnalyserNode so the avatar can read frequency data for
   * real audio-driven lip-sync. Null until the AudioContext exists.
   */
  function getAnalyser() {
    return analyser;
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

      // Create a ScriptProcessor to capture raw audio.
      // (AudioWorklet would be better but requires serving a separate file;
      //  keeping ScriptProcessor preserves the single-bundle Electron/APK build.)
      const source = ctx.createMediaStreamSource(micStream);
      const processor = ctx.createScriptProcessor(2048, 1, 1);

      processor.onaudioprocess = (e) => {
        if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) return;
        if (isSpeaking) return; // simple echo gate: don't send while she talks

        const inputData = e.inputBuffer.getChannelData(0);

        // Anti-aliased downsample to 16kHz
        const resampledData = resampleAudio(inputData, ctx.sampleRate, AUDIO_SAMPLE_RATE);

        // Float32 → Int16
        const int16 = new Int16Array(resampledData.length);
        for (let i = 0; i < resampledData.length; i++) {
          const s = Math.max(-1, Math.min(1, resampledData[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Int16 → base64 (chunked build — faster than char-by-char concat)
        const uint8 = new Uint8Array(int16.buffer);
        let binary = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < uint8.length; i += CHUNK) {
          binary += String.fromCharCode.apply(null, uint8.subarray(i, i + CHUNK));
        }
        const base64 = btoa(binary);

        ws.send(JSON.stringify({ type: 'audio', audio: base64 }));
      };

      source.connect(processor);
      processor.connect(analyser || ctx.destination); // keep alive; analyser→dest if present

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

  /**
   * Downsample (or upsample) Float32 PCM with a cheap one-pole low-pass
   * pre-filter when downsampling, to suppress the aliasing that made the
   * old linear-only resampler sound harsh.
   */
  function resampleAudio(inputData, inputRate, outputRate) {
    if (inputRate === outputRate) return inputData;

    const ratio = inputRate / outputRate;
    const outputLength = Math.max(1, Math.round(inputData.length / ratio));
    const output = new Float32Array(outputLength);

    if (inputRate > outputRate) {
      // Downsampling: apply a one-pole LPF at ~outputRate/2 first.
      const cutoff = outputRate / 2;
      const dt = 1 / inputRate;
      const rc = 1 / (2 * Math.PI * cutoff);
      const alpha = dt / (rc + dt);
      let prev = inputData[0] || 0;
      const filtered = new Float32Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        prev += alpha * (inputData[i] - prev);
        filtered[i] = prev;
      }
      for (let i = 0; i < outputLength; i++) {
        const srcIdx = i * ratio;
        const floor = Math.floor(srcIdx);
        const ceil = Math.min(floor + 1, filtered.length - 1);
        const frac = srcIdx - floor;
        output[i] = filtered[floor] * (1 - frac) + filtered[ceil] * frac;
      }
    } else {
      // Upsampling: plain linear interpolation is fine.
      for (let i = 0; i < outputLength; i++) {
        const srcIdx = i * ratio;
        const floor = Math.floor(srcIdx);
        const ceil = Math.min(floor + 1, inputData.length - 1);
        const frac = srcIdx - floor;
        output[i] = inputData[floor] * (1 - frac) + inputData[ceil] * frac;
      }
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
    getAnalyser,
    getState,
  };
}
