import React, { useState } from 'react';
import { 
  Globe, Search, X, ExternalLink, ArrowLeft, ArrowRight, RefreshCw, 
  Plus, Monitor, Sparkles, Terminal, Play
} from 'lucide-react';

export default function BrowserAgentModal({ isOpen, onClose, initialUrl = 'https://google.com' }) {
  const [tabs, setTabs] = useState([
    { id: 'tab_1', title: 'Web Agent Search', url: initialUrl }
  ]);
  const [activeTabId, setActiveTabId] = useState('tab_1');
  const [addressInput, setAddressInput] = useState(initialUrl);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  if (!isOpen) return null;

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

  const handleNavigate = (targetUrl) => {
    let formatted = targetUrl;
    if (!formatted.startsWith('http://') && !formatted.startsWith('https://')) {
      formatted = `https://${formatted}`;
    }
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, url: formatted, title: formatted } : t));
    setAddressInput(formatted);
  };

  const handleWebSearch = async (queryStr) => {
    const q = queryStr || searchQuery;
    if (!q.trim()) return;

    setIsSearching(true);
    try {
      // Direct Web & YouTube Search Simulation
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
      handleNavigate(searchUrl);
      setSearchResults([
        { title: `Search results for "${q}"`, snippet: `Browsing web for ${q}...`, url: searchUrl }
      ]);
    } catch (e) {
      console.warn(e);
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddTab = () => {
    const newId = `tab_${Date.now()}`;
    const newTab = { id: newId, title: 'New Web Agent Tab', url: 'https://google.com' };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newId);
    setAddressInput('https://google.com');
  };

  const handleCloseTab = (id, e) => {
    e.stopPropagation();
    if (tabs.length === 1) return;
    const filtered = tabs.filter(t => t.id !== id);
    setTabs(filtered);
    if (activeTabId === id) {
      setActiveTabId(filtered[0].id);
      setAddressInput(filtered[0].url);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-zinc-950 border border-zinc-800 rounded-3xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header Navigation & Tabs */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-900/90 border-b border-zinc-800">
          <div className="flex items-center gap-2 overflow-x-auto">
            <div className="flex items-center gap-1.5 pr-2 border-r border-zinc-800">
              <Globe className="w-4 h-4 text-zinc-300" />
              <span className="text-xs font-bold text-zinc-200 tracking-wider uppercase">Browser Agent</span>
            </div>

            {/* Tabs Row */}
            {tabs.map((tab) => (
              <div
                key={tab.id}
                onClick={() => {
                  setActiveTabId(tab.id);
                  setAddressInput(tab.url);
                }}
                className={`flex items-center gap-2 px-3 py-1 rounded-xl text-xs font-mono transition cursor-pointer shrink-0 ${
                  activeTabId === tab.id 
                    ? 'bg-zinc-800 border border-zinc-700 text-zinc-100' 
                    : 'bg-zinc-950/60 border border-zinc-800/50 text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <span className="truncate max-w-[120px]">{tab.title}</span>
                {tabs.length > 1 && (
                  <button onClick={(e) => handleCloseTab(tab.id, e)} className="hover:text-white">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}

            <button onClick={handleAddTab} className="p-1 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 text-zinc-400 hover:text-white transition">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-white rounded-xl transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Address & Navigation Bar */}
        <div className="flex items-center gap-2 px-4 py-2 bg-zinc-950 border-b border-zinc-800">
          <button onClick={() => window.history.back()} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-900 transition">
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => window.history.forward()} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-900 transition">
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => handleNavigate(addressInput)} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-900 transition">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          {/* URL Address Bar */}
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              handleNavigate(addressInput);
            }} 
            className="flex-1 flex items-center bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-1.5"
          >
            <input
              type="text"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              placeholder="Enter URL or search term..."
              className="w-full bg-transparent text-xs text-zinc-100 focus:outline-none font-mono"
            />
          </form>

          {/* Direct Open in External Browser */}
          <a
            href={activeTab.url}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-zinc-300 flex items-center gap-1.5 transition"
          >
            <span>Open Browser</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        {/* Browser Content Frame */}
        <div className="flex-1 bg-zinc-950 relative flex flex-col">
          {activeTab.url && (
            activeTab.url.includes('google.com') ||
            activeTab.url.includes('youtube.com') ||
            activeTab.url.includes('github.com') ||
            activeTab.url.includes('x.com') ||
            activeTab.url.includes('twitter.com') ||
            activeTab.url.includes('instagram.com') ||
            activeTab.url.includes('openai.com')
          ) ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-gradient-to-b from-zinc-950 to-zinc-900 border-t border-zinc-800 animate-fade-in">
              <div className="w-16 h-16 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-6 shadow-2xl animate-pulse">
                <Globe className="w-8 h-8 text-emerald-400" />
              </div>
              <h3 className="text-lg font-bold text-zinc-100 mb-2">Security & Frame Protection Notice</h3>
              <p className="text-xs text-zinc-400 max-w-md mb-6 leading-relaxed">
                Major sites like <span className="text-zinc-200 font-semibold">{activeTab.title || activeTab.url}</span> prevent inside-browser embedding via X-Frame-Options to protect your session.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    fetch('/api/tools/execute', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ toolName: 'openWebsite', args: { url: activeTab.url } })
                    });
                    window.open(activeTab.url, '_blank');
                  }}
                  className="px-6 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-xs shadow-[0_0_25px_rgba(16,185,129,0.4)] flex items-center gap-2 transition transform hover:scale-105"
                >
                  <Play className="w-4 h-4 fill-zinc-950" />
                  <span>Launch in Desktop Window Instantly</span>
                </button>
              </div>
            </div>
          ) : (
            <iframe
              src={activeTab.url}
              title="Browser Agent Frame"
              className="w-full h-full border-none bg-white"
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
            />
          )}
        </div>
      </div>
    </div>
  );
}
