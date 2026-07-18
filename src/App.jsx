import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Sparkles, Eye, Settings as SettingsIcon, Send,
  Mic, MicOff, Volume2, VolumeX
} from 'lucide-react';

import AvatarCanvas from './components/AvatarCanvas';
import SettingsModal from './components/SettingsModal';
import { sendAiChatMessage, cleanAiResponseText } from './services/aiProvider';

export default function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCapturingScreen, setIsCapturingScreen] = useState(false);

  // Voice State
  const [isListening, setIsListening] = useState(false);
  const [isAutoSpeak, setIsAutoSpeak] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceList, setVoiceList] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [liveSpeechText, setLiveSpeechText] = useState('');

  // Refs to avoid stale closures in callbacks
  const isSpeakingRef = useRef(false);
  const isListeningRef = useRef(false);
  const isProcessingRef = useRef(false);
  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const messagesRef = useRef([]);

  // Chat State
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `Hey there. I'm MYRAA, your AI companion. I'm right here listening. Talk to me or type below.`,
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

  // ==============================
  // Send Message (defined early so mic callback can use it via ref)
  // ==============================
  const sendMessageRef = useRef(null);

  const handleSendMessage = useCallback(async (customPrompt = null, screenshot = null) => {
    const textToSend = customPrompt || inputText;
    if (!textToSend.trim() && !screenshot && !attachedScreenshot) return;

    // Prevent sending while already processing
    if (isProcessingRef.current) return;

    const screenToUse = screenshot || attachedScreenshot;

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
  // Speech Recognition — set up ONCE, use refs for everything
  // ==============================
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      // CRITICAL: If MYRAA is currently speaking or processing, ignore ALL input
      if (isSpeakingRef.current || isProcessingRef.current) {
        return;
      }

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

      // Auto-send after silence
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        const text = (finalTranscript || interimTranscript).trim();
        if (text && !isSpeakingRef.current && !isProcessingRef.current) {
          setLiveSpeechText('');
          sendMessageRef.current?.(text);
        }
      }, 1500);
    };

    recognition.onerror = () => {};

    recognition.onend = () => {
      // Auto-restart if we should still be listening and not speaking
      if (isListeningRef.current && !isSpeakingRef.current) {
        setTimeout(() => {
          try { recognition.start(); } catch (e) {}
        }, 200);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      try { recognition.stop(); } catch (e) {}
    };
  }, []); // Run ONCE

  // ==============================
  // Mic ↔ Speech sync: pause mic while MYRAA speaks, resume after
  // ==============================
  useEffect(() => {
    if (!recognitionRef.current) return;

    if (isSpeaking) {
      // MYRAA started speaking → stop mic immediately
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      setLiveSpeechText('');
      try { recognitionRef.current.stop(); } catch (e) {}
    } else if (isListening && !isSpeaking) {
      // MYRAA stopped speaking → resume mic after a short gap
      setTimeout(() => {
        if (isListeningRef.current && !isSpeakingRef.current) {
          try { recognitionRef.current.start(); } catch (e) {}
        }
      }, 600);
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
  // Voice Selection — prefer natural female voices
  // ==============================
  useEffect(() => {
    const loadVoices = () => {
      if (typeof window.speechSynthesis === 'undefined') return;
      const voices = window.speechSynthesis.getVoices();
      setVoiceList(voices);
      if (voices.length > 0) {
        // Priority order for natural-sounding female voices
        const preferredNames = [
          'Microsoft Jenny Online',
          'Microsoft Aria Online', 
          'Google US English',
          'Samantha',
          'Karen',
          'Zira',
        ];
        const match = preferredNames.find(name => 
          voices.some(v => v.name.includes(name))
        );
        const found = match ? voices.find(v => v.name.includes(match)) : null;
        
        // Fallback: pick first female-sounding voice
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

  // ==============================
  // Text-to-Speech
  // ==============================
  const speakText = useCallback((text) => {
    if (!isAutoSpeak || !text || typeof window.speechSynthesis === 'undefined') {
      setIsSpeaking(false);
      return;
    }

    window.speechSynthesis.cancel();
    
    // Clean for speech: remove code blocks, markdown symbols, think tags
    let cleanText = cleanAiResponseText(text);
    cleanText = cleanText
      .replace(/```[\s\S]*?```/g, '. I have written some code for you. ')
      .replace(/`[^`]+`/g, '')        // inline code
      .replace(/[*_#[\](){}]/g, '')   // markdown chars
      .replace(/\s{2,}/g, ' ')        // collapse whitespace
      .trim();

    if (!cleanText) {
      setIsSpeaking(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.pitch = 1.05;
    utterance.rate = 0.95;

    const voiceObj = voiceList.find(v => v.name === selectedVoice);
    if (voiceObj) utterance.voice = voiceObj;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  }, [isAutoSpeak, voiceList, selectedVoice]);

  // ==============================
  // Screen Capture
  // ==============================
  const handleCaptureScreen = async () => {
    setIsCapturingScreen(true);
    try {
      const host = window.location.hostname || 'localhost';
      const res = await fetch(`http://${host}:3001/api/screen/capture`);
      const data = await res.json();
      if (data.success) {
        setAttachedScreenshot(data.data);
        handleSendMessage('Inspect my screen and help me.', data.data);
        setIsCapturingScreen(false);
        return;
      }
    } catch (e) {}

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' } });
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const b64 = canvas.toDataURL('image/jpeg');
      stream.getTracks().forEach(t => t.stop());
      setAttachedScreenshot(b64);
      handleSendMessage('Inspect my screen share and help me.', b64);
    } catch (e) {}
    setIsCapturingScreen(false);
  };

  const latestReply = [...messages].reverse().find(m => m.role === 'assistant');

  return (
    <div className="relative w-screen h-screen max-h-screen bg-zinc-950 text-zinc-100 overflow-hidden font-sans select-none">
      {/* 3D Avatar — full background */}
      <div className="absolute inset-0 z-0">
        <AvatarCanvas expression={avatarExpression} isSpeaking={isSpeaking} />
      </div>

      {/* Top bar */}
      <header className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-5 py-3 bg-gradient-to-b from-zinc-950/90 via-zinc-950/50 to-transparent">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-zinc-900/80 border border-zinc-800 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
          </div>
          <div>
            <h1 className="font-semibold text-xs tracking-[0.2em] text-zinc-200 uppercase">MYRAA</h1>
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
      </header>

      {/* Response card — right side */}
      {latestReply && (
        <div className="absolute top-16 right-3 md:right-8 z-20 w-72 md:w-80 animate-fade-in">
          <div className="bg-zinc-950/90 border border-zinc-800/60 p-4 rounded-2xl backdrop-blur-xl shadow-2xl">
            <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-zinc-800/50">
              <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest">MYRAA</span>
              {isSpeaking && (
                <span className="text-[9px] text-emerald-400/80 animate-pulse font-mono">speaking</span>
              )}
            </div>
            <p className="text-[11px] text-zinc-300 leading-relaxed whitespace-pre-wrap">
              {latestReply.content}
            </p>
            <span className="block text-[8px] text-zinc-600 mt-2 text-right">{latestReply.timestamp}</span>
          </div>
        </div>
      )}

      {/* Live speech indicator */}
      {liveSpeechText && !isSpeaking && (
        <div className="absolute top-16 left-3 z-20 bg-zinc-950/90 border border-zinc-800/60 px-3 py-1.5 rounded-xl text-[10px] text-zinc-400 italic shadow-lg backdrop-blur-md max-w-[200px] animate-fade-in">
          "{liveSpeechText}"
        </div>
      )}

      {/* Bottom action bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-full max-w-md px-3">
        <div className="bg-zinc-950/90 border border-zinc-800/60 p-1.5 rounded-full backdrop-blur-xl shadow-2xl flex items-center gap-1.5">
          {/* Screen */}
          <button
            onClick={handleCaptureScreen}
            disabled={isCapturingScreen}
            className="p-2 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800/50 transition shrink-0"
            title="Screen Vision"
          >
            <Eye className={`w-3.5 h-3.5 ${isCapturingScreen ? 'animate-spin' : ''}`} />
          </button>

          {/* Mic */}
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

          {/* Input */}
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder={isSpeaking ? "Speaking..." : isListening ? "Listening..." : "Type here..."}
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

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}
