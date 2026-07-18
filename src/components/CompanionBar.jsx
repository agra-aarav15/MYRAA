import React, { useState, useEffect } from 'react';
import { Heart, Smile, Brain, Play, Pause, RotateCcw, Music, Layers } from 'lucide-react';

export default function CompanionBar({ onToggleGhostMode }) {
  const [affection] = useState(100);
  const [happiness] = useState(98);
  const [focus] = useState(92);

  const [timeLeft, setTimeLeft] = useState(25 * 60);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [isPlayingLofi, setIsPlayingLofi] = useState(false);
  const [audioCtx, setAudioCtx] = useState(null);

  useEffect(() => {
    let interval = null;
    if (isTimerRunning && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft(prev => prev - 1);
      }, 1000);
    } else if (timeLeft === 0) {
      setIsTimerRunning(false);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning, timeLeft]);

  const toggleTimer = () => setIsTimerRunning(!isTimerRunning);
  const resetTimer = () => {
    setIsTimerRunning(false);
    setTimeLeft(25 * 60);
  };

  const formatTime = (secs) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const toggleLofiAudio = () => {
    if (isPlayingLofi) {
      if (audioCtx) audioCtx.close();
      setAudioCtx(null);
      setIsPlayingLofi(false);
    } else {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(220, ctx.currentTime);
        gain.gain.setValueAtTime(0.03, ctx.currentTime);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();

        setAudioCtx(ctx);
        setIsPlayingLofi(true);
      } catch (e) {
        console.warn('Audio Context Error:', e);
      }
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 bg-black border border-zinc-800 px-6 py-3 rounded-2xl shadow-xl">
      {/* Mood Meters */}
      <div className="flex items-center gap-6 text-xs font-semibold">
        <div className="flex items-center gap-2">
          <Heart className="w-4 h-4 text-pink-500 fill-pink-500/20" />
          <span className="text-zinc-400">Affection:</span>
          <span className="text-pink-400 font-mono font-bold">{affection}%</span>
        </div>

        <div className="flex items-center gap-2">
          <Smile className="w-4 h-4 text-zinc-300" />
          <span className="text-zinc-400">Happiness:</span>
          <span className="text-white font-mono font-bold">{happiness}%</span>
        </div>

        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-zinc-300" />
          <span className="text-zinc-400">Focus:</span>
          <span className="text-white font-mono font-bold">{focus}%</span>
        </div>
      </div>

      {/* Pomodoro & Lo-Fi Beats */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 px-3 py-1.5 rounded-xl text-xs">
          <span className="text-zinc-400 font-medium">Pomodoro:</span>
          <span className="font-mono text-pink-400 font-bold">{formatTime(timeLeft)}</span>
          <button onClick={toggleTimer} className="p-1 hover:text-white transition">
            {isTimerRunning ? <Pause className="w-3.5 h-3.5 text-pink-400" /> : <Play className="w-3.5 h-3.5 fill-current text-white" />}
          </button>
          <button onClick={resetTimer} className="p-1 text-zinc-500 hover:text-zinc-300 transition">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          onClick={toggleLofiAudio}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
            isPlayingLofi 
              ? 'bg-pink-600/20 border-pink-500 text-pink-400 animate-pulse' 
              : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Music className="w-3.5 h-3.5" />
          <span>{isPlayingLofi ? 'Lo-Fi Ambient ON' : 'Coding Music'}</span>
        </button>

        <button
          onClick={onToggleGhostMode}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-zinc-950 border border-zinc-800 text-zinc-200 hover:border-pink-500/40 hover:text-pink-400 transition"
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Ghost View</span>
        </button>
      </div>
    </div>
  );
}
