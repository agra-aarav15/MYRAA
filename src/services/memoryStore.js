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
    text: 'Aarav enjoys programming, web development, and creating intelligent software.',
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

/**
 * Self-evolving memory extractor.
 * Automatically scans user text for preferences, active projects, habits, and goals to learn continuously.
 * @param {string} userText 
 */
export async function autoExtractMemoriesFromChat(userText = '') {
  if (!userText || typeof userText !== 'string' || userText.trim().length < 4) return;
  const lower = userText.toLowerCase().trim();

  // Patterns for self-evolving memory
  const patterns = [
    { regex: /(?:i love|i like|i really enjoy|favorite)\s+(?:listening to|playing|watching|using)?\s*(.+)/i, category: 'preference', prefix: 'Aarav enjoys' },
    { regex: /(?:i am working on|i'm building|i'm coding|my project is)\s+(.+)/i, category: 'project', prefix: 'Aarav is actively working on' },
    { regex: /(?:my goal is|i want to learn|i want to build)\s+(.+)/i, category: 'goal', prefix: 'Aarav wants to' },
    { regex: /(?:i always|i usually|every day i)\s+(.+)/i, category: 'behavior', prefix: 'Aarav' }
  ];

  for (const p of patterns) {
    const match = lower.match(p.regex);
    if (match && match[1]) {
      const extracted = match[1].replace(/[.!?,]$/, '').trim();
      if (extracted.length > 2 && extracted.length < 120) {
        const memoryText = `${p.prefix} ${extracted}.`;
        const existing = getLocalMemories();
        // Prevent duplicate memories
        if (!existing.some(m => m.text.toLowerCase().includes(extracted.toLowerCase()))) {
          console.log(`[Evolving Memory] Auto-learned new memory: "${memoryText}"`);
          await addCategorizedMemory(p.category, memoryText);
          break;
        }
      }
    }
  }
}

