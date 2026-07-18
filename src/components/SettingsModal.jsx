import React, { useState, useEffect } from 'react';
import { X, Check, ExternalLink } from 'lucide-react';
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
    }, 800);
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800/60">
          <h2 className="text-xs font-semibold text-zinc-200 uppercase tracking-widest">Settings</h2>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-zinc-200 rounded-lg transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 max-h-[70vh] overflow-y-auto space-y-5">
          {/* Provider Grid */}
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-wider text-zinc-500 mb-2">AI Provider</label>
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
          </div>

          {/* Provider-specific config */}
          {config.activeProvider === 'groq' && (
            <div className="bg-zinc-900/50 border border-zinc-800/50 p-4 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-zinc-300 uppercase tracking-wider">Groq Cloud</span>
                <a href="https://console.groq.com" target="_blank" rel="noreferrer"
                  className="text-[9px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition">
                  Get API Key <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
              <InputField label="API Key" type="password" value={config.groqKey}
                onChange={(e) => setConfig({ ...config, groqKey: e.target.value })} placeholder="gsk_..." />
              <InputField label="Model" value={config.groqModel} mono
                onChange={(e) => setConfig({ ...config, groqModel: e.target.value })} placeholder="llama-3.3-70b-versatile" />
            </div>
          )}

          {config.activeProvider === 'gemini' && (
            <div className="bg-zinc-900/50 border border-zinc-800/50 p-4 rounded-xl space-y-3">
              <span className="text-[10px] font-semibold text-zinc-300 uppercase tracking-wider">Google Gemini</span>
              <InputField label="API Key" type="password" value={config.geminiKey}
                onChange={(e) => setConfig({ ...config, geminiKey: e.target.value })} placeholder="AIzaSy..." />
              <InputField label="Model" value={config.geminiModel} mono
                onChange={(e) => setConfig({ ...config, geminiModel: e.target.value })} placeholder="gemini-2.5-flash" />
            </div>
          )}

          {config.activeProvider === 'grok' && (
            <div className="bg-zinc-900/50 border border-zinc-800/50 p-4 rounded-xl space-y-3">
              <span className="text-[10px] font-semibold text-zinc-300 uppercase tracking-wider">xAI Grok</span>
              <InputField label="API Key" type="password" value={config.grokKey}
                onChange={(e) => setConfig({ ...config, grokKey: e.target.value })} placeholder="xai-..." />
              <InputField label="Model" value={config.grokModel} mono
                onChange={(e) => setConfig({ ...config, grokModel: e.target.value })} placeholder="grok-beta" />
            </div>
          )}

          {config.activeProvider === 'openai' && (
            <div className="bg-zinc-900/50 border border-zinc-800/50 p-4 rounded-xl space-y-3">
              <span className="text-[10px] font-semibold text-zinc-300 uppercase tracking-wider">OpenAI</span>
              <InputField label="API Key" type="password" value={config.openaiKey}
                onChange={(e) => setConfig({ ...config, openaiKey: e.target.value })} placeholder="sk-..." />
              <InputField label="Model" value={config.openaiModel} mono
                onChange={(e) => setConfig({ ...config, openaiModel: e.target.value })} placeholder="gpt-4o" />
            </div>
          )}

          {config.activeProvider === 'custom' && (
            <div className="bg-zinc-900/50 border border-zinc-800/50 p-4 rounded-xl space-y-3">
              <span className="text-[10px] font-semibold text-zinc-300 uppercase tracking-wider">Custom Endpoint</span>
              <InputField label="Base URL" value={config.customUrl} mono
                onChange={(e) => setConfig({ ...config, customUrl: e.target.value })} placeholder="http://localhost:11434/v1" />
              <InputField label="API Key (optional)" type="password" value={config.customKey}
                onChange={(e) => setConfig({ ...config, customKey: e.target.value })} placeholder="Optional" />
              <InputField label="Model ID" value={config.customModel} mono
                onChange={(e) => setConfig({ ...config, customModel: e.target.value })} placeholder="llama3" />
            </div>
          )}

          {/* Nickname */}
          <div>
            <label className="block text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1">Your Name</label>
            <input
              type="text"
              value={config.userName}
              onChange={(e) => setConfig({ ...config, userName: e.target.value })}
              placeholder="Darling"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-600 transition"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-800/60">
          <span className="text-[10px] text-emerald-500 font-medium">
            {savedSuccess ? '✓ Saved' : ''}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-[10px] font-medium text-zinc-500 hover:text-zinc-200 transition">
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-1.5 rounded-lg text-[10px] font-semibold bg-zinc-200 hover:bg-white text-zinc-900 shadow transition"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
