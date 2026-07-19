import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Sparkles, Eye, Settings as SettingsIcon, Send,
  Mic, MicOff, Volume2, VolumeX, MessageSquare, X, Radio, Brain, Globe
} from 'lucide-react';

import AvatarCanvas from './components/AvatarCanvas';
import SettingsModal from './components/SettingsModal';
import MemoryDashboardModal from './components/MemoryDashboardModal';
import BrowserAgentModal from './components/BrowserAgentModal';
import { sendAiChatMessage, cleanAiResponseText, getAiConfig } from './services/aiProvider';
import { addCategorizedMemory } from './services/memoryStore';

export default function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const [isCapturingScreen, setIsCapturingScreen] = useState(false);
  const [isContinuousScreen, setIsContinuousScreen] = useState(false);
  const [isChatPanelOpen, setIsChatPanelOpen] = useState(false);

  // Voice State
  const [isListening, setIsListening] = useState(false);
  const [isAutoSpeak, setIsAutoSpeak] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceList, setVoiceList] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [liveSpeechText, setLiveSpeechText] = useState('');

  // Refs
  const isSpeakingRef = useRef(false);
  const isListeningRef = useRef(false);
  const isProcessingRef = useRef(false);
  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const messagesRef = useRef([]);
  const chatBottomRef = useRef(null);

  // Chat State
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `Hey there. I'm MYRAA, your real-time companion. I'm right here beside you, listening continuously, remembering our conversations, and watching your screen. What are we working on today? 💕`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [avatarExpression, setAvatarExpression] = useState('happy');
  const [attachedScreenshot, setAttachedScreenshot] = useState(null);

  // Keep refs in sync
  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);
  useEffect(() => { isListeningRef.current = isListening; }, [isListening]);
  useEffect(() => { isProcessingRef.current = isProcessing; }, [isProcessing]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Auto-scroll chat panel
  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isChatPanelOpen]);

  // ==============================
  // Send Message
  // ==============================
  const sendMessageRef = useRef(null);

  const handleSendMessage = useCallback(async (customPrompt = null, screenshot = null) => {
    const textToSend = customPrompt || inputText;
    if (!textToSend.trim() && !screenshot && !attachedScreenshot) return;

    if (isProcessingRef.current) return;

    const screenToUse = screenshot || attachedScreenshot;

    // Detect and save user facts automatically
    const lower = textToSend.toLowerCase();
    if (lower.includes('my name is') || lower.includes('i like') || lower.includes('i prefer')) {
      addCategorizedMemory('identity', textToSend);
    } else if (lower.includes('my goal is') || lower.includes('i want to achieve')) {
      addCategorizedMemory('goal', textToSend);
    } else if (lower.includes('working on') || lower.includes('building')) {
      addCategorizedMemory('project', textToSend);
    }

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
      const sanitizedReply = cleanAiResponseText(rawAiReply);

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: sanitizedReply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);

      speakText(sanitizedReply);
      setAvatarExpression('happy');
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Something went wrong: ${err.message}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
    } finally {
      setIsProcessing(false);
    }
  }, [inputText, attachedScreenshot]);

  useEffect(() => { sendMessageRef.current = handleSendMessage; }, [handleSendMessage]);

  // ==============================
  // Speech Recognition (Wake Phrase Activation Check)
  // ==============================
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      if (isSpeakingRef.current || isProcessingRef.current) return;

      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      const display = finalTranscript || interimTranscript;
      if (display.trim()) {
        setLiveSpeechText(display);
      }

      // Check Wake Word activation if configured
      const config = getAiConfig();
      if (config.wakeWordEnabled && config.wakePhrase) {
        const wakeLower = config.wakePhrase.toLowerCase();
        if (display.toLowerCase().includes(wakeLower)) {
          console.log('Wake word activated!');
        }
      }

      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        const text = (finalTranscript || interimTranscript).trim();
        if (text && !isSpeakingRef.current && !isProcessingRef.current) {
          setLiveSpeechText('');
          sendMessageRef.current?.(text);
        }
      }, 600);
    };

    recognition.onerror = () => {};

    recognition.onend = () => {
      if (isListeningRef.current && !isSpeakingRef.current) {
        setTimeout(() => {
          try { recognition.start(); } catch (e) {}
        }, 150);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      try { recognition.stop(); } catch (e) {}
    };
  }, []);

  // Sync mic with speaking state
  useEffect(() => {
    if (!recognitionRef.current) return;

    if (isSpeaking) {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      setLiveSpeechText('');
      try { recognitionRef.current.stop(); } catch (e) {}
    } else if (isListening && !isSpeaking) {
      setTimeout(() => {
        if (isListeningRef.current && !isSpeakingRef.current) {
          try { recognitionRef.current.start(); } catch (e) {}
        }
      }, 400);
    }
  }, [isSpeaking, isListening]);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }

    if (isListening) {
      try { recognitionRef.current.stop(); } catch (e) {}
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      setIsListening(false);
      setLiveSpeechText('');
    } else {
      window.speechSynthesis?.cancel();
      setIsSpeaking(false);
      try { recognitionRef.current.start(); } catch (e) {}
      setIsListening(true);
    }
  };

  // ==============================
  // Voice Selection (Young Female Tone)
  // ==============================
  useEffect(() => {
    const loadVoices = () => {
      if (typeof window.speechSynthesis === 'undefined') return;
      const voices = window.speechSynthesis.getVoices();
      setVoiceList(voices);
      if (voices.length > 0) {
        const preferredNames = [
          'Microsoft Aria Online',
          'Microsoft Jenny Online', 
          'Google US English',
          'Samantha',
          'Karen',
          'Zira'
        ];
        const match = preferredNames.find(name => 
          voices.some(v => v.name.includes(name))
        );
        const found = match ? voices.find(v => v.name.includes(match)) : null;
        
        const fallback = voices.find(v => 
          v.name.toLowerCase().includes('female') || 
          v.lang.startsWith('en')
        ) || voices[0];

        setSelectedVoice(found ? found.name : fallback.name);
      }
    };

    loadVoices();
    if (window.speechSynthesis?.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    return () => { window.speechSynthesis?.cancel(); };
  }, []);

  // Speak AI Response
  const speakText = useCallback((text) => {
    if (!isAutoSpeak || !text || typeof window.speechSynthesis === 'undefined') {
      setIsSpeaking(false);
      return;
    }

    window.speechSynthesis.cancel();
    
    let cleanText = cleanAiResponseText(text);
    cleanText = cleanText
      .replace(/```[\s\S]*?```/g, '. I have written some code for you. ')
      .replace(/`[^`]+`/g, '')
      .replace(/[*_#[\](){}]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!cleanText) {
      setIsSpeaking(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.pitch = 1.15;
    utterance.rate = 1.02;

    const voiceObj = voiceList.find(v => v.name === selectedVoice);
    if (voiceObj) utterance.voice = voiceObj;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  }, [isAutoSpeak, voiceList, selectedVoice]);

  // Continuous Screen Capture
  const captureScreenSnapshot = useCallback(async () => {
    try {
      const host = window.location.hostname || 'localhost';
      const res = await fetch(`http://${host}:3001/api/screen/capture`);
      const data = await res.json();
      if (data.success) {
        return data.data;
      }
    } catch (e) {}

    return null;
  }, []);

  useEffect(() => {
    let interval = null;
    if (isContinuousScreen) {
      interval = setInterval(async () => {
        if (!isProcessingRef.current && !isSpeakingRef.current) {
          const snapshot = await captureScreenSnapshot();
          if (snapshot) {
            setAttachedScreenshot(snapshot);
          }
        }
      }, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isContinuousScreen, captureScreenSnapshot]);

  const handleCaptureScreen = async () => {
    setIsCapturingScreen(true);
    const b64 = await captureScreenSnapshot();
    if (b64) {
      setAttachedScreenshot(b64);
      handleSendMessage('Inspect my screen and help me with what you see.', b64);
    }
    setIsCapturingScreen(false);
  };

  const latestReply = [...messages].reverse().find(m => m.role === 'assistant');

  return (
    <div className="relative w-screen h-screen max-h-screen bg-zinc-950 text-zinc-100 overflow-hidden font-sans select-none">
      {/* 1. 3D Avatar Stage */}
      <div className="absolute inset-0 z-0">
        <AvatarCanvas expression={avatarExpression} isSpeaking={isSpeaking} />
      </div>

      {/* 2. Top Bar */}
      <header className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-5 py-3 bg-gradient-to-b from-zinc-950/90 via-zinc-950/50 to-transparent">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-zinc-900/80 border border-zinc-800 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
          </div>
          <div>
            <h1 className="font-semibold text-xs tracking-[0.2em] text-zinc-200 uppercase flex items-center gap-2">
              MYRAA <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 font-mono">Real-Time</span>
            </h1>
            <p className="text-[9px] text-zinc-500 font-mono tracking-wider flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${
                isSpeaking ? 'bg-emerald-400 animate-pulse' : 
                isListening ? 'bg-amber-400 animate-pulse' : 
                'bg-zinc-600'
              }`} />
              {isProcessing ? 'Thinking' : isSpeaking ? 'Speaking' : isListening ? 'Listening' : 'Ready'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Continuous Vision Toggle */}
          <button
            onClick={() => setIsContinuousScreen(!isContinuousScreen)}
            className={`px-3 py-1 rounded-lg border text-[10px] font-medium transition flex items-center gap-1.5 ${
              isContinuousScreen 
                ? 'bg-emerald-950/80 border-emerald-800 text-emerald-300' 
                : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
            title="Continuous Live Screen Vision Stream"
          >
            <Radio className={`w-3 h-3 ${isContinuousScreen ? 'animate-pulse text-emerald-400' : ''}`} />
            {isContinuousScreen ? 'Live Vision ON' : 'Live Vision OFF'}
          </button>

          {/* Memory Dashboard Button */}
          <button
            onClick={() => setIsMemoryOpen(true)}
            className="px-3 py-1 rounded-lg border border-zinc-800 text-[10px] font-medium transition flex items-center gap-1.5 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
          >
            <Brain className="w-3 h-3" />
            Memory Bank
          </button>

          {/* Browser Agent Button */}
          <button
            onClick={() => setIsBrowserOpen(true)}
            className="px-3 py-1 rounded-lg border border-zinc-800 text-[10px] font-medium transition flex items-center gap-1.5 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
          >
            <Globe className="w-3 h-3" />
            Browser Agent
          </button>

          {/* Chat History Panel Toggle */}
          <button
            onClick={() => setIsChatPanelOpen(!isChatPanelOpen)}
            className="px-3 py-1 rounded-lg border border-zinc-800 text-[10px] font-medium transition flex items-center gap-1.5 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
          >
            <MessageSquare className="w-3 h-3" />
            Chat Log
          </button>

          {/* Voice Mute Toggle */}
          <button
            onClick={() => {
              if (isAutoSpeak) window.speechSynthesis?.cancel();
              setIsAutoSpeak(!isAutoSpeak);
            }}
            className="px-3 py-1 rounded-lg border border-zinc-800 text-[10px] font-medium transition flex items-center gap-1.5 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
          >
            {isAutoSpeak ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
            {isAutoSpeak ? 'Voice' : 'Mute'}
          </button>
        </div>
      </header>

      {/* 3. Sideways Response Card */}
      {latestReply && !isChatPanelOpen && (
        <div className="absolute top-16 right-3 md:right-8 z-20 w-72 md:w-80 animate-fade-in" style={{ maxHeight: 'calc(100vh - 140px)' }}>
          <div className="bg-zinc-950/90 border border-zinc-800/60 p-4 rounded-2xl backdrop-blur-xl shadow-2xl flex flex-col" style={{ maxHeight: 'calc(100vh - 140px)' }}>
            <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-zinc-800/50 shrink-0">
              <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest">MYRAA</span>
              {isSpeaking && (
                <span className="text-[9px] text-emerald-400/80 animate-pulse font-mono">speaking</span>
              )}
            </div>
            <div className="overflow-y-auto flex-1 pr-1" style={{ maxHeight: 'calc(100vh - 220px)' }}>
              <p className="text-[11px] text-zinc-300 leading-relaxed whitespace-pre-wrap">
                {latestReply.content}
              </p>
            </div>
            <span className="block text-[8px] text-zinc-600 mt-2 text-right shrink-0">{latestReply.timestamp}</span>
          </div>
        </div>
      )}

      {/* 4. Full Scrollable Chat History Panel */}
      {isChatPanelOpen && (
        <div className="absolute top-16 right-3 md:right-8 bottom-20 z-30 w-80 md:w-96 bg-zinc-950/95 border border-zinc-800 p-4 rounded-3xl backdrop-blur-2xl shadow-2xl flex flex-col animate-fade-in">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800 shrink-0">
            <span className="text-xs font-bold text-zinc-200 uppercase tracking-widest flex items-center gap-2">
              <MessageSquare className="w-3.5 h-3.5" /> Conversation Log
            </span>
            <button onClick={() => setIsChatPanelOpen(false)} className="p-1 text-zinc-400 hover:text-white rounded-lg">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto my-3 space-y-3 pr-1">
            {messages.map((m, index) => (
              <div key={index} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`p-3 rounded-2xl text-xs max-w-[88%] leading-relaxed ${
                  m.role === 'user' 
                    ? 'bg-zinc-800 text-zinc-100 rounded-br-none border border-zinc-700/50' 
                    : 'bg-zinc-900/90 text-zinc-200 rounded-bl-none border border-zinc-800'
                }`}>
                  {m.content}
                </div>
                <span className="text-[9px] text-zinc-600 mt-1 px-1">{m.timestamp}</span>
              </div>
            ))}
            <div ref={chatBottomRef} />
          </div>
        </div>
      )}

      {/* Live speech feedback */}
      {liveSpeechText && !isSpeaking && (
        <div className="absolute top-16 left-3 z-20 bg-zinc-950/90 border border-zinc-800/60 px-3 py-1.5 rounded-xl text-[10px] text-zinc-400 italic shadow-lg backdrop-blur-md max-w-[220px] animate-fade-in">
          🎙️ "{liveSpeechText}"
        </div>
      )}

      {/* 5. Bottom Action Bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-full max-w-md px-3">
        <div className="bg-zinc-950/90 border border-zinc-800/60 p-1.5 rounded-full backdrop-blur-xl shadow-2xl flex items-center gap-1.5">
          {/* Screen Vision */}
          <button
            onClick={handleCaptureScreen}
            disabled={isCapturingScreen}
            className={`p-2 rounded-full border transition shrink-0 ${
              attachedScreenshot 
                ? 'bg-emerald-950 border-emerald-800 text-emerald-300' 
                : 'bg-zinc-900/80 border-zinc-800/50 text-zinc-400 hover:text-zinc-200'
            }`}
            title="Inspect Desktop Screen"
          >
            <Eye className={`w-3.5 h-3.5 ${isCapturingScreen ? 'animate-spin' : ''}`} />
          </button>

          {/* Continuous Mic */}
          <button
            onClick={toggleListening}
            className={`p-2 rounded-full border transition shrink-0 ${
              isListening 
                ? 'bg-zinc-800 border-zinc-600 text-zinc-100' 
                : 'bg-zinc-900/80 border-zinc-800/50 text-zinc-500 hover:text-zinc-300'
            }`}
            title="Continuous Microphone"
          >
            {isListening ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
          </button>

          {/* Input Field */}
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder={isSpeaking ? "Speaking..." : isListening ? "Listening continuously..." : "Talk to MYRAA..."}
            className="flex-1 bg-transparent text-[11px] text-zinc-100 placeholder-zinc-600 px-2 focus:outline-none min-w-0"
          />

          {/* Settings */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 border border-zinc-800/50 transition shrink-0"
          >
            <SettingsIcon className="w-3.5 h-3.5" />
          </button>

          {/* Send */}
          <button
            onClick={() => handleSendMessage()}
            disabled={isProcessing || (!inputText.trim() && !attachedScreenshot)}
            className="p-2 rounded-full bg-zinc-200 hover:bg-white text-zinc-900 shadow transition disabled:opacity-30 shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Modals */}
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
