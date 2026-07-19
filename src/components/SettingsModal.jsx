import React, { useState, useEffect } from 'react';
import { X, Check, ExternalLink, Cpu, Mic, Power, Brain, Volume2, Eye, Terminal, Sparkles, Activity } from 'lucide-react';
import { getAiConfig, saveAiConfig } from '../services/aiProvider';

export default function SettingsModal({ isOpen, onClose, onOpenMemory }) {
  const [config, setConfig] = useState(getAiConfig());
  const [activeTab, setActiveTab] = useState('provider');
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [mics, setMics] = useState([]);
  const [systemHealth, setSystemHealth] = useState({ online: false, cpuUsage: '0%', ramUsage: '0GB', rateLimit: null });

  useEffect(() => {
    if (isOpen) {
      setConfig(getAiConfig());

      // Fetch microphones
      if (navigator.mediaDevices?.enumerateDevices) {
        navigator.mediaDevices.enumerateDevices().then(devices => {
          setMics(devices.filter(d => d.kind === 'audioinput'));
        }).catch(() => {});
      }

      // Fetch System Health & Rate Limit stats
      const host = window.location.hostname || 'localhost';
      fetch(`http://${host}:3001/api/health`)
        .then(res => res.json())
        .then(data => setSystemHealth(data))
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    saveAiConfig(config);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 800);
  };

  const handleToggleAutoStart = (val) => {
    setConfig(prev => ({ ...prev, autoStart: val }));
    const host = window.location.hostname || 'localhost';
    fetch(`http://${host}:3001/api/settings/autostart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoStart: val })
    }).catch(() => {});
  };

  const providers = [
    { id: 'gemini', name: 'Google Gemini', desc: 'Gemini 2.0 Flash / Live Voice', icon: '✦' },
    { id: 'groq', name: 'Groq Cloud', desc: 'Ultra-fast inference', icon: '⚡' },
    { id: 'grok', name: 'xAI Grok', desc: 'High intelligence', icon: '◆' },
    { id: 'openrouter', name: 'OpenRouter (Free & Vision)', desc: 'Models with image/video inputs', icon: '◎' },
    { id: 'openai', name: 'OpenAI', desc: 'GPT-4o multimodal', icon: '○' },
    { id: 'custom', name: 'Custom Endpoint', desc: 'Ollama / LM Studio', icon: '⬡' },
    { id: 'simulation', name: 'Offline Mode', desc: 'No API needed', icon: '◇' },
  ];

  const tabs = [
    { id: 'provider', label: 'AI ENGINE', icon: '✦' },
    { id: 'voice', label: 'VOICE ENGINE', icon: '🎙️' },
    { id: 'memory', label: 'INTELLIGENCE', icon: '🧠' },
    { id: 'vision', label: 'SCREEN VISION', icon: '👁️' },
    { id: 'desktop', label: 'DESKTOP TOOLS', icon: '⚡' },
    { id: 'system', label: 'SYSTEM & OS', icon: '💻' }
  ];

  const InputField = ({ label, value, onChange, placeholder, type = 'text', mono = false }) => (
    <div>
      <label className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium">{label}</label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={`w-full mt-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500 transition ${mono ? 'font-mono' : ''}`}
      />
    </div>
  );

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-zinc-950 border border-zinc-800 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/80 bg-zinc-950">
          <h2 className="text-xs font-semibold text-zinc-200 uppercase tracking-widest flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            MYRAA Companion Configuration
          </h2>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-zinc-200 rounded-lg transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Settings Tab Selector */}
        <div className="px-6 py-3 border-b border-zinc-800/60 bg-zinc-950 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-1.5 rounded-xl text-[11px] font-medium tracking-wide flex items-center gap-1.5 transition-all whitespace-nowrap ${
                activeTab === t.id 
                  ? 'bg-zinc-100 text-zinc-950 shadow-sm font-semibold' 
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              <span>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
          
          {/* TAB 1: AI ENGINE */}
          {activeTab === 'provider' && (
            <div className="space-y-6 animate-fade-in">
              <div>
                <label className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium mb-2 block">
                  Select Intelligence Provider
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  {providers.map(p => {
                    const isSelected = config.activeProvider === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => setConfig({ ...config, activeProvider: p.id })}
                        className={`text-left p-3 rounded-2xl border transition-all flex flex-col justify-between ${
                          isSelected 
                            ? 'bg-zinc-900 border-zinc-400 shadow-lg' 
                            : 'bg-zinc-900/40 border-zinc-800/60 hover:border-zinc-700'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-bold text-zinc-200 flex items-center gap-2">
                            <span>{p.icon}</span>
                            {p.name}
                          </span>
                          {isSelected && <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
                        </div>
                        <span className="text-[11px] text-zinc-400">{p.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* User Identity */}
              <div className="pt-4 border-t border-zinc-900">
                <InputField
                  label="Your Name (How Myraa Addresses You)"
                  value={config.userName || 'Aarav'}
                  onChange={e => setConfig({ ...config, userName: e.target.value })}
                  placeholder="Aarav"
                />
              </div>

              {/* Provider Configs */}
              {config.activeProvider === 'gemini' && (
                <div className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-3 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-200">Google Gemini Configuration</span>
                    <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-[11px] text-emerald-400 hover:underline flex items-center gap-1">
                      Get Free API Key <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <InputField
                    label="Gemini API Key"
                    type="password"
                    mono
                    value={config.geminiKey || ''}
                    onChange={e => setConfig({ ...config, geminiKey: e.target.value })}
                    placeholder="AIzaSy..."
                  />
                  <div>
                    <label className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium">Model</label>
                    <select
                      value={config.geminiModel || 'gemini-2.0-flash'}
                      onChange={e => setConfig({ ...config, geminiModel: e.target.value })}
                      className="w-full mt-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none"
                    >
                      <option value="gemini-2.0-flash">gemini-2.0-flash (Recommended & Fast)</option>
                      <option value="gemini-2.5-pro">gemini-2.5-pro (High Reasoning)</option>
                    </select>
                  </div>
                </div>
              )}

              {config.activeProvider === 'groq' && (
                <div className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-3 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-200">Groq Cloud Configuration</span>
                    <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="text-[11px] text-emerald-400 hover:underline flex items-center gap-1">
                      Get Free API Key <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <InputField
                    label="Groq API Key"
                    type="password"
                    mono
                    value={config.groqKey || ''}
                    onChange={e => setConfig({ ...config, groqKey: e.target.value })}
                    placeholder="gsk_..."
                  />
                  <InputField
                    label="Model Name"
                    mono
                    value={config.groqModel || 'llama-3.3-70b-versatile'}
                    onChange={e => setConfig({ ...config, groqModel: e.target.value })}
                  />
                </div>
              )}

              {config.activeProvider === 'grok' && (
                <div className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-3 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-200">xAI Grok Configuration</span>
                    <a href="https://console.x.ai/" target="_blank" rel="noreferrer" className="text-[11px] text-emerald-400 hover:underline flex items-center gap-1">
                      xAI Console <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <InputField
                    label="xAI API Key"
                    type="password"
                    mono
                    value={config.grokKey || ''}
                    onChange={e => setConfig({ ...config, grokKey: e.target.value })}
                    placeholder="xai-..."
                  />
                  <InputField
                    label="Model Name"
                    mono
                    value={config.grokModel || 'grok-beta'}
                    onChange={e => setConfig({ ...config, grokModel: e.target.value })}
                  />
                </div>
              )}

              {config.activeProvider === 'openrouter' && (
                <div className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-3 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-200">OpenRouter Configuration (Free Image/Video Models)</span>
                    <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-[11px] text-emerald-400 hover:underline flex items-center gap-1">
                      Get Keys <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <InputField
                    label="OpenRouter API Key"
                    type="password"
                    mono
                    value={config.openrouterKey || ''}
                    onChange={e => setConfig({ ...config, openrouterKey: e.target.value })}
                    placeholder="sk-or-v1-..."
                  />
                  <InputField
                    label="Model Name (Vision & Image Input capable)"
                    mono
                    value={config.openrouterModel || 'google/gemini-2.0-flash-lite-001'}
                    onChange={e => setConfig({ ...config, openrouterModel: e.target.value })}
                  />
                  <span className="text-[10px] text-zinc-400 block">Try: google/gemini-2.0-flash-lite-001 or meta-llama/llama-3.2-90b-vision-instruct:free</span>
                </div>
              )}

              {config.activeProvider === 'openai' && (
                <div className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-3 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-200">OpenAI Configuration</span>
                    <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-[11px] text-emerald-400 hover:underline flex items-center gap-1">
                      Platform Keys <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <InputField
                    label="OpenAI API Key"
                    type="password"
                    mono
                    value={config.openaiKey || ''}
                    onChange={e => setConfig({ ...config, openaiKey: e.target.value })}
                    placeholder="sk-..."
                  />
                  <InputField
                    label="Model Name"
                    mono
                    value={config.openaiModel || 'gpt-4o'}
                    onChange={e => setConfig({ ...config, openaiModel: e.target.value })}
                  />
                </div>
              )}

              {config.activeProvider === 'custom' && (
                <div className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-3 animate-fade-in">
                  <span className="text-xs font-semibold text-zinc-200">Custom / Local LLM (Ollama / LM Studio)</span>
                  <InputField
                    label="Base URL"
                    mono
                    value={config.customUrl || 'http://localhost:11434/v1'}
                    onChange={e => setConfig({ ...config, customUrl: e.target.value })}
                  />
                  <InputField
                    label="Model Name"
                    mono
                    value={config.customModel || 'llama3'}
                    onChange={e => setConfig({ ...config, customModel: e.target.value })}
                  />
                  <InputField
                    label="API Key (Optional)"
                    type="password"
                    mono
                    value={config.customKey || ''}
                    onChange={e => setConfig({ ...config, customKey: e.target.value })}
                  />
                </div>
              )}
            </div>
          )}

          {/* TAB 2: VOICE ENGINE */}
          {activeTab === 'voice' && (
            <div className="space-y-6 animate-fade-in">
              <div className="p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800/80 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-zinc-200 block">Voice Interaction Mode</span>
                    <span className="text-[11px] text-zinc-400">Select how Myraa listens and speaks with you</span>
                  </div>
                  <div className="flex rounded-xl bg-zinc-950 p-1 border border-zinc-800">
                    <button
                      onClick={() => setConfig({ ...config, voiceMode: 'live' })}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                        (config.voiceMode || 'live') === 'live' ? 'bg-zinc-200 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Gemini Live (AI Voice)
                    </button>
                    <button
                      onClick={() => setConfig({ ...config, voiceMode: 'browser' })}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                        config.voiceMode === 'browser' ? 'bg-zinc-200 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Browser TTS (Fallback)
                    </button>
                  </div>
                </div>

                {(config.voiceMode || 'live') === 'live' && (
                  <div className="pt-3 border-t border-zinc-800/80 space-y-3">
                    <div>
                      <label className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium">Gemini AI Voice Preset</label>
                      <select
                        value={config.voicePreset || 'Aoede'}
                        onChange={e => setConfig({ ...config, voicePreset: e.target.value })}
                        className="w-full mt-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none"
                      >
                        <option value="Aoede">Aoede — Sweet, gentle, young female tone (Recommended)</option>
                        <option value="Kore">Kore — Soft, soothing, caring female tone</option>
                      </select>
                    </div>
                    <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-900/40 text-[11px] text-emerald-300 flex items-start gap-2">
                      <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span>Gemini Live uses bidirectional WebSocket audio streaming. You can interrupt Myraa naturally mid-sentence without audio loops!</span>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium mb-1 block">Microphone Input Device</label>
                <select 
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none"
                  onChange={(e) => setConfig({ ...config, micDeviceId: e.target.value })}
                  value={config.micDeviceId || ''}
                >
                  <option value="">Default System Microphone</option>
                  {mics.map((m, idx) => (
                    <option key={m.deviceId} value={m.deviceId}>{m.label || `Microphone ${idx + 1}`}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* TAB 3: INTELLIGENCE & MEMORY */}
          {activeTab === 'memory' && (
            <div className="space-y-6 animate-fade-in">
              <div className="p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800/80 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-zinc-200 block">Self-Evolving AI Memory</span>
                    <span className="text-[11px] text-zinc-400">Automatically extracts and consolidates important facts from conversations</span>
                  </div>
                  <button
                    onClick={() => setConfig({ ...config, autoMemoryExtraction: !config.autoMemoryExtraction })}
                    className={`w-11 h-6 rounded-full transition-colors relative ${config.autoMemoryExtraction !== false ? 'bg-emerald-500' : 'bg-zinc-800'}`}
                  >
                    <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${config.autoMemoryExtraction !== false ? 'right-1' : 'left-1'}`} />
                  </button>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-zinc-800/80">
                  <div>
                    <span className="text-xs font-semibold text-zinc-200 block">Proactive Companion AI</span>
                    <span className="text-[11px] text-zinc-400">Allows Myraa to initiate greetings, check on you during long silences, and care about your routine</span>
                  </div>
                  <button
                    onClick={() => setConfig({ ...config, proactiveEnabled: !config.proactiveEnabled })}
                    className={`w-11 h-6 rounded-full transition-colors relative ${config.proactiveEnabled !== false ? 'bg-emerald-500' : 'bg-zinc-800'}`}
                  >
                    <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${config.proactiveEnabled !== false ? 'right-1' : 'left-1'}`} />
                  </button>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-zinc-200 block flex items-center gap-2">
                    <Brain className="w-4 h-4 text-emerald-400" />
                    Persistent Memory Core
                  </span>
                  <span className="text-[11px] text-zinc-400">View, edit, or remove facts stored in Myraa's memory bank</span>
                </div>
                <button
                  onClick={() => { onClose(); onOpenMemory?.(); }}
                  className="px-4 py-2 bg-zinc-100 hover:bg-white text-zinc-950 font-semibold rounded-xl text-xs transition"
                >
                  Open Memory Bank
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: SCREEN VISION */}
          {activeTab === 'vision' && (
            <div className="space-y-6 animate-fade-in">
              <div className="p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800/80 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-zinc-200 block flex items-center gap-2">
                      <Eye className="w-4 h-4 text-emerald-400" />
                      Continuous Screen Vision
                    </span>
                    <span className="text-[11px] text-zinc-400">Streams live screen frames into Gemini so Myraa sees what you see in real-time</span>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium">Frame Capture Rate</label>
                  <select
                    value={config.screenVisionFps || 2}
                    onChange={e => setConfig({ ...config, screenVisionFps: Number(e.target.value) })}
                    className="w-full mt-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none"
                  >
                    <option value={1}>1 FPS — Low bandwidth (Good for reading articles/code)</option>
                    <option value={2}>2 FPS — Balanced (Recommended for coding & terminal)</option>
                    <option value={5}>5 FPS — Smooth (Higher bandwidth)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium">JPEG Quality Compression</label>
                  <select
                    value={config.screenVisionQuality || 0.6}
                    onChange={e => setConfig({ ...config, screenVisionQuality: Number(e.target.value) })}
                    className="w-full mt-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none"
                  >
                    <option value={0.4}>Low (40%) — Fast & minimal token usage</option>
                    <option value={0.6}>Medium (60%) — Clear text & balanced (Recommended)</option>
                    <option value={0.8}>High (80%) — Sharp details</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: DESKTOP TOOLS */}
          {activeTab === 'desktop' && (
            <div className="space-y-6 animate-fade-in">
              <div className="p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800/80 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-zinc-200 block flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-emerald-400" />
                      Voice-Triggered Desktop Automation
                    </span>
                    <span className="text-[11px] text-zinc-400">Allows Myraa to launch apps, search the web, and control volume</span>
                  </div>
                  <button
                    onClick={() => setConfig({ ...config, desktopControlEnabled: !config.desktopControlEnabled })}
                    className={`w-11 h-6 rounded-full transition-colors relative ${config.desktopControlEnabled !== false ? 'bg-emerald-500' : 'bg-zinc-800'}`}
                  >
                    <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${config.desktopControlEnabled !== false ? 'right-1' : 'left-1'}`} />
                  </button>
                </div>

                <div className="pt-3 border-t border-zinc-800/80 space-y-2 text-[11px] text-zinc-400">
                  <span className="font-semibold text-zinc-300 block">Available Capabilities:</span>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Launch applications: <code className="text-zinc-200">Notepad, Chrome, VS Code, Terminal, Calculator</code></li>
                    <li>Web & YouTube searches: <code className="text-zinc-200">"Search YouTube for lo-fi beats"</code></li>
                    <li>System audio control: <code className="text-zinc-200">Volume up, Volume down, Mute</code></li>
                    <li>File management: <code className="text-zinc-200">Create files, read contents, list folder items</code></li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: SYSTEM & OS */}
          {activeTab === 'system' && (
            <div className="space-y-6 animate-fade-in">
              {/* Auto Start */}
              <div className="p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800/80 flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-zinc-200 block">Windows Auto-Start</span>
                  <span className="text-[11px] text-zinc-400">Launch Myraa automatically when you log into Windows</span>
                </div>
                <button
                  onClick={() => handleToggleAutoStart(!config.autoStart)}
                  className={`w-11 h-6 rounded-full transition-colors relative ${config.autoStart ? 'bg-emerald-500' : 'bg-zinc-800'}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${config.autoStart ? 'right-1' : 'left-1'}`} />
                </button>
              </div>

              {/* Rate Limits Indicator */}
              {systemHealth.rateLimit && (
                <div className="p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800/80 space-y-2">
                  <span className="text-xs font-semibold text-zinc-200 block flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    Free-Tier API Usage & Protection
                  </span>
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-[11px]">
                      <span className="text-zinc-400 block">Minute Rate Limit</span>
                      <span className="text-xs font-mono font-bold text-emerald-400">
                        {systemHealth.rateLimit.minuteUsed} / {systemHealth.rateLimit.minuteLimit} RPM
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-[11px]">
                      <span className="text-zinc-400 block">Daily Budget</span>
                      <span className="text-xs font-mono font-bold text-emerald-400">
                        {systemHealth.rateLimit.dayUsed} / {systemHealth.rateLimit.dayLimit} RPD
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* System Diagnostics */}
              <div className="p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800/80 space-y-3">
                <span className="text-xs font-semibold text-zinc-200 block">Backend Server Diagnostics</span>
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-[11px]">
                    <span className="text-zinc-500 block text-[10px] uppercase">Backend Status</span>
                    <span className={`font-semibold flex items-center gap-1.5 mt-0.5 ${systemHealth.online ? 'text-emerald-400' : 'text-red-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${systemHealth.online ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                      {systemHealth.online ? 'Online (Port 3001)' : 'Offline'}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-[11px]">
                    <span className="text-zinc-500 block text-[10px] uppercase">CPU Load</span>
                    <span className="font-semibold text-zinc-200 font-mono mt-0.5 block">{systemHealth.cpuUsage}</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-[11px]">
                    <span className="text-zinc-500 block text-[10px] uppercase">Memory Usage</span>
                    <span className="font-semibold text-zinc-200 font-mono mt-0.5 block">{systemHealth.ramUsage}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-800/80 bg-zinc-950 flex items-center justify-between">
          <span className="text-[11px] text-zinc-500">
            {config.userName ? `Personalized for ${config.userName}` : 'Ready for interaction'}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition">
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2 bg-zinc-100 hover:bg-white text-zinc-950 font-semibold rounded-xl text-xs transition flex items-center gap-1.5 shadow-lg"
            >
              {savedSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Saved!</span>
                </>
              ) : (
                <span>Save Changes</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
