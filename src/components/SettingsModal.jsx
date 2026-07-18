import React, { useState, useEffect } from 'react';
import { X, Check, Sparkles, ExternalLink } from 'lucide-react';
import { getAiConfig, saveAiConfig } from '../services/aiProvider';

export default function SettingsModal({ isOpen, onClose }) {
  const [config, setConfig] = useState(getAiConfig());
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) setConfig(getAiConfig());
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    saveAiConfig(config);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 1000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-fade-in">
      <div className="bg-black border border-zinc-800 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-pink-500" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">MYRAA AI Brain & Provider Settings</h2>
          </div>
          <button 
            onClick={onClose} 
            className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-900 rounded-xl transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 max-h-[75vh] overflow-y-auto space-y-6">
          {/* Active Provider Selection */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-pink-400 mb-2">
              Select AI Engine / Provider
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
              {[
                { id: 'groq', name: 'Groq Cloud', desc: 'console.groq.com (Ultra Fast)', icon: '⚡' },
                { id: 'gemini', name: 'Google Gemini', desc: 'Gemini 2.5 Flash / Pro Vision', icon: '✨' },
                { id: 'grok', name: 'xAI Grok', desc: 'api.x.ai (High Intelligence)', icon: '🚀' },
                { id: 'openai', name: 'OpenAI', desc: 'GPT-4o & Multimodal', icon: '🤖' },
                { id: 'custom', name: 'Custom Endpoint', desc: 'Ollama / LM Studio / Local', icon: '🌐' },
                { id: 'simulation', name: 'MYRAA Simulation', desc: 'Offline Companion Mode', icon: '💖' },
              ].map((prov) => (
                <button
                  key={prov.id}
                  type="button"
                  onClick={() => setConfig({ ...config, activeProvider: prov.id })}
                  className={`flex flex-col text-left p-3 rounded-2xl border transition ${
                    config.activeProvider === prov.id 
                      ? 'bg-zinc-900 border-pink-500 text-white' 
                      : 'bg-zinc-950 border-zinc-800/80 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-base">{prov.icon}</span>
                    {config.activeProvider === prov.id && <Check className="w-4 h-4 text-pink-500" />}
                  </div>
                  <span className="font-semibold text-xs text-white">{prov.name}</span>
                  <span className="text-[10px] text-zinc-500 truncate">{prov.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Provider Settings */}
          {config.activeProvider === 'groq' && (
            <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">Groq Cloud Configuration</span>
                <a 
                  href="https://console.groq.com" 
                  target="_blank" 
                  rel="noreferrer"
                  className="text-[11px] text-pink-400 hover:underline flex items-center gap-1"
                >
                  Get Key from console.groq.com <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div>
                <label className="text-[11px] text-zinc-400">Groq API Key</label>
                <input
                  type="password"
                  value={config.groqKey}
                  onChange={(e) => setConfig({ ...config, groqKey: e.target.value })}
                  placeholder="gsk_..."
                  className="w-full mt-1 bg-black border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500"
                />
              </div>
              <div>
                <label className="text-[11px] text-zinc-400">Model Name</label>
                <input
                  type="text"
                  value={config.groqModel}
                  onChange={(e) => setConfig({ ...config, groqModel: e.target.value })}
                  placeholder="llama-3.3-70b-versatile"
                  className="w-full mt-1 bg-black border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500 font-mono"
                />
              </div>
            </div>
          )}

          {config.activeProvider === 'gemini' && (
            <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl space-y-3">
              <span className="text-xs font-semibold text-white">Google Gemini Configuration</span>
              <div>
                <label className="text-[11px] text-zinc-400">Gemini API Key</label>
                <input
                  type="password"
                  value={config.geminiKey}
                  onChange={(e) => setConfig({ ...config, geminiKey: e.target.value })}
                  placeholder="AIzaSy..."
                  className="w-full mt-1 bg-black border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500"
                />
              </div>
              <div>
                <label className="text-[11px] text-zinc-400">Model Name</label>
                <input
                  type="text"
                  value={config.geminiModel}
                  onChange={(e) => setConfig({ ...config, geminiModel: e.target.value })}
                  placeholder="gemini-2.5-flash"
                  className="w-full mt-1 bg-black border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500 font-mono"
                />
              </div>
            </div>
          )}

          {config.activeProvider === 'grok' && (
            <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl space-y-3">
              <span className="text-xs font-semibold text-white">xAI Grok Configuration</span>
              <div>
                <label className="text-[11px] text-zinc-400">Grok API Key</label>
                <input
                  type="password"
                  value={config.grokKey}
                  onChange={(e) => setConfig({ ...config, grokKey: e.target.value })}
                  placeholder="xai-..."
                  className="w-full mt-1 bg-black border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500"
                />
              </div>
              <div>
                <label className="text-[11px] text-zinc-400">Model Name</label>
                <input
                  type="text"
                  value={config.grokModel}
                  onChange={(e) => setConfig({ ...config, grokModel: e.target.value })}
                  placeholder="grok-beta"
                  className="w-full mt-1 bg-black border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500 font-mono"
                />
              </div>
            </div>
          )}

          {config.activeProvider === 'custom' && (
            <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl space-y-3">
              <span className="text-xs font-semibold text-white">Custom Endpoint (Ollama / LM Studio / Local AI)</span>
              <div>
                <label className="text-[11px] text-zinc-400">Base URL</label>
                <input
                  type="text"
                  value={config.customUrl}
                  onChange={(e) => setConfig({ ...config, customUrl: e.target.value })}
                  placeholder="http://localhost:11434/v1"
                  className="w-full mt-1 bg-black border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500 font-mono"
                />
              </div>
              <div>
                <label className="text-[11px] text-zinc-400">API Key (Optional)</label>
                <input
                  type="password"
                  value={config.customKey}
                  onChange={(e) => setConfig({ ...config, customKey: e.target.value })}
                  placeholder="Optional API Key"
                  className="w-full mt-1 bg-black border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500"
                />
              </div>
              <div>
                <label className="text-[11px] text-zinc-400">Model ID</label>
                <input
                  type="text"
                  value={config.customModel}
                  onChange={(e) => setConfig({ ...config, customModel: e.target.value })}
                  placeholder="llama3"
                  className="w-full mt-1 bg-black border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500 font-mono"
                />
              </div>
            </div>
          )}

          {/* User Nickname */}
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1">How should MYRAA address you?</label>
            <input
              type="text"
              value={config.userName}
              onChange={(e) => setConfig({ ...config, userName: e.target.value })}
              placeholder="Darling"
              className="w-full bg-black border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500"
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800 bg-zinc-950">
          <span className="text-xs text-pink-400 font-semibold">
            {savedSuccess ? '✓ Settings Saved Successfully!' : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-white transition"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-pink-600 hover:bg-pink-500 text-white shadow-lg shadow-pink-600/20 transition"
            >
              Save Configuration
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
