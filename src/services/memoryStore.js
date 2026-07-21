// =====================================================================
// Categorized Companion Memory Store for MYRAA — v1.2.0
// Self-evolving memory with:
//   • AI-driven extraction (any phrasing, not just 4 regex triggers)
//   • Update/merge semantics (newer facts supersede older duplicates)
//   • Cross-pipeline sync on startup (Live-mode learning shows up in
//     text mode)
//   • Confidence + source fields for provenance
// The old 4-regex extractor is kept as a fast synchronous fallback for
// when no AI provider is configured.
// =====================================================================

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
    createdAt: new Date().toISOString(),
    source: 'seed',
    confidence: 0.9
  },
  {
    id: 'mem_2',
    category: 'preference',
    text: 'Prefers a warm, intelligent, loving AI companion with a minimal clean obsidian design.',
    createdAt: new Date().toISOString(),
    source: 'seed',
    confidence: 0.9
  }
];

// =====================================================================
// Local (localStorage) accessors
// =====================================================================
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

// =====================================================================
// Cross-pipeline sync — pull server memories.json into localStorage so
// anything learned during a Live voice session shows up in text mode.
// Safe to call on app startup; never throws.
// =====================================================================
let _syncedOnce = false;
export async function syncMemoriesFromServer(force = false) {
  if (_syncedOnce && !force) return getLocalMemories();
  try {
    const host = (typeof window !== 'undefined' && window.location.hostname) || 'localhost';
    const res = await fetch(`http://${host}:3001/api/memory/all`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        // Merge: prefer server copy of any memory that exists in both,
        // keep client-only memories (e.g. very recent adds not yet flushed).
        const local = getLocalMemories();
        const merged = mergeMemories(local, data);
        saveLocalMemories(merged);
        _syncedOnce = true;
        return merged;
      }
    }
  } catch (e) {
    // Network unreachable — fall through to local copy silently.
  }
  _syncedOnce = true;
  return getLocalMemories();
}

// Merge two memory arrays. Server memories win on conflict (they've gone
// through the AI consolidation pipeline). Dedup by id, then by fuzzy text
// match.
function mergeMemories(a, b) {
  const byId = new Map();
  for (const m of [...a, ...b]) {
    if (!m || !m.id) continue;
    const existing = byId.get(m.id);
    if (!existing) {
      byId.set(m.id, m);
    } else {
      // Keep the more recently updated one.
      const exTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
      const newTime = new Date(m.updatedAt || m.createdAt || 0).getTime();
      byId.set(m.id, newTime >= exTime ? m : existing);
    }
  }
  return Array.from(byId.values());
}

// Backward-compatible alias.
export async function fetchAllMemories() {
  return syncMemoriesFromServer(true);
}

// =====================================================================
// Add memory with update/merge semantics.
// v1.2.0: if a new memory is semantically close to an existing one in the
// same category (Jaccard word overlap >= 0.5), we UPDATE the existing
// memory instead of appending a duplicate. This prevents the old bug
// where "I use Vue" + later "I use React" both sat in storage forever.
// =====================================================================
function wordSimilarity(a, b) {
  const stop = new Set(['the', 'a', 'an', 'is', 'am', 'are', 'i', 'to', 'and', 'of', 'in', 'on', 'my', 'me', 'it', 'that', 'with', 'for']);
  const wa = new Set(String(a).toLowerCase().split(/\W+/).filter(w => w.length > 2 && !stop.has(w)));
  const wb = new Set(String(b).toLowerCase().split(/\W+/).filter(w => w.length > 2 && !stop.has(w)));
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const union = wa.size + wb.size - inter;
  return union > 0 ? inter / union : 0;
}

export async function addCategorizedMemory(category = 'identity', text = '', opts = {}) {
  if (!text || !text.trim()) return null;
  const cleanText = text.trim();
  const current = getLocalMemories();

  // Look for a similar memory in the same category to update instead of dup.
  let bestMatch = null;
  let bestScore = 0;
  for (const m of current) {
    if (m.category !== category) continue;
    const score = wordSimilarity(m.text, cleanText);
    if (score > bestScore) { bestScore = score; bestMatch = m; }
  }

  if (bestMatch && bestScore >= 0.5) {
    // Update in place.
    bestMatch.text = cleanText;
    bestMatch.updatedAt = new Date().toISOString();
    bestMatch.confidence = Math.min(1, (bestMatch.confidence || 0.5) + 0.1);
    bestMatch.source = opts.source || bestMatch.source || 'chat';
    saveLocalMemories(current);
    persistMemoryToServer(bestMatch, 'update');
    return current;
  }

  // Otherwise add a fresh memory.
  const memoryObj = {
    id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    category,
    text: cleanText,
    createdAt: new Date().toISOString(),
    source: opts.source || 'chat',
    confidence: opts.confidence ?? 0.7,
  };
  const updated = [...current, memoryObj];
  saveLocalMemories(updated);
  persistMemoryToServer(memoryObj, 'add');
  return updated;
}

// Fire-and-forget persist to the server (Live-mode pipeline writes the
// same memories.json).
function persistMemoryToServer(memory, action) {
  try {
    const host = (typeof window !== 'undefined' && window.location.hostname) || 'localhost';
    fetch(`http://${host}:3001/api/memory/${action === 'update' ? 'add' : 'add'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: memory.id,
        category: memory.category,
        text: memory.text,
        source: memory.source,
        confidence: memory.confidence,
      })
    }).catch(() => {});
  } catch (e) {}
}

export async function deleteMemoryById(id) {
  const current = getLocalMemories();
  const updated = current.filter(m => m.id !== id);
  saveLocalMemories(updated);

  try {
    const host = (typeof window !== 'undefined' && window.location.hostname) || 'localhost';
    await fetch(`http://${host}:3001/api/memory/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
  } catch (e) {}

  return updated;
}

// =====================================================================
// Prompt formatter (kept here for the memory dashboard; aiProvider.js
// has its own copy that sorts memories by recency — both are valid).
// =====================================================================
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

// =====================================================================
// Self-evolving memory extractor — FAST REGEX FALLBACK.
// Kept for when no AI provider is configured. Catches the most common
// "I like / I'm working on / my goal is / every day I" patterns so memory
// still evolves with zero setup.
// =====================================================================
export async function autoExtractMemoriesFromChat(userText = '') {
  if (!userText || typeof userText !== 'string' || userText.trim().length < 4) return;
  const lower = userText.toLowerCase().trim();

  const patterns = [
    { regex: /(?:i love|i like|i really enjoy|favorite|my favourite|my favorite)\s+(?:listening to|playing|watching|using)?\s*(.+)/i, category: 'preference', prefix: 'Aarav enjoys' },
    { regex: /(?:i am working on|i'm building|i'm coding|i'm making|my project is)\s+(.+)/i, category: 'project', prefix: 'Aarav is actively working on' },
    { regex: /(?:my goal is|i want to learn|i want to build|i'm trying to)\s+(.+)/i, category: 'goal', prefix: 'Aarav wants to' },
    { regex: /(?:i always|i usually|every day i|i keep|i tend to)\s+(.+)/i, category: 'behavior', prefix: 'Aarav' },
    { regex: /(?:my name is|call me|i'm called)\s+(.+)/i, category: 'identity', prefix: 'Aarav' },
    { regex: /(?:i work at|i study at|i go to)\s+(.+)/i, category: 'identity', prefix: 'Aarav' },
  ];

  for (const p of patterns) {
    const match = lower.match(p.regex);
    if (match && match[1]) {
      const extracted = match[1].replace(/[.!?,]$/, '').trim();
      if (extracted.length > 2 && extracted.length < 120) {
        const memoryText = `${p.prefix} ${extracted}.`;
        console.log(`[Evolving Memory] Auto-learned (regex): "${memoryText}"`);
        await addCategorizedMemory(p.category, memoryText, { source: 'regex' });
        break;
      }
    }
  }
}

// =====================================================================
// AI-driven memory extraction — the v1.2.0 "real" self-evolving path.
// Sends the recent transcript to /api/memory/extract (cheap Gemini call)
// and asks it to pull out durable facts in any phrasing. Called by
// App.jsx every N messages. Throttled to avoid hammering the API.
// =====================================================================
const AI_EXTRACT_COOLDOWN_MS = 15000; // at most one AI extraction per 15s
let _lastAiExtractAt = 0;

export async function extractMemoriesFromTranscript(messages) {
  if (!messages || messages.length === 0) return [];
  const now = Date.now();
  if (now - _lastAiExtractAt < AI_EXTRACT_COOLDOWN_MS) return [];
  _lastAiExtractAt = now;

  try {
    // Import lazily so memoryStore has no hard dependency on aiProvider.
    const { extractMemoriesViaAI } = await import('./aiProvider');
    const extracted = await extractMemoriesViaAI(messages);
    for (const mem of extracted) {
      if (mem && mem.category && mem.text) {
        console.log(`[Evolving Memory] Auto-learned (AI): [${mem.category}] "${mem.text}"`);
        await addCategorizedMemory(mem.category, mem.text, {
          source: 'ai',
          confidence: mem.confidence ?? 0.75,
        });
      }
    }
    return extracted;
  } catch (e) {
    console.warn('[Evolving Memory] AI extraction failed:', e.message);
    return [];
  }
}
