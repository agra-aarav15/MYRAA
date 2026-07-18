import React, { useEffect, useState, useRef } from 'react';
import { Mic, MicOff, Volume2, VolumeX } from 'lucide-react';

export default function VoiceAssistant({ onSpeechInput, onSpeakingStateChange, lastAiResponse }) {
  const [isListening, setIsListening] = useState(false);
  const [isAutoSpeak, setIsAutoSpeak] = useState(true);
  const [voiceList, setVoiceList] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [transcript, setTranscript] = useState('');

  const recognitionRef = useRef(null);

  // Initialize Speech Recognition (STT)
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false; // Stop when sentence is finished for cleaner voice interaction
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        let currentTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          currentTranscript += event.results[i][0].transcript;
        }
        setTranscript(currentTranscript);

        if (event.results[event.results.length - 1].isFinal) {
          const finalSpeech = currentTranscript.trim();
          if (finalSpeech) {
            onSpeechInput(finalSpeech);
            setTranscript('');
            setIsListening(false);
          }
        }
      };

      recognition.onerror = (err) => {
        console.warn('Speech recognition notice:', err);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, [onSpeechInput]);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert('Speech recognition is not supported in this browser environment. You can type in chat!');
      return;
    }

    if (isListening) {
      try { recognitionRef.current.stop(); } catch(e) {}
      setIsListening(false);
    } else {
      try {
        window.speechSynthesis?.cancel(); // Cancel any ongoing speech when user starts talking
        onSpeakingStateChange?.(false);
        recognitionRef.current.start();
        setIsListening(true);
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Populate Voices for Speech Synthesis (TTS)
  useEffect(() => {
    const loadVoices = () => {
      if (typeof window.speechSynthesis === 'undefined') return;
      const voices = window.speechSynthesis.getVoices();
      setVoiceList(voices);
      if (voices.length > 0) {
        const preferred = voices.find(v => v.name.includes('Zira') || v.name.includes('Samantha') || v.name.includes('Google US English'));
        setSelectedVoice(preferred ? preferred.name : voices[0].name);
      }
    };

    loadVoices();
    if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Speak AI Response with Strict Cleanup
  const speakText = (text) => {
    if (!isAutoSpeak || !text || typeof window.speechSynthesis === 'undefined') {
      onSpeakingStateChange?.(false);
      return;
    }

    window.speechSynthesis.cancel(); // Always reset ongoing speech first

    const cleanText = text.replace(/```[\s\S]*?```/g, 'I have generated code for you.')
                          .replace(/[*_#`[\]()]/g, '')
                          .trim();

    if (!cleanText) {
      onSpeakingStateChange?.(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.pitch = 1.25;
    utterance.rate = 1.05;

    const voiceObj = voiceList.find(v => v.name === selectedVoice);
    if (voiceObj) utterance.voice = voiceObj;

    utterance.onstart = () => onSpeakingStateChange?.(true);
    utterance.onend = () => onSpeakingStateChange?.(false);
    utterance.onerror = () => onSpeakingStateChange?.(false);

    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    if (lastAiResponse) {
      speakText(lastAiResponse);
    }
  }, [lastAiResponse]);

  return (
    <div className="flex items-center gap-2">
      {/* Speech Recognition Toggle */}
      <button
        onClick={toggleListening}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-xs transition border ${
          isListening 
            ? 'bg-pink-600 border-pink-500 text-white animate-pulse shadow-lg shadow-pink-600/30' 
            : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700'
        }`}
      >
        {isListening ? <Mic className="w-3.5 h-3.5 text-white" /> : <MicOff className="w-3.5 h-3.5 text-zinc-400" />}
        <span>{isListening ? 'Listening...' : 'Voice'}</span>
      </button>

      {/* Speech Synthesis Toggle */}
      <button
        onClick={() => {
          if (isAutoSpeak) {
            window.speechSynthesis?.cancel();
            onSpeakingStateChange?.(false);
          }
          setIsAutoSpeak(!isAutoSpeak);
        }}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-xs transition border ${
          isAutoSpeak 
            ? 'bg-zinc-900 border-pink-500/50 text-pink-400' 
            : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300'
        }`}
      >
        {isAutoSpeak ? <Volume2 className="w-3.5 h-3.5 text-pink-400" /> : <VolumeX className="w-3.5 h-3.5" />}
        <span>Mute Voice</span>
      </button>

      {/* Live Transcript Preview */}
      {transcript && (
        <span className="text-xs text-pink-400 italic truncate max-w-[160px]">
          "{transcript}"
        </span>
      )}
    </div>
  );
}
