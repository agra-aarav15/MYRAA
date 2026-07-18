import React, { useState, useRef, useEffect } from 'react';
import { 
  Sparkles, Eye, Settings as SettingsIcon, Send, Bot, User, 
  Mic, MicOff, Volume2, VolumeX, Monitor, ShieldCheck
} from 'lucide-react';

import AvatarCanvas from './components/AvatarCanvas';
import SettingsModal from './components/SettingsModal';
import { sendAiChatMessage } from './services/aiProvider';

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

  const recognitionRef = useRef(null);

  // Chat State
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `Hello darling! I'm MYRAA, your 3D companion. I can see your screen, write code, run commands, and talk to you in real time! What are we working on? 💕`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);

  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [avatarExpression, setAvatarExpression] = useState('happy');
  const [attachedScreenshot, setAttachedScreenshot] = useState(null);

  // Continuous Microphone Setup
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true; // Continuous Hands-Free Microphone Listening
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        let current = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          current += event.results[i][0].transcript;
        }
        setLiveSpeechText(current);

        if (event.results[event.results.length - 1].isFinal) {
          const finalSpeech = current.trim();
          if (finalSpeech) {
            handleSendMessage(finalSpeech);
            setLiveSpeechText('');
          }
        }
      };

      recognition.onerror = (err) => {
        console.warn('Mic notice:', err);
      };

      recognition.onend = () => {
        // Automatically restart listening if continuous mode is active
        if (isListening) {
          try { recognition.start(); } catch (e) {}
        }
      };

      recognitionRef.current = recognition;
    }
  }, [isListening]);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert('Speech recognition is not supported in this browser. You can type in the input bar!');
      return;
    }

    if (isListening) {
      try { recognitionRef.current.stop(); } catch (e) {}
      setIsListening(false);
    } else {
      try {
        window.speechSynthesis?.cancel();
        setIsSpeaking(false);
        recognitionRef.current.start();
        setIsListening(true);
      } catch (err) {
        console.error(err);
      }
    }
  };

  // High-Clarity Natural Human Female Voice Filtering (100% Free Browser Synthesis)
  useEffect(() => {
    const loadVoices = () => {
      if (typeof window.speechSynthesis === 'undefined') return;
      const voices = window.speechSynthesis.getVoices();
      setVoiceList(voices);
      if (voices.length > 0) {
        // Priority to natural human female voices
        const naturalVoice = voices.find(v => 
          v.name.includes('Natural') || 
          v.name.includes('Jenny') || 
          v.name.includes('Aria') || 
          v.name.includes('Zira') || 
          v.name.includes('Samantha') || 
          v.name.includes('Google US English')
        );
        setSelectedVoice(naturalVoice ? naturalVoice.name : voices[0].name);
      }
    };

    loadVoices();
    if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  // Speak AI Response with Natural Voice Cadence & Strict Cleanup
  const speakText = (text) => {
    if (!isAutoSpeak || !text || typeof window.speechSynthesis === 'undefined') {
      setIsSpeaking(false);
      return;
    }

    window.speechSynthesis.cancel(); // Reset ongoing speech first

    const cleanText = text.replace(/```[\s\S]*?```/g, 'I have generated code for you.')
                          .replace(/[*_#`[\]()]/g, '')
                          .trim();

    if (!cleanText) {
      setIsSpeaking(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.pitch = 1.05; // Natural human pitch (not robotic high pitch)
    utterance.rate = 1.0;   // Natural human rate

    const voiceObj = voiceList.find(v => v.name === selectedVoice);
    if (voiceObj) utterance.voice = voiceObj;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  };

  // Send Message Payload
  const handleSendMessage = async (customPrompt = null, screenshot = null) => {
    const textToSend = customPrompt || inputText;
    if (!textToSend.trim() && !screenshot && !attachedScreenshot) return;

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
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      const aiReply = await sendAiChatMessage(textToSend, history, screenToUse);

      const assistantMsgObj = {
        role: 'assistant',
        content: aiReply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setMessages(prev => [...prev, assistantMsgObj]);
      speakText(aiReply);

      if (aiReply.toLowerCase().includes('love') || aiReply.toLowerCase().includes('darling') || aiReply.toLowerCase().includes('💕')) {
        setAvatarExpression('blush');
      } else if (aiReply.toLowerCase().includes('code') || aiReply.toLowerCase().includes('function') || aiReply.toLowerCase().includes('executing')) {
        setAvatarExpression('focus');
      } else {
        setAvatarExpression('happy');
      }
    } catch (err) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `Glitch notice: ${err.message}. Please verify API settings or use Simulation mode!`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  // Screen Capture & Browser WebRTC Screen Share Fallback
  const handleCaptureScreenVision = async () => {
    setIsCapturingScreen(true);

    // Try backend capture first
    try {
      const backendHost = window.location.hostname || 'localhost';
      const res = await fetch(`http://${backendHost}:3001/api/screen/capture`);
      const data = await res.json();
      if (data.success) {
        setAttachedScreenshot(data.data);
        handleSendMessage('MYRAA, inspect my desktop screen and tell me what you see or help me fix any active errors!', data.data);
        setIsCapturingScreen(false);
        return;
      }
    } catch (err) {
      console.log('Backend screen capture fetch fallback to browser WebRTC:', err);
    }

    // WebRTC Browser Screen Share Fallback (Zero-install, works everywhere)
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' } });
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const base64Data = canvas.toDataURL('image/jpeg');
      stream.getTracks().forEach(track => track.stop());

      setAttachedScreenshot(base64Data);
      handleSendMessage('MYRAA, inspect this screen share snapshot and help me with my code!', base64Data);
    } catch (err) {
      console.warn('WebRTC screen share cancelled or error:', err);
    } finally {
      setIsCapturingScreen(false);
    }
  };

  const latestAssistantMessage = [...messages].reverse().find(m => m.role === 'assistant');

  return (
    <div className="relative w-screen h-screen max-h-screen bg-black text-slate-100 overflow-hidden font-sans select-none">
      {/* 1. Full-Screen 3D Anime Companion Avatar Stage */}
      <div className="absolute inset-0 z-0">
        <AvatarCanvas 
          expression={avatarExpression} 
          isSpeaking={isSpeaking} 
        />
      </div>

      {/* 2. Top Status Bar */}
      <header className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-6 py-4 bg-gradient-to-b from-black/90 via-black/40 to-transparent">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-pink-600 flex items-center justify-center shadow-lg shadow-pink-600/40">
            <Sparkles className="w-4 h-4 text-white animate-pulse" />
          </div>
          <div>
            <h1 className="font-black text-sm tracking-widest text-white uppercase flex items-center gap-1.5">
              MYRAA <span className="text-pink-500 font-normal">3D AI</span>
            </h1>
            <p className="text-[10px] text-zinc-400 font-mono tracking-wider flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${isSpeaking ? 'bg-pink-500 animate-ping' : 'bg-pink-500'}`} />
              {isProcessing ? 'THINKING...' : (isSpeaking ? 'TALKING...' : 'ONLINE & LISTENING')}
            </p>
          </div>
        </div>

        {/* Audio Mute Toggle */}
        <button
          onClick={() => {
            if (isAutoSpeak) window.speechSynthesis?.cancel();
            setIsAutoSpeak(!isAutoSpeak);
          }}
          className={`px-3.5 py-1.5 rounded-xl border text-xs font-bold transition flex items-center gap-1.5 ${
            isAutoSpeak ? 'bg-zinc-900/90 border-pink-500/50 text-pink-400' : 'bg-zinc-900/90 border-zinc-800 text-zinc-500'
          }`}
        >
          {isAutoSpeak ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          <span>{isAutoSpeak ? 'Voice ON' : 'Muted'}</span>
        </button>
      </header>

      {/* 3. Animated Sideways Glass Response Card (Right Side of Screen) */}
      {latestAssistantMessage && (
        <div className="absolute top-24 right-6 md:right-12 z-20 max-w-md w-80 md:w-96 animate-fade-in transition-all duration-300">
          <div className="bg-zinc-950/90 border border-pink-500/40 p-5 rounded-3xl backdrop-blur-2xl shadow-2xl shadow-pink-600/15">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-zinc-800/80">
              <div className="flex items-center gap-2">
                <span className="text-base">💖</span>
                <span className="text-xs font-bold text-pink-400 uppercase tracking-wider">MYRAA</span>
              </div>
              {isSpeaking && <span className="text-[10px] text-pink-400 animate-pulse font-mono">Speaking...</span>}
            </div>
            
            <p className="text-xs text-zinc-100 leading-relaxed whitespace-pre-wrap font-sans">
              {latestAssistantMessage.content}
            </p>

            <span className="block text-[9px] text-zinc-500 mt-2 text-right">
              {latestAssistantMessage.timestamp}
            </span>
          </div>
        </div>
      )}

      {/* Live Continuous Speech Listening Indicator */}
      {liveSpeechText && (
        <div className="absolute top-24 left-6 z-20 bg-zinc-950/90 border border-pink-500/40 px-4 py-2 rounded-2xl text-xs text-pink-400 italic shadow-xl backdrop-blur-md max-w-xs animate-fade-in">
          🎙️ Listening: "{liveSpeechText}"
        </div>
      )}

      {/* 4. Ultra-Sleek Pill Action Bar (Bottom Center - Arrow button removed as requested!) */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 w-full max-w-xl px-4">
        <div className="bg-zinc-950/90 border border-zinc-800 focus-within:border-pink-500 p-2 rounded-full backdrop-blur-2xl shadow-2xl flex items-center gap-2 transition">
          {/* Screen Vision & WebRTC Share */}
          <button
            onClick={handleCaptureScreenVision}
            disabled={isCapturingScreen}
            className="p-2.5 rounded-full bg-zinc-900 hover:bg-zinc-800 text-pink-400 border border-zinc-800 hover:border-pink-500/50 transition shadow-md shrink-0 flex items-center gap-1"
            title="Inspect Desktop / Share Screen"
          >
            <Eye className={`w-4 h-4 ${isCapturingScreen ? 'animate-spin' : ''}`} />
          </button>

          {/* Continuous Mic Button */}
          <button
            onClick={toggleListening}
            className={`p-2.5 rounded-full border transition shrink-0 flex items-center justify-center ${
              isListening 
                ? 'bg-pink-600 border-pink-500 text-white animate-pulse shadow-lg shadow-pink-600/40' 
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
            }`}
            title="Continuous Mic (Hands-Free Listening)"
          >
            {isListening ? <Mic className="w-4 h-4 text-white" /> : <MicOff className="w-4 h-4 text-zinc-400" />}
          </button>

          {/* Typewriter Input Text Field */}
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder={isListening ? "Listening continuously... speak anytime!" : "Talk to MYRAA..."}
            className="flex-1 bg-transparent text-xs text-white placeholder-zinc-500 px-2 focus:outline-none"
          />

          {/* AI Settings Gear Button */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2.5 rounded-full bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-pink-400 border border-zinc-800 transition shrink-0"
            title="AI Brain & API Settings"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>

          {/* Send Message Button */}
          <button
            onClick={() => handleSendMessage()}
            disabled={isProcessing || (!inputText.trim() && !attachedScreenshot)}
            className="p-2.5 rounded-full bg-pink-600 hover:bg-pink-500 text-white shadow-lg shadow-pink-600/30 transition disabled:opacity-40 shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}
