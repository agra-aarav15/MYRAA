import React, { useState, useEffect } from 'react';
import { 
  Brain, X, Trash2, Plus, User, Heart, Target, Briefcase, Users, Flame, Sparkles
} from 'lucide-react';
import { 
  fetchAllMemories, addCategorizedMemory, deleteMemoryById, MEMORY_CATEGORIES 
} from '../services/memoryStore';

export default function MemoryDashboardModal({ isOpen, onClose }) {
  const [memories, setMemories] = useState([]);
  const [activeTab, setActiveTab] = useState('all');
  const [newMemoryText, setNewMemoryText] = useState('');
  const [newCategory, setNewCategory] = useState('identity');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchAllMemories().then(data => setMemories(data));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAdd = async () => {
    if (!newMemoryText.trim()) return;
    setIsSubmitting(true);
    const updated = await addCategorizedMemory(newCategory, newMemoryText);
    if (updated) setMemories(updated);
    setNewMemoryText('');
    setIsSubmitting(false);
  };

  const handleDelete = async (id) => {
    const updated = await deleteMemoryById(id);
    if (updated) setMemories(updated);
  };

  const filteredMemories = activeTab === 'all' 
    ? memories 
    : memories.filter(m => m.category === activeTab);

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-zinc-950 border border-zinc-800 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/80 bg-zinc-950">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
              <Brain className="w-4 h-4 text-zinc-200" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-100 uppercase tracking-widest flex items-center gap-2">
                MYRAA Memory Knowledge Base
                <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
              </h2>
              <p className="text-[10px] font-mono text-zinc-500">Categorized Companion Memory System</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-white rounded-xl transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Category Tabs */}
        <div className="px-6 py-3 border-b border-zinc-800/60 bg-zinc-950 flex items-center gap-1.5 overflow-x-auto">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono transition shrink-0 ${
              activeTab === 'all' 
                ? 'bg-zinc-800 border border-zinc-600 text-zinc-100' 
                : 'bg-zinc-900/40 border border-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            All ({memories.length})
          </button>

          {Object.keys(MEMORY_CATEGORIES).map((catKey) => {
            const cat = MEMORY_CATEGORIES[catKey];
            const count = memories.filter(m => m.category === catKey).length;
            return (
              <button
                key={catKey}
                onClick={() => setActiveTab(catKey)}
                className={`px-3 py-1.5 rounded-xl text-xs font-mono transition shrink-0 flex items-center gap-1.5 ${
                  activeTab === catKey 
                    ? 'bg-zinc-800 border border-zinc-600 text-zinc-100' 
                    : 'bg-zinc-900/40 border border-zinc-800 text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
                <span className="text-[9px] text-zinc-600">({count})</span>
              </button>
            );
          })}
        </div>

        {/* Add Memory Input Box */}
        <div className="p-4 bg-zinc-900/40 border-b border-zinc-800/60 flex items-center gap-2">
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none shrink-0"
          >
            {Object.keys(MEMORY_CATEGORIES).map(catKey => (
              <option key={catKey} value={catKey}>
                {MEMORY_CATEGORIES[catKey].icon} {MEMORY_CATEGORIES[catKey].label}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={newMemoryText}
            onChange={(e) => setNewMemoryText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Add new personal memory or fact about you..."
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 focus:outline-none"
          />

          <button
            onClick={handleAdd}
            disabled={isSubmitting || !newMemoryText.trim()}
            className="px-4 py-2 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-bold transition disabled:opacity-40 shrink-0 flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> Add Memory
          </button>
        </div>

        {/* Memory Items List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {filteredMemories.length === 0 ? (
            <div className="text-center py-12 text-zinc-500 text-xs font-mono">
              No memory items recorded in this category yet.
            </div>
          ) : (
            filteredMemories.map(m => {
              const catInfo = MEMORY_CATEGORIES[m.category] || { label: m.category, icon: '📌' };
              return (
                <div 
                  key={m.id}
                  className="p-3.5 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 flex items-center justify-between gap-3 group hover:border-zinc-700 transition"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-base mt-0.5">{catInfo.icon}</span>
                    <div>
                      <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider block">
                        {catInfo.label}
                      </span>
                      <p className="text-xs text-zinc-200 mt-0.5 leading-relaxed">{m.text}</p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDelete(m.id)}
                    className="p-1.5 text-zinc-600 hover:text-zinc-200 hover:bg-zinc-800 rounded-xl transition opacity-60 group-hover:opacity-100 shrink-0"
                    title="Delete Memory"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
