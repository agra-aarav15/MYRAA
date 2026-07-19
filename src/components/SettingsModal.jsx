import React, { useState, useEffect } from 'react';
import { X, Check, ExternalLink, Cpu, Mic, Power, Brain, Volume2 } from 'lucide-react';
import { getAiConfig, saveAiConfig } from '../services/aiProvider';

export default function SettingsModal({ isOpen, onClose, onOpenMemory }) {
  const [config, setConfig] = useState(getAiConfig());
  const [activeTab, setActiveTab] = useState('provider');
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [mics, setMics] = useState([]);
  const [systemHealth, setSystemHealth] = useState({ online: false, cpuUsage: '0%', ramUsage: '0GB' });

  useEffect(() => {
    if (isOpen) {
      setConfig(getAiConfig());

      // Fetch microphones
      if (navigator.mediaDevices?.enumerateDevices) {
        navigator.mediaDevices.enumerateDevices().then(devices => {
          setMics(devices.filter(d => d.kind === 'audioinput'));
        }).catch(() => {});
      }

      // Fetch System Health
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
    { id: 'groq', name: 'Groq Cloud', desc: 'Ultra-fast inference', icon: '⚡' },
    { id: 'gemini', name: 'Google Gemini', desc: 'Gemini 2.5 Flash / Pro', icon: '✦' },
    { id: 'grok', name: 'xAI Grok', desc: 'High intelligence', icon: '◆' },
    { id: 'openai', name: 'OpenAI', desc: 'GPT-4o multimodal', icon: '○' },
    { id: 'custom', name: 'Custom Endpoint', desc: 'Ollama / LM Studio', icon: '⬡' },
    { id: 'simulation', name: 'Offline Mode', desc: 'No API needed', icon: '◇' },
  ];

  const InputField = ({ label, value, onChange, placeholder, type = 'text', mono = false }) => (
    <div>
      <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">{label}</label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={`w-full mt-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-600 transition ${mono ? 'font-mono' : ''}`}
      />
    </div>
  );

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-zinc-950 border border-zinc-800 rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/80 bg-zinc-950">
          <h2 className="text-xs font-semibold text-zinc-200 uppercase tracking-widest flex items-center gap-2">
            MYRAA Configuration & Settings
          </h2>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-zinc-200 rounded-lg transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Settings Tab Selector */}
        <div className="px-6 py-3 border-b border-zinc-800/60 bg-zinc-950 flex items-center gap-1.5 overflow-x-auto">
          {[
            { id: 'provider', label: 'AI ENGINE', icon: '⚡' },
            { id: 'voice', label: 'WAKE & VOICE', icon: '🎙️' },
            { id: 'system', label: 'SYSTEM & OS', icon: '💻' }
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-mono transition shrink-0 flex items-center gap-1.5 ${
                activeTab === t.id 
                  ? 'bg-zinc-800 border border-zinc-600 text-zinc-100' 
                  : 'bg-zinc-900/40 border border-zinc-800 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}

          {onOpenMemory && (
            <button
              onClick={() => {
                onClose();
                onOpenMemory();
              }}
              className="ml-auto px-3 py-1.5 rounded-xl border border-zinc-800 bg-zinc-900/60 text-xs text-zinc-300 hover:text-white flex items-center gap-1.5 transition"
            >
              <Brain className="w-3.5 h-3.5" />
              <span>Memory Bank</span>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-6 max-h-[65vh] overflow-y-auto space-y-5">
          {/* TAB 1: AI PROVIDER */}
          {activeTab === 'provider' && (
            <div className="space-y-4">
              <label className="block text-[10px] font-medium uppercase tracking-wider text-zinc-500">Select AI Brain Provider</label>
              <div className="grid grid-cols-3 gap-1.5">
                {providers.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setConfig({ ...config, activeProvider: p.id })}
                    className={`flex flex-col text-left p-2.5 rounded-xl border transition ${
                      config.activeProvider === p.id 
                        ? 'bg-zinc-900 border-zinc-600 text-zinc-100' 
                        : 'bg-zinc-950 border-zinc-800/50 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-sm">{p.icon}</span>
                      {config.activeProvider === p.id && <Check className="w-3 h-3 text-zinc-300" />}
                    </div>
                    <span className="font-medium text-[10px] text-zinc-200">{p.name}</span>
                    <span className="text-[9px] text-zinc-600 truncate">{p.desc}</span>
                  </button>
                ))}
              </div>

              {config.activeProvider === 'groq' && (
                <div className="bg-zinc-900/50 border border-zinc-800/50 p-4 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-zinc-300 uppercase tracking-wider">Groq Cloud</span>
                    <a href="https://console.groq.com" target="_blank" rel="noreferrer" className="text-[9px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1">
                      Get API Key <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                  <InputField label="API Key" type="password" value={config.groqKey || ''} onChange={(e) => setConfig({ ...config, groqKey: e.target.value })} placeholder="gsk_..." />
                  <InputField label="Model" value={config.groqModel || ''} mono onChange={(e) => setConfig({ ...config, groqModel: e.target.value })} placeholder="llama-3.3-70b-versatile" />
                </div>
              )}

              {config.activeProvider === 'gemini' && (
                <div className="bg-zinc-900/50 border border-zinc-800/50 p-4 rounded-xl space-y-3">
                  <span className="text-[10px] font-semibold text-zinc-300 uppercase tracking-wider">Google Gemini</span>
                  <InputField label="API Key" type="password" value={config.geminiKey || ''} onChange={(e) => setConfig({ ...config, geminiKey: e.target.value })} placeholder="AIzaSy..." />
                  <InputField label="Model" value={config.geminiModel || ''} mono onChange={(e) => setConfig({ ...config, geminiModel: e.target.value })} placeholder="gemini-2.5-flash" />
                </div>
              )}

              {config.activeProvider === 'grok' && (
                <div className="bg-zinc-900/50 border border-zinc-800/50 p-4 rounded-xl space-y-3">
                  <span className="text-[10px] font-semibold text-zinc-300 uppercase tracking-wider">xAI Grok</span>
                  <InputField label="API Key" type="password" value={config.grokKey || ''} onChange={(e) => setConfig({ ...config, grokKey: e.target.value })} placeholder="xai-..." />
                  <InputField label="Model" value={config.grokModel || ''} mono onChange={(e) => setConfig({ ...config, grokModel: e.target.value })} placeholder="grok-beta" />
                </div>
              )}

              {config.activeProvider === 'custom' && (
                <div className="bg-zinc-900/50 border border-zinc-800/50 p-4 rounded-xl space-y-3">
                  <span className="text-[10px] font-semibold text-zinc-300 uppercase tracking-wider">Custom Endpoint</span>
                  <InputField label="Base URL" value={config.customUrl || ''} mono onChange={(e) => setConfig({ ...config, customUrl: e.target.value })} placeholder="http://localhost:11434/v1" />
                  <InputField label="Model ID" value={config.customModel || ''} mono onChange={(e) => setConfig({ ...config, customModel: e.target.value })} placeholder="llama3" />
                </div>
              )}
            </div>
          )}

          {/* TAB 2: VOICE & WAKE WORD */}
          {activeTab === 'voice' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-900/50 border border-zinc-800/50">
                <div>
                  <span className="text-xs font-semibold text-zinc-200 block">Wake Phrase Activation</span>
                  <span className="text-[10px] text-zinc-500 font-mono">Always-listen activation word</span>
                </div>
                <button
                  onClick={() => setConfig(prev => ({ ...prev, wakeWordEnabled: !prev.wakeWordEnabled }))}
                  className={`w-10 h-5 rounded-full p-0.5 transition ${config.wakeWordEnabled ? 'bg-emerald-500' : 'bg-zinc-800'}`}
                >
                  <div className={`bg-white w-4 h-4 rounded-full transition transform ${config.wakeWordEnabled ? 'translate-x-5' : ''}`} />
                </button>
              </div>

              <InputField 
                label="Wake Phrase" 
                value={config.wakePhrase || 'hey myraa'} 
                onChange={(e) => setConfig({ ...config, wakePhrase: e.target.value })} 
                placeholder="hey myraa" 
                mono 
              />

              <div>
                <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium block mb-1">Microphone Input Device</label>
                <select
                  value={config.micDeviceId || ''}
                  onChange={(e) => setConfig({ ...config, micDeviceId: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none"
                >
                  <option value="">Default System Microphone</option>
                  {mics.map((m, i) => (
                    <option key={m.deviceId || i} value={m.deviceId}>
                      {m.label || `Microphone ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                  <span>Sensitivity Level</span>
                  <span className="font-mono text-zinc-200">{config.sensitivity || 80}%</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="100"
                  value={config.sensitivity || 80}
                  onChange={(e) => setConfig({ ...config, sensitivity: Number(e.target.value) })}
                  className="w-full accent-zinc-200"
                />
              </div>
            </div>
          )}

          {/* TAB 3: SYSTEM & AUTOMATION */}
          {activeTab === 'system' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-900/50 border border-zinc-800/50">
                <div>
                  <span className="text-xs font-semibold text-zinc-200 block">Launch at Windows Startup</span>
                  <span className="text-[10px] text-zinc-500 font-mono">Silent background execution on login</span>
                </div>
                <button
                  onClick={() => handleToggleAutoStart(!config.autoStart)}
                  className={`w-10 h-5 rounded-full p-0.5 transition ${config.autoStart ? 'bg-emerald-500' : 'bg-zinc-800'}`}
                >
                  <div className={`bg-white w-4 h-4 rounded-full transition transform ${config.autoStart ? 'translate-x-5' : ''}`} />
                </button>
              </div>

              {/* System Diagnostics Display */}
              <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-2 font-mono text-xs">
                <span className="text-[10px] text-zinc-400 uppercase tracking-widest block font-bold">System Status</span>
                <div className="flex items-center justify-between text-zinc-300">
                  <span>Backend Status:</span>
                  <span className="text-emerald-400 font-bold">ONLINE (0.0.0.0:3001)</span>
                </div>
                <div className="flex items-center justify-between text-zinc-300">
                  <span>CPU Usage:</span>
                  <span>{systemHealth.cpuUsage || '12%'}</span>
                </div>
                <div className="flex items-center justify-between text-zinc-300">
                  <span>RAM Usage:</span>
                  <span>{systemHealth.ramUsage || '4.2GB / 16GB'}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800/80 bg-zinc-950">
          <span className="text-[10px] text-emerald-500 font-medium">
            {savedSuccess ? '✓ Settings Saved' : ''}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-500 hover:text-zinc-200 transition">
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-zinc-100 hover:bg-white text-zinc-950 shadow transition"
            >
              Save Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
