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
import { sendAiChatMessage, cleanAiResponseText, getAiConfig, extractEmotion } from './services/aiProvider';
import { addCategorizedMemory, getLocalMemories } from './services/memoryStore';
import { createLiveVoiceEngine } from './services/liveVoiceEngine';
import { initMoodEngine, updateMood, getMood, getMoodEmoji, getMoodLabel } from './services/moodEngine';
import { getSessionGreeting, checkIdlePrompt, getTimeContext } from './services/proactiveEngine';

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

  // Companion & Mood State
  const [mood, setMood] = useState(getMood());
  const [avatarExpression, setAvatarExpression] = useState('happy');
  const [lastActivityTime, setLastActivityTime] = useState(Date.now());
  const [sessionStartTime] = useState(Date.now());
  const [rateLimitStats, setRateLimitStats] = useState(null);

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

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Auto-scroll chat panel
  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isChatPanelOpen]);

  // =====================================================================
  // 1. Initialize Mood & Proactive Greeting
  // =====================================================================
  useEffect(() => {
    initMoodEngine();
    setMood(getMood());

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
    setMood(getMood());
  }, []);

  // Proactive Idle Check & Mood Decay timer
  useEffect(() => {
    const timer = setInterval(() => {
      // Mood decay tick
      updateMood('idle_tick');
      setMood(getMood());

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
          setMood(getMood());
        }
      },
      onTranscription: (role, text) => {
        setLastActivityTime(Date.now());
        if (role === 'user') {
          setMessages(prev => [...prev, {
            role: 'user',
            content: text,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }]);
          setAvatarExpression('listening');
          updateMood('message_sent', { text });
          setMood(getMood());
        } else if (role === 'model') {
          const { text: cleanText, emotion } = extractEmotion(text);
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
          setMood(getMood());
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

    return () => {
      engine.disconnect();
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

    const screenToUse = screenshot || attachedScreenshot || (isContinuousVision ? latestCapturedFrameRef.current : null);
    setLastActivityTime(Date.now());

    // Update mood for user interaction
    updateMood('message_sent', { text: textToSend });
    setMood(getMood());

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
      const rawAiReply = await sendAiChatMessage(textToSend, history, screenToUse);
      const { text: sanitizedReply, emotion } = extractEmotion(cleanAiResponseText(rawAiReply));

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: sanitizedReply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);

      if (isAutoSpeak) {
        fallbackSpeakText(sanitizedReply);
      }
      setAvatarExpression(emotion || 'happy');
      updateMood('message_received', { text: sanitizedReply });
      setMood(getMood());
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
  }, [inputText, isProcessing, attachedScreenshot, isAutoSpeak, liveStatus]);

  // Fallback TTS when offline / non-Live mode (Strictly Female voice)
  const fallbackSpeakText = useCallback((text) => {
    if (!window.speechSynthesis || !text) return;
    window.speechSynthesis.cancel();

    const speakWithAvailableVoices = () => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.94;
      utterance.pitch = 1.25; // Higher pitch for sweet female resonance

      const voices = window.speechSynthesis.getVoices();
      // Exclude male names explicitly
      const femaleCandidates = voices.filter(v => {
        const name = v.name.toLowerCase();
        return !name.includes('david') && !name.includes('mark') && !name.includes('george') && !name.includes('richard') && !name.includes('guy') && !name.includes('male');
      });

      // Prefer explicit female voice names
      const femaleVoice = femaleCandidates.find(v => 
        v.name.includes('Zira') || v.name.includes('Hazel') || v.name.includes('Susan') || 
        v.name.includes('Samantha') || v.name.includes('Victoria') || v.name.includes('Female') || 
        v.name.includes('Google US English') || v.name.includes('Woman')
      ) || femaleCandidates[0] || voices[0];

      if (femaleVoice) utterance.voice = femaleVoice;

      utterance.onstart = () => { setIsSpeaking(true); setAvatarExpression('speaking'); };
      utterance.onend = () => { setIsSpeaking(false); setAvatarExpression('happy'); };
      utterance.onerror = () => { setIsSpeaking(false); setAvatarExpression('happy'); };

      window.speechSynthesis.speak(utterance);
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

  const handleToggleListening = () => {
    if (liveEngineRef.current) {
      liveEngineRef.current.toggleMic();
    }
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

          {/* Dynamic Mood & Affection Pill */}
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-zinc-900/60 border border-zinc-800/60 backdrop-blur-md">
            <span className="text-sm">{getMoodEmoji()}</span>
            <span className="text-[11px] font-medium text-zinc-300 capitalize">{getMoodLabel()}</span>
            <div className="w-px h-3 bg-zinc-800 mx-1" />
            <Heart className="w-3 h-3 text-rose-400 fill-rose-400" />
            <span className="text-[11px] font-mono text-rose-300">{Math.round(mood.affection)}%</span>
          </div>

          {/* Live Voice Connection Status */}
          <div className={`px-2.5 py-1 rounded-xl text-[10px] font-mono uppercase tracking-wider flex items-center gap-1.5 border backdrop-blur-md ${
            liveStatus === 'connected' ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300' :
            liveStatus === 'connecting' ? 'bg-amber-950/40 border-amber-800/60 text-amber-300' :
            'bg-zinc-900/60 border-zinc-800 text-zinc-400'
          }`}>
            <Radio className={`w-3 h-3 ${liveStatus === 'connected' ? 'text-emerald-400 animate-pulse' : ''}`} />
            <span>{liveStatus === 'connected' ? 'Live Voice (Aoede)' : liveStatus === 'connecting' ? 'Connecting...' : 'Text Mode'}</span>
          </div>
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
        />
      </main>

      {/* ==============================
          BOTTOM CONTROLS & VOICE BAR
      ============================== */}
      <footer className="absolute bottom-6 left-0 right-0 z-30 flex flex-col items-center pointer-events-none px-4 gap-4">
        
        {/* Floating Voice Indicator Pill */}
        <div className="flex items-center gap-3 px-5 py-2.5 rounded-3xl bg-zinc-950/85 border border-zinc-800/80 backdrop-blur-xl shadow-2xl pointer-events-auto">
          {/* Microphone Toggle */}
          <button
            onClick={handleToggleListening}
            className={`p-3 rounded-2xl transition-all flex items-center justify-center ${
              isListening
                ? 'bg-rose-500 text-white shadow-[0_0_20px_rgba(244,63,94,0.6)] animate-pulse scale-105'
                : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
            }`}
          >
            {isListening ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </button>

          {/* Status Label */}
          <div className="flex flex-col px-2">
            <span className="text-xs font-semibold text-zinc-200 tracking-wide">
              {isSpeaking ? 'MYRAA IS SPEAKING...' : isListening ? 'LISTENING TO AARAV...' : isProcessing ? 'THINKING...' : 'IDLE COMPANION'}
            </span>
            <span className="text-[10px] text-zinc-500 font-mono">
              {liveStatus === 'connected' ? 'GEMINI LIVE WS AUDIO' : 'TEXT & TTS FALLBACK'}
            </span>
          </div>

          {/* Audio Output Mute Toggle */}
          <button
            onClick={() => {
              setIsAutoSpeak(!isAutoSpeak);
              if (isSpeaking && liveEngineRef.current) liveEngineRef.current.stopPlayback();
            }}
            className={`p-2.5 rounded-xl transition ${
              isAutoSpeak ? 'text-emerald-400 bg-emerald-950/30' : 'text-zinc-500 bg-zinc-900'
            }`}
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
                <div className="leading-relaxed whitespace-pre-wrap">{msg.content}</div>
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
      />

      <BrowserAgentModal 
        isOpen={isBrowserOpen} 
        onClose={() => setIsBrowserOpen(false)} 
      />

    </div>
  );
}
