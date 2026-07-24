import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Sparkles, Eye, Settings as SettingsIcon, Send,
  Mic, MicOff, Volume2, VolumeX, MessageSquare, X, Radio, Brain, Globe,
  Activity, Heart, Smile, Zap, Coffee, CheckCircle, AlertCircle
} from 'lucide-react';

import AvatarCanvas from './components/AvatarCanvas';
import SettingsModal from './components/SettingsModal';
import MemoryDashboardModal from './components/MemoryDashboardModal';
import BrowserAgentModal from './components/BrowserAgentModal';
import { sendAiChatMessage, cleanAiResponseText, getAiConfig, extractEmotion, setMoodContext } from './services/aiProvider';
import {
  addCategorizedMemory,
  getLocalMemories,
  autoExtractMemoriesFromChat,
  syncMemoriesFromServer,
  extractMemoriesFromTranscript
} from './services/memoryStore';
import { createLiveVoiceEngine } from './services/liveVoiceEngine';
import { initMoodEngine, updateMood, getMood, getMoodEmoji, getMoodLabel } from './services/moodEngine';
import { getSessionGreeting, checkIdlePrompt, getTimeContext } from './services/proactiveEngine';
import { executeDirectCommand } from './services/desktopCommandEngine';

// =====================================================================
// Voice selection + shared TTS audio context helpers (module-scoped)
// =====================================================================

// Ordered preference list of premium adult-female browser voices. The first
// match in this list wins; this avoids the old "voices[0]" trap that could
// land on a high-pitched default and make MYRAA sound child-like.
const PREMIUM_FEMALE_VOICES = [
  'AriaNeural', 'JennyNeural', 'MichelleNeural', 'SoniaNeural', 'LibbyNeural',
  'Google US English', 'Samantha', 'Victoria', 'Karen', 'Tessa', 'Moira',
  'Zira', 'Hazel', 'Susan', 'Fiona', 'Serena'
];

// Male / explicitly non-female tokens we never want.
const MALE_VOICE_TOKENS = ['david', 'mark', 'george', 'richard', 'guy', 'male', 'alex', 'fred', 'tom', 'daniel', 'james'];

function pickPremiumFemaleVoice(voices) {
  if (!voices || voices.length === 0) return null;
  const lowerNames = voices.map(v => (v.name || '').toLowerCase());

  // 1. Exact premium pick by priority order.
  for (const wanted of PREMIUM_FEMALE_VOICES) {
    const idx = lowerNames.findIndex(n => n.includes(wanted.toLowerCase()));
    if (idx >= 0) return voices[idx];
  }

  // 2. Any en-* voice with a female token in the name.
  const femaleTokenVoices = voices.filter((v, i) => {
    const n = lowerNames[i];
    return (n.includes('female') || n.includes('woman') || n.includes('aria') || n.includes('jenny')) &&
      !MALE_VOICE_TOKENS.some(tok => n.includes(tok));
  });
  if (femaleTokenVoices.length > 0) return femaleTokenVoices[0];

  // 3. Any English voice that isn't explicitly male.
  const englishNonMale = voices.filter((v, i) => {
    const n = lowerNames[i];
    return (v.lang || '').toLowerCase().startsWith('en') &&
      !MALE_VOICE_TOKENS.some(tok => n.includes(tok));
  });
  if (englishNonMale.length > 0) return englishNonMale[0];

  // 4. Last resort: any non-male voice (never blindly voices[0]).
  const anyNonMale = voices.filter((v, i) => !MALE_VOICE_TOKENS.some(tok => lowerNames[i].includes(tok)));
  return anyNonMale[0] || null;
}

// One shared AudioContext for TTS playback taps (used by avatar lip-sync in
// Phase 3). Lazily created on first use.
let _ttsAudioCtx = null;
function getTtsAudioContext() {
  if (!_ttsAudioCtx || _ttsAudioCtx.state === 'closed') {
    _ttsAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_ttsAudioCtx.state === 'suspended') _ttsAudioCtx.resume();
  return _ttsAudioCtx;
}

export default function App() {
  // Modals & Panels
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const [isChatPanelOpen, setIsChatPanelOpen] = useState(false);

  // Vision State
  const [isContinuousVision, setIsContinuousVision] = useState(false);
  const [visionStream, setVisionStream] = useState(null);
  const visionIntervalRef = useRef(null);

  // Voice Engine State
  const [liveEngine, setLiveEngine] = useState(null);
  const [liveStatus, setLiveStatus] = useState('disconnected'); // 'connected' | 'connecting' | 'disconnected' | 'fallback_text_mode'
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isAutoSpeak, setIsAutoSpeak] = useState(true);
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);
  const [avatarAnalyser, setAvatarAnalyser] = useState(null); // AnalyserNode driving real lip-sync

  // Companion & Mood State
  const [mood, setMood] = useState(getMood());
  const [avatarExpression, setAvatarExpression] = useState('happy');
  const [lastActivityTime, setLastActivityTime] = useState(Date.now());
  const [sessionStartTime] = useState(Date.now());
  const [rateLimitStats, setRateLimitStats] = useState(null);

  // Keep the AI prompt context in sync with MYRAA's live mood so her words
  // actually reflect how she feels (tired/curious/affectionate).
  const refreshMood = useCallback(() => {
    const m = getMood();
    setMood(m);
    setMoodContext(m);
    return m;
  }, []);

  // Chat State
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [attachedScreenshot, setAttachedScreenshot] = useState(null);

  // Refs
  const messagesRef = useRef([]);
  const chatBottomRef = useRef(null);
  const liveEngineRef = useRef(null);
  const latestCapturedFrameRef = useRef(null);
  const speechRecognitionRef = useRef(null);
  const neuralAudioRef = useRef(null);
  const isAutoSpeakRef = useRef(isAutoSpeak); // latest toggle value for async handlers
  const liveStatusRef = useRef(liveStatus);   // latest live status for handlers

  useEffect(() => { isAutoSpeakRef.current = isAutoSpeak; }, [isAutoSpeak]);
  useEffect(() => { liveStatusRef.current = liveStatus; }, [liveStatus]);

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Auto-scroll chat panel
  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isChatPanelOpen]);

  // =====================================================================
  // 1. Initialize Mood & Proactive Greeting, sync memory from server
  // =====================================================================
  useEffect(() => {
    initMoodEngine();
    refreshMood();

    // Pull server-side memories (from Live voice sessions) into localStorage
    // so the AI prompt context sees everything MYRAA has learned across runs.
    syncMemoriesFromServer().catch(() => {});

    // Fetch initial greeting based on time of day & memories
    const memories = getLocalMemories();
    const greetingText = getSessionGreeting(memories, Date.now() - 3600000); // assume 1 hour since last
    const { text, emotion } = extractEmotion(greetingText);

    setMessages([
      {
        role: 'assistant',
        content: text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ]);
    setAvatarExpression(emotion || 'happy');
    updateMood('session_start');
    refreshMood();
  }, []);

  // Proactive Idle Check & Mood Decay timer
  useEffect(() => {
    const timer = setInterval(() => {
      // Mood decay tick
      updateMood('idle_tick');
      refreshMood();

      // Proactive idle check if user has been quiet for over 10 min
      const config = getAiConfig();
      if (config.proactiveEnabled !== false && !isProcessing && !isSpeaking) {
        const sessionDur = Math.floor((Date.now() - sessionStartTime) / 60000);
        const idlePrompt = checkIdlePrompt(lastActivityTime, sessionDur);
        if (idlePrompt) {
          const { text, emotion } = extractEmotion(idlePrompt);
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: text,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }]);
          setAvatarExpression(emotion || 'shy');
          if (liveEngineRef.current && liveStatus === 'connected') {
            liveEngineRef.current.sendText(text); // let AI speak or we use fallback
          } else if (isAutoSpeak) {
            fallbackSpeakText(text);
          }
          setLastActivityTime(Date.now());
        }
      }
    }, 60000); // Check every minute

    return () => clearInterval(timer);
  }, [lastActivityTime, sessionStartTime, isProcessing, isSpeaking, isAutoSpeak, liveStatus]);

  const triggerTopicMoodEvents = (text) => {
    if (!text || typeof text !== 'string') return;
    const lower = text.toLowerCase();
    if (/\b(code|bug|api|server|deploy|bugfix|refactor|typescript|react|vite)\b/.test(lower)) {
      updateMood('work_topic', { text });
    } else if (/\b(feel|love|miss|tired|stressed|how are you|about you|us)\b/.test(lower)) {
      updateMood('personal_topic', { text });
    } else if (/\b(interesting|new|curious|wonder|what if|have you heard)\b/.test(lower)) {
      updateMood('new_interest', { text });
    }
    updateMood('message_sent', { text });
    refreshMood();
  };

  // =====================================================================
  // 2. Initialize Gemini Live Voice WebSocket Engine
  // =====================================================================
  useEffect(() => {
    const config = getAiConfig();
    if (config.voiceMode !== 'live') return;

    const engine = createLiveVoiceEngine({
      onStatusChange: (status) => {
        setLiveStatus(status);
        if (status === 'connected') {
          updateMood('message_received');
          refreshMood();
        }
      },
      onTranscription: (role, text) => {
	        setLastActivityTime(Date.now());
	        if (role === 'user') {
	          executeDirectCommand(text).then(toolResults => {
	            if (toolResults && toolResults.length > 0) {
	              const confirmations = toolResults
	                .filter(r => r.success && r.humanMessage)
	                .map(r => r.humanMessage);
	              if (confirmations.length > 0) {
	                setMessages(prev => [...prev, {
	                  role: 'assistant',
	                  content: `[emotion:happy] ${confirmations.join(' | ')} 💕`,
	                  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	                }]);
	              }
	            }
	          });
	          autoExtractMemoriesFromChat(text);
	          setMessages(prev => [...prev, {
            role: 'user',
            content: text,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }]);
          setAvatarExpression('listening');
          triggerTopicMoodEvents(text);
	        } else if (role === 'model') {
	          const { text: cleanText, emotion } = extractEmotion(text);
	          executeDirectCommand(cleanText).then(toolResults => {
	            if (toolResults && toolResults.length > 0) {
	              const confirmations = toolResults
	                .filter(r => r.success && r.humanMessage)
	                .map(r => r.humanMessage);
	              if (confirmations.length > 0) {
	                setMessages(prev => [...prev, {
	                  role: 'assistant',
	                  content: `[emotion:happy] ${confirmations.join(' | ')} 💕`,
	                  isStreaming: true,
	                  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	                }]);
	              }
	            }
	          });
	          setMessages(prev => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.role === 'assistant' && last.isStreaming) {
              last.content += cleanText;
            } else {
              copy.push({
                role: 'assistant',
                content: cleanText,
                isStreaming: true,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              });
            }
            return copy;
          });
          if (emotion) setAvatarExpression(emotion);
          updateMood('message_received', { text: cleanText });
          refreshMood();
        }
      },
      onSpeakingChange: (speaking) => {
        setIsSpeaking(speaking);
        if (speaking) setAvatarExpression('speaking');
        else setAvatarExpression('happy');
      },
      onListeningChange: (listening) => {
        setIsListening(listening);
        if (listening && !isSpeaking) setAvatarExpression('listening');
      },
      onMemorySync: (updatedMemories) => {
        console.log('[App] Memory sync received from backend:', updatedMemories.length);
        // Server-side memory pipeline updated memories.json — re-sync local.
        syncMemoriesFromServer(true).catch(() => {});
      },
      onToolResult: (tool, result) => {
        console.log(`[App] Tool executed: ${tool}`, result);
      },
      onRateLimitUpdate: (stats) => {
        setRateLimitStats(stats);
      },
      onTurnComplete: () => {
        setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m));
        setAvatarExpression('happy');
        // v1.2.0: now that the Live turn's transcription is fully in messages,
        // run AI-driven memory extraction over the recent transcript so
        // memories learned during voice mode persist (was Live-only before).
        const lastFew = (messagesRef.current || []).slice(-6);
        if (lastFew.length >= 2) {
          extractMemoriesFromTranscript(lastFew).catch(() => {});
        }
      },
      onInterrupted: () => {
        setIsSpeaking(false);
        setAvatarExpression('listening');
      },
      onError: (err) => {
        console.error('[Live Engine Error]', err);
      }
    });

    engine.connect();
    setLiveEngine(engine);
    liveEngineRef.current = engine;

    // Tap the engine's analyser for avatar lip-sync. The engine builds the
    // AnalyserNode lazily inside initAudioContext() (on first audio frame),
    // so poll briefly until it exists, then hand it to AvatarCanvas.
    const analyserPoll = setInterval(() => {
      const an = engine.getAnalyser && engine.getAnalyser();
      if (an) {
        setAvatarAnalyser(an);
        clearInterval(analyserPoll);
      }
    }, 500);
    setTimeout(() => clearInterval(analyserPoll), 10000); // cap polling

    return () => {
      engine.disconnect();
      clearInterval(analyserPoll);
    };
  }, []);

  // =====================================================================
  // 3. Continuous Screen Vision via WebRTC (`getDisplayMedia`)
  // =====================================================================
  const toggleContinuousVision = async () => {
    if (isContinuousVision) {
      if (visionIntervalRef.current) clearInterval(visionIntervalRef.current);
      if (visionStream) {
        visionStream.getTracks().forEach(track => track.stop());
      }
      setVisionStream(null);
      setIsContinuousVision(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { max: 5 }, width: { max: 1280 } },
        audio: false
      });

      setVisionStream(stream);
      setIsContinuousVision(true);

      stream.getVideoTracks()[0].onended = () => {
        if (visionIntervalRef.current) clearInterval(visionIntervalRef.current);
        setIsContinuousVision(false);
        setVisionStream(null);
      };

      const videoEl = document.createElement('video');
      videoEl.srcObject = stream;
      await videoEl.play();

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      const config = getAiConfig();
      const fps = config.screenVisionFps || 2;
      const intervalMs = 1000 / fps;

      visionIntervalRef.current = setInterval(() => {
        if (!videoEl.videoWidth) return;
        canvas.width = videoEl.videoWidth;
        canvas.height = videoEl.videoHeight;
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

        const quality = config.screenVisionQuality || 0.6;
        const base64Jpeg = canvas.toDataURL('image/jpeg', quality);
        latestCapturedFrameRef.current = base64Jpeg;

        if (liveEngineRef.current && liveStatus === 'connected') {
          liveEngineRef.current.sendScreenFrame(base64Jpeg);
        }
      }, intervalMs);

    } catch (err) {
      console.error('[Screen Vision] Permission denied or error:', err);
      setIsContinuousVision(false);
    }
  };

  // =====================================================================
  // 4. Send Message (Handles WebSocket Live or HTTP Text mode)
  // =====================================================================
  const handleSendMessage = useCallback(async (customPrompt = null, screenshot = null) => {
    const textToSend = customPrompt || inputText;
    if (!textToSend.trim() && !screenshot && !attachedScreenshot) return;
    if (isProcessing) return;

    // Check and execute desktop/web command immediately ("open youtube", etc.)
    const toolResults = await executeDirectCommand(textToSend);
    autoExtractMemoriesFromChat(textToSend);

    // If a desktop tool ran, push a quick confirmation into chat so MYRAA
    // can acknowledge what she did.
    if (toolResults && toolResults.length > 0) {
      const confirmations = toolResults
        .filter(r => r.success && r.humanMessage)
        .map(r => r.humanMessage);
      if (confirmations.length > 0) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `[emotion:happy] ${confirmations.join(' | ')} 💕`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }]);
      }
    }

    // Autonomous web search: detect queries that need current info and
    // pre-fetch results so MYRAA can answer from live data.
    let webContext = '';
    const needsWebInfo = /\b(what.?.?.?s |what is |latest |current |find |search |how do |how to |news |who is |define |explain |tell me about )/i;
    if (needsWebInfo.test(textToSend) && !/(?:open|play|volume|mute)\s/i.test(textToSend)) {
      try {
        const host = window?.location?.hostname || 'localhost';
        const webRes = await fetch(`http://${host}:3001/api/web/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: textToSend.slice(0, 200), count: 4 })
        });
        if (webRes.ok) {
          const webData = await webRes.json();
          if (webData.results && webData.results.length > 0) {
            webContext =
              '\n\n[RECENT WEB SEARCH RESULTS \u2014 use these to answer if relevant]\n' +
              webData.results.map(r =>
                '- ' + r.title + ': ' + r.url + '\n  ' + (r.snippet || '')
              ).join('\n') +
              '\n[END WEB RESULTS]';
          }
        }
      } catch (e) {
        // Search unavailable \u2014 continue silently.
      }
    }

    // Topic-based mood events & user interaction updates
    triggerTopicMoodEvents(textToSend);

    const screenToUse = screenshot || attachedScreenshot || (isContinuousVision ? latestCapturedFrameRef.current : null);
    setLastActivityTime(Date.now());

    // If connected to Gemini Live WebSocket, send via WebSocket
    if (liveEngineRef.current && liveStatus === 'connected') {
      if (screenToUse) {
        liveEngineRef.current.sendScreenFrame(screenToUse);
      }
      liveEngineRef.current.sendText(textToSend);
      setInputText('');
      setAttachedScreenshot(null);
      setMessages(prev => [...prev, {
        role: 'user',
        content: textToSend,
        screenshot: screenToUse,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
      setAvatarExpression('thinking');
      // v1.2.0: Live mode now ALSO extracts memories (was skipped before).
      // Fire on the next tick so we don't delay the WS send.
      setMessages(prev => {
        const lastFew = [...prev, { role: 'user', content: textToSend }].slice(-6);
        extractMemoriesFromTranscript(lastFew).catch(() => {});
        return prev;
      });
      return;
    }

    // Otherwise, HTTP proxy fallback
    const userMsgObj = {
      role: 'user',
      content: textToSend,
      screenshot: screenToUse,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsgObj]);
    setInputText('');
    setAttachedScreenshot(null);
    setIsProcessing(true);
    setAvatarExpression('thinking');

    try {
      const history = messagesRef.current.map(m => ({ role: m.role, content: m.content }));
      // If autonomous web search fetched results, append them to the
      // user message so the AI can answer from current info. Don't show
      // the raw context in the transcript — that's internal.
      const augMsg = webContext ? textToSend + webContext : textToSend;
      let rawAiReply = await sendAiChatMessage(augMsg, history, screenToUse);

      // Check for mid-conversation LLM tool calls ([tool:search], [tool:read_web], etc.)
      if (/\[tool:\w+\]/i.test(rawAiReply)) {
        const host = window?.location?.hostname || 'localhost';
        const toolMatch = rawAiReply.match(/\[tool:(\w+)\]([\s\S]*?)\[\/tool\]/i);
        if (toolMatch) {
          const toolType = toolMatch[1].toLowerCase();
          const toolArg = toolMatch[2].trim();
          let toolResultText = '';

          if (toolType === 'search') {
            try {
              const res = await fetch(`http://${host}:3001/api/web/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: toolArg, count: 5 })
              });
              const data = await res.json();
              if (data.results && data.results.length > 0) {
                toolResultText = `[TOOL RESULT FOR SEARCH "${toolArg}"]:\n` +
                  data.results.map(r => `- ${r.title}: ${r.snippet}`).join('\n');
              }
            } catch (e) {}
          } else if (toolType === 'read_web') {
            try {
              const res = await fetch(`http://${host}:3001/api/web/read`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: toolArg })
              });
              const data = await res.json();
              if (data.summary || data.text) {
                toolResultText = `[TOOL RESULT FOR READ WEB "${toolArg}"]:\n${data.summary || data.text}`;
              }
            } catch (e) {}
          }

          if (toolResultText) {
            const intermediateText = rawAiReply.replace(/\[tool:\w+\][\s\S]*?\[\/tool\]/gi, '').trim();
            const nextHistory = [...history, { role: 'assistant', content: intermediateText || 'Let me look that up for you!' }];
            rawAiReply = await sendAiChatMessage(toolResultText, nextHistory, screenToUse);
          }
        }
      }

      const { text: sanitizedReply, emotion } = extractEmotion(cleanAiResponseText(rawAiReply));

      // Tool commands the AI itself decided to invoke.
      const replyToolResults = await executeDirectCommand(sanitizedReply);
      if (replyToolResults && replyToolResults.length > 0) {
        const confirmations = replyToolResults
          .filter(r => r.success && r.humanMessage)
          .map(r => r.humanMessage);
        if (confirmations.length > 0) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `[emotion:happy] ${confirmations.join(' | ')} 💕`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }]);
        }
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: sanitizedReply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);

      if (isAutoSpeakRef.current) {
        fallbackSpeakText(sanitizedReply);
      }
      setAvatarExpression(emotion || 'happy');
      updateMood('message_received', { text: sanitizedReply });
      refreshMood();

      // v1.2.0: AI-driven memory extraction over recent turns (regex fallback
      // already fired above; the AI call covers anything it missed).
      setMessages(prev => {
        const lastFew = [...prev].slice(-6);
        extractMemoriesFromTranscript(lastFew).catch(() => {});
        return prev;
      });
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `My apologies Aarav, I hit a slight snag: ${err.message}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
      setAvatarExpression('sad');
    } finally {
      setIsProcessing(false);
    }
  }, [inputText, isProcessing, attachedScreenshot, liveStatus]);

  // High-Quality Neural TTS (Edge female voice) with browser TTS fallback.
  // v1.2.0: warm mature female voice, streaming playback (low first-word
  // latency), and ref-based gating so the speaker button can't be defeated
  // by a stale useCallback closure.
  const fallbackSpeakText = useCallback(async (text) => {
    if (!text || !isAutoSpeakRef.current) return;

    // Strip emotion tags / think blocks so they're never spoken aloud.
    const cleanText = String(text)
      .replace(/\[emotion:\w+\]\s*/gi, '')
      .replace(/^\*Response:\*\s*/i, '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .trim();
    if (!cleanText) return;

    // Stop any existing speech right away
    if (neuralAudioRef.current) {
      try { neuralAudioRef.current.pause(); } catch(e) {}
      neuralAudioRef.current = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();

    // Try streaming Edge Neural TTS via an <audio> element URL.
    // Browsers natively play MP3 data progressively as it arrives over the
    // network — zero client-side buffering, true streaming.
    // If autoplay is blocked or the server is unreachable, fall through to
    // browser speechSynthesis.
    const backendHost = window?.location?.hostname || 'localhost';
    try {
      const ttsUrl = `http://${backendHost}:3001/api/ai/tts?text=${encodeURIComponent(cleanText)}&voice=en-US-JennyNeural&rate=${encodeURIComponent('+0%')}&pitch=${encodeURIComponent('+0%')}&volume=${encodeURIComponent('+0%')}`;
      const audio = new Audio(ttsUrl);
      neuralAudioRef.current = audio;

      // Tap the audio element so the avatar can drive lip-sync from it.
      try {
        const audioCtx = getTtsAudioContext();
        if (!audio._myraaSource) {
          const src = audioCtx.createMediaElementSource(audio);
          const an = audioCtx.createAnalyser();
          an.fftSize = 512;
          an.smoothingTimeConstant = 0.6;
          src.connect(an);
          an.connect(audioCtx.destination);
          audio._myraaSource = src;
          audio._myraaAnalyser = an;
        }
        setAvatarAnalyser(audio._myraaAnalyser);
      } catch (e) {
        // Some hosts disallow MediaElementSource on cross-origin audio;
        // silent fallback keeps speech working without analyser-driven lips.
      }

      audio.onplay = () => { setIsSpeaking(true); };
      audio.onended = () => { setIsSpeaking(false); neuralAudioRef.current = null; };
      audio.onerror = () => { setIsSpeaking(false); neuralAudioRef.current = null; };
      await audio.play();
      return; // success — don't fall through to browser TTS
    } catch (e) {
      console.warn("Neural TTS server unreachable or blocked, falling back to browser TTS:", e);
      if (neuralAudioRef.current) { try { neuralAudioRef.current.pause(); } catch(e2) {} neuralAudioRef.current = null; }
    }

    if (!window.speechSynthesis) return;
    const speakWithAvailableVoices = () => {
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.rate = 0.96;
      utterance.pitch = 0.95;
      utterance.volume = 1.0;

      const voices = window.speechSynthesis.getVoices();
      const picked = pickPremiumFemaleVoice(voices);
      if (picked) utterance.voice = picked;

      utterance.onstart = () => { setIsSpeaking(true); };
      utterance.onend = () => { setIsSpeaking(false); };
      utterance.onerror = () => { setIsSpeaking(false); };

      window.speechSynthesis.speak(utterance);
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    };

    const currentVoices = window.speechSynthesis.getVoices();
    if (currentVoices.length === 0) {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.onvoiceschanged = null;
        speakWithAvailableVoices();
      };
    } else {
      speakWithAvailableVoices();
    }
  }, []);

  // Continuous auto-listen mode: click mic once → it listens, auto-submits, Myraa responds, then listens again
  const continuousListenRef = useRef(false);

  const startSpeechRecognition = useCallback(() => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) return;
    if (speechRecognitionRef.current) {
      try { speechRecognitionRef.current.abort(); } catch(e) {}
    }
    try {
      const rec = new SpeechRec();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = 'en-US';
      let finalTranscript = '';
      let silenceTimer = null;
      rec.onstart = () => setIsListening(true);
      rec.onresult = (event) => {
        if (silenceTimer) clearTimeout(silenceTimer);
        let transcript = '';
        let hasFinal = false;
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript = event.results[i][0].transcript;
            hasFinal = true;
          }
        }
        setInputText(transcript);
        if (transcript.trim()) {
          finalTranscript = transcript.trim();
        }

        // Fast 650ms silence auto-commit so speech is submitted instantly when you pause
        if (hasFinal) {
          try { rec.stop(); } catch(e) {}
        } else {
          silenceTimer = setTimeout(() => {
            try { rec.stop(); } catch(e) {}
          }, 650);
        }
      };
      rec.onend = () => {
        setIsListening(false);
        speechRecognitionRef.current = null;
        if (finalTranscript && finalTranscript.trim()) {
          // NOTE: do NOT call executeDirectCommand here — handleSendMessage
          // already runs it internally (line ~419). Calling it twice would
          // double-execute every command ("open notepad" would open two
          // windows). Just hand the transcript to handleSendMessage.
          handleSendMessage(finalTranscript);
        }
        // Auto-restart listening after a brief pause (waits for Myraa to finish processing and speaking)
        if (continuousListenRef.current) {
          const waitForSpeech = () => {
            if (isProcessing || isSpeaking || neuralAudioRef.current || window.speechSynthesis?.speaking) {
              setTimeout(waitForSpeech, 350);
            } else {
              setTimeout(() => {
                if (continuousListenRef.current) startSpeechRecognition();
              }, 450);
            }
          };
          // Brief initial delay to allow handleSendMessage state transition to apply
          setTimeout(waitForSpeech, 200);
        }
      };
      rec.onerror = (err) => {
        console.warn("Speech recognition error:", err.error);
        setIsListening(false);
        speechRecognitionRef.current = null;
        // Auto-retry on no-speech or network errors
        if (continuousListenRef.current && (err.error === 'no-speech' || err.error === 'network')) {
          setTimeout(() => {
            if (continuousListenRef.current) startSpeechRecognition();
          }, 500);
        }
      };
      rec.start();
      speechRecognitionRef.current = rec;
    } catch (err) {
      console.error("Speech recognition start failed:", err);
      setIsListening(false);
    }
  }, []);

  const handleToggleListening = () => {
    if (liveStatus === 'connected' && liveEngineRef.current) {
      liveEngineRef.current.toggleMic();
      return;
    }

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      alert("Speech Recognition is not supported in this browser. Please use Chrome/Edge or connect to Live mode!");
      return;
    }

    // Toggle continuous listening mode
    if (continuousListenRef.current) {
      continuousListenRef.current = false;
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.abort(); } catch(e) {}
        speechRecognitionRef.current = null;
      }
      setIsListening(false);
      return;
    }

    continuousListenRef.current = true;
    setIsAutoSpeak(true); // Ensure auto-speak is on when mic is on
    startSpeechRecognition();
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-zinc-950 text-zinc-100 flex flex-col select-none font-sans">
      
      {/* ==============================
          TOP NAVIGATION BAR (COLLAPSIBLE)
      ============================== */}
      {isHeaderCollapsed ? (
        <header className="absolute top-3 left-6 z-30 flex items-center gap-2 pointer-events-auto">
          <button
            onClick={() => setIsHeaderCollapsed(false)}
            className="px-3 py-1.5 rounded-2xl bg-zinc-900/90 border border-zinc-800/90 backdrop-blur-md shadow-xl text-[11px] font-mono text-emerald-300 hover:bg-zinc-800 transition flex items-center gap-2"
          >
            <Sparkles className="w-3 h-3 text-emerald-400" />
            <span>MYRAA // SHOW BAR</span>
          </button>
          {isContinuousVision && (
            <div className="px-2.5 py-1 rounded-xl bg-emerald-950/80 border border-emerald-500/60 text-emerald-300 text-[10px] font-mono animate-pulse flex items-center gap-1.5">
              <Eye className="w-3 h-3 text-emerald-400" />
              <span>LIVE VISION ACTIVE</span>
            </div>
          )}
        </header>
      ) : (
      <header className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-6 py-4 bg-gradient-to-b from-zinc-950 via-zinc-950/80 to-transparent pointer-events-auto">
        
        {/* Brand & Companion Mood */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-zinc-900/80 border border-zinc-800/80 backdrop-blur-md shadow-lg">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.8)]" />
            <span className="text-xs font-bold tracking-widest text-zinc-100 uppercase font-mono">MYRAA // AARAV</span>
          </div>

          {/* Live Voice Connection Status / Clickable Toggle */}
          <button
            onClick={() => {
              if (liveStatus === 'connected') {
                if (liveEngineRef.current) liveEngineRef.current.disconnect();
              } else {
                if (liveEngineRef.current) liveEngineRef.current.connect();
              }
            }}
            className={`px-3 py-1.5 rounded-xl text-[10px] font-mono uppercase tracking-wider flex items-center gap-1.5 border backdrop-blur-md transition-all shadow-md cursor-pointer ${
              liveStatus === 'connected' ? 'bg-emerald-950/60 border-emerald-600 text-emerald-300 hover:bg-emerald-900/60' :
              liveStatus === 'connecting' ? 'bg-amber-950/60 border-amber-600 text-amber-300' :
              'bg-zinc-900/80 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white'
            }`}
            title={liveStatus === 'connected' ? "Click to Disconnect Live Voice" : "Click to Connect Live Voice (Aoede)"}
          >
            <Radio className={`w-3.5 h-3.5 ${liveStatus === 'connected' ? 'text-emerald-400 animate-pulse' : ''}`} />
            <span>{liveStatus === 'connected' ? 'Live Voice (Aoede)' : liveStatus === 'connecting' ? 'Connecting...' : 'Text & Neural Voice Mode'}</span>
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5">
          {/* Continuous Screen Vision Toggle */}
          <button
            onClick={toggleContinuousVision}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-2xl text-xs font-medium border transition-all shadow-lg backdrop-blur-md ${
              isContinuousVision
                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.3)] animate-pulse'
                : 'bg-zinc-900/80 border-zinc-800/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80'
            }`}
            title="Continuous Screen Vision via WebRTC"
          >
            <Eye className="w-4 h-4" />
            <span className="hidden md:inline">{isContinuousVision ? 'Live Vision Active' : 'Enable Live Vision'}</span>
          </button>

          {/* Memory Bank */}
          <button
            onClick={() => setIsMemoryOpen(true)}
            className="p-2.5 rounded-2xl bg-zinc-900/80 border border-zinc-800/80 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 transition-all shadow-lg backdrop-blur-md"
            title="Persistent Memory Core"
          >
            <Brain className="w-4 h-4 text-emerald-400" />
          </button>

          {/* Browser Agent */}
          <button
            onClick={() => setIsBrowserOpen(true)}
            className="p-2.5 rounded-2xl bg-zinc-900/80 border border-zinc-800/80 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 transition-all shadow-lg backdrop-blur-md"
            title="Web Browser Agent"
          >
            <Globe className="w-4 h-4 text-cyan-400" />
          </button>

          {/* Settings */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2.5 rounded-2xl bg-zinc-900/80 border border-zinc-800/80 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 transition-all shadow-lg backdrop-blur-md"
            title="Configuration"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>

          {/* Chat Panel Toggle Button */}
          <button
            onClick={() => setIsChatPanelOpen(!isChatPanelOpen)}
            className={`p-2.5 rounded-2xl border transition-all shadow-lg backdrop-blur-md relative ${
              isChatPanelOpen 
                ? 'bg-zinc-100 border-zinc-100 text-zinc-950' 
                : 'bg-zinc-900/80 border-zinc-800/80 text-zinc-300 hover:text-zinc-100'
            }`}
            title="Toggle Dialogue Panel"
          >
            <MessageSquare className="w-4 h-4" />
            {messages.length > 0 && !isChatPanelOpen && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>

          {/* Collapse Top Header Button */}
          <button
            onClick={() => setIsHeaderCollapsed(true)}
            className="p-2 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
            title="Hide Top Content Bar for clean view"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>
      )}

      {/* ==============================
          MAIN 3D AVATAR CANVAS
      ============================== */}
      <main className="absolute inset-0 z-10">
        <AvatarCanvas 
          expression={avatarExpression}
          isSpeaking={isSpeaking}
          mood={mood}
          audioAnalyser={avatarAnalyser}
        />
      </main>

      {/* ==============================
          BOTTOM CONTROLS & VOICE BAR
      ============================== */}
      <footer className="absolute bottom-6 left-0 right-0 z-30 flex flex-col items-center pointer-events-none px-4 gap-4">
        
        {/* Floating Voice Indicator Pill */}
        <div className="flex items-center gap-3 px-5 py-2.5 rounded-3xl bg-zinc-950/85 border border-zinc-800/80 backdrop-blur-xl shadow-2xl pointer-events-auto">
          {/* Microphone Toggle — Click once for continuous hands-free mode */}
          <button
            onClick={handleToggleListening}
            className={`p-3 rounded-2xl transition-all flex items-center justify-center ${
              isListening
                ? 'bg-rose-500 text-white shadow-[0_0_20px_rgba(244,63,94,0.6)] animate-pulse scale-105'
                : continuousListenRef.current
                  ? 'bg-amber-600 text-white shadow-[0_0_15px_rgba(217,119,6,0.4)]'
                  : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
            }`}
            title={continuousListenRef.current ? "Click to stop continuous listening" : "Click to start hands-free voice mode"}
          >
            {isListening || continuousListenRef.current ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </button>

          {/* Status Label */}
          <div className="flex flex-col px-2">
            <span className="text-xs font-semibold text-zinc-200 tracking-wide">
              {isSpeaking ? 'MYRAA IS SPEAKING...' : isListening ? 'LISTENING...' : isProcessing ? 'THINKING...' : continuousListenRef.current ? 'WAITING TO LISTEN...' : 'TAP MIC FOR HANDS-FREE'}
            </span>
            <span className="text-[10px] text-zinc-500 font-mono">
              {liveStatus === 'connected' ? 'GEMINI LIVE WS AUDIO' : 'NEURAL VOICE (EDGE TTS)'}
            </span>
          </div>

          {/* Audio Output Mute Toggle */}
          <button
            onClick={() => {
              // Compute the NEXT state locally so we never read a stale
              // value from a useCallback closure (root cause of the old
              // "speaker button does nothing" bug).
              const nextMuted = isAutoSpeakRef.current;   // currently ON -> muting
              const nextAutoSpeak = !nextMuted;
              isAutoSpeakRef.current = nextAutoSpeak;     // update ref immediately
              setIsAutoSpeak(nextAutoSpeak);

              if (nextMuted) {
                // MUTE: stop every live source (not just the last one),
                // pause the HTML audio element, and cancel browser synth.
                if (liveEngineRef.current) liveEngineRef.current.stopPlayback();
                if (neuralAudioRef.current) {
                  try { neuralAudioRef.current.pause(); } catch(e) {}
                  neuralAudioRef.current = null;
                }
                if (window.speechSynthesis) window.speechSynthesis.cancel();
                setIsSpeaking(false);
              } else {
                // UNMUTE: replay MYRAA's latest assistant line. In Live mode
                // route through the live engine; otherwise use TTS.
                const lastAssist = [...(messagesRef.current || [])].reverse().find(m => m.role === 'assistant');
                if (lastAssist && lastAssist.content) {
                  if (liveStatusRef.current === 'connected' && liveEngineRef.current) {
                    liveEngineRef.current.sendText(`Say again, in your own words: ${lastAssist.content}`);
                  } else {
                    fallbackSpeakText(lastAssist.content);
                  }
                }
              }
            }}
            className={`p-2.5 rounded-xl transition ${
              isAutoSpeak ? 'text-emerald-400 bg-emerald-950/30' : 'text-zinc-500 bg-zinc-900'
            }`}
            title={isAutoSpeak ? "Mute Myraa's Voice" : "Unmute Myraa's Voice"}
          >
            {isAutoSpeak ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
        </div>

        {/* Input Bar */}
        <div className="w-full max-w-xl pointer-events-auto flex items-center gap-2 p-1.5 rounded-3xl bg-zinc-950/90 border border-zinc-800/80 backdrop-blur-2xl shadow-2xl">
          <input
            type="text"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSendMessage(); }}
            placeholder="Talk with Myraa..."
            className="flex-1 bg-transparent px-4 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none"
          />
          <button
            onClick={() => handleSendMessage()}
            disabled={!inputText.trim() || isProcessing}
            className={`p-3 rounded-2xl transition-all flex items-center justify-center ${
              !inputText.trim() || isProcessing
                ? 'bg-zinc-900 text-zinc-600 cursor-not-allowed'
                : 'bg-zinc-100 hover:bg-white text-zinc-950 shadow-lg'
            }`}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </footer>

      {/* ==============================
          SIDE DIALOGUE CHAT LOG
      ============================== */}
      {isChatPanelOpen && (
        <aside className="absolute top-20 right-6 bottom-28 w-80 z-30 flex flex-col bg-zinc-950/90 border border-zinc-800/80 rounded-3xl backdrop-blur-2xl shadow-2xl overflow-hidden animate-fade-in pointer-events-auto">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800/80 bg-zinc-950/50">
            <span className="text-xs font-semibold uppercase tracking-widest text-zinc-300 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              Dialogue Transcript
            </span>
            <button onClick={() => setIsChatPanelOpen(false)} className="p-1 text-zinc-500 hover:text-zinc-200 rounded-lg">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar text-xs">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-2xl max-w-[90%] space-y-1.5 ${
                  msg.role === 'user'
                    ? 'ml-auto bg-zinc-900 border border-zinc-800 text-zinc-100'
                    : 'mr-auto bg-zinc-900/50 border border-zinc-800/50 text-zinc-300'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono">
                  <span>{msg.role === 'user' ? 'AARAV' : 'MYRAA'}</span>
                  <span>{msg.timestamp}</span>
                </div>
                {msg.screenshot && (
                  <img src={msg.screenshot} alt="Visual Frame" className="w-full rounded-xl border border-zinc-800 object-cover max-h-32 my-1" />
                )}
                <div className="leading-relaxed whitespace-pre-wrap">{(msg.content || '').replace(/\[emotion:\w+\]\s*/gi, '').replace(/^\*Response:\*\s*/i, '').trim()}</div>
              </div>
            ))}
            <div ref={chatBottomRef} />
          </div>
        </aside>
      )}

      {/* ==============================
          MODALS
      ============================== */}
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)}
        onOpenMemory={() => setIsMemoryOpen(true)}
      />

      <MemoryDashboardModal 
        isOpen={isMemoryOpen} 
        onClose={() => setIsMemoryOpen(false)} 
        mood={mood}
        getMoodLabel={getMoodLabel}
        getMoodEmoji={getMoodEmoji}
      />

      <BrowserAgentModal 
        isOpen={isBrowserOpen} 
        onClose={() => setIsBrowserOpen(false)} 
      />

    </div>
  );
}
