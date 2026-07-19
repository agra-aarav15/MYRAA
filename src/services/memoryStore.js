// Categorized Companion Memory Store for MYRAA

const MEMORY_STORAGE_KEY = 'MYRAA_COMPANION_MEMORIES_V2';

export const MEMORY_CATEGORIES = {
  identity: { label: 'Identity Core', icon: '👤' },
  preference: { label: 'Preferences', icon: '💖' },
  goal: { label: 'Life Goals', icon: '🎯' },
  project: { label: 'Active Projects', icon: '💼' },
  relationship: { label: 'Relationships', icon: '👥' },
  emotional: { label: 'Milestones', icon: '🔥' },
  behavior: { label: 'Habits & Behaviors', icon: '🧠' }
};

const DEFAULT_MEMORIES = [
  {
    id: 'mem_1',
    category: 'identity',
    text: 'User enjoys programming, web development, and creating intelligent software.',
    createdAt: new Date().toISOString()
  },
  {
    id: 'mem_2',
    category: 'preference',
    text: 'Prefers a warm, intelligent, loving AI companion with a minimal clean obsidian design.',
    createdAt: new Date().toISOString()
  }
];

export function getLocalMemories() {
  try {
    const saved = localStorage.getItem(MEMORY_STORAGE_KEY);
    return saved ? JSON.parse(saved) : DEFAULT_MEMORIES;
  } catch (e) {
    return DEFAULT_MEMORIES;
  }
}

export function saveLocalMemories(memories) {
  try {
    localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(memories));
  } catch (e) {}
}

export async function fetchAllMemories() {
  try {
    const host = (typeof window !== 'undefined' && window.location.hostname) ? window.location.hostname : 'localhost';
    const res = await fetch(`http://${host}:3001/api/memory/all`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        saveLocalMemories(data);
        return data;
      }
    }
  } catch (e) {}
  return getLocalMemories();
}

export async function addCategorizedMemory(category = 'identity', text = '') {
  if (!text || !text.trim()) return null;
  const memoryObj = {
    id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    category,
    text: text.trim(),
    createdAt: new Date().toISOString()
  };

  const current = getLocalMemories();
  const updated = [...current, memoryObj];
  saveLocalMemories(updated);

  try {
    const host = (typeof window !== 'undefined' && window.location.hostname) ? window.location.hostname : 'localhost';
    await fetch(`http://${host}:3001/api/memory/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, text: text.trim() })
    });
  } catch (e) {}

  return updated;
}

export async function deleteMemoryById(id) {
  const current = getLocalMemories();
  const updated = current.filter(m => m.id !== id);
  saveLocalMemories(updated);

  try {
    const host = (typeof window !== 'undefined' && window.location.hostname) ? window.location.hostname : 'localhost';
    await fetch(`http://${host}:3001/api/memory/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
  } catch (e) {}

  return updated;
}

export function formatMemoryForPrompt() {
  const memories = getLocalMemories();
  let text = `[MYRAA CATEGORIZED COMPANION MEMORY KNOWLEDGE BASE]\n`;
  if (memories.length === 0) {
    text += `- No stored memories yet.\n`;
    return text;
  }

  memories.forEach(m => {
    const catLabel = MEMORY_CATEGORIES[m.category]?.label || m.category;
    text += `- [${catLabel}] ${m.text}\n`;
  });

  return text;
}
