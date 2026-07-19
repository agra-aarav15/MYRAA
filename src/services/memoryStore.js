// Persistent Companion Memory Store for MYRAA

const MEMORY_STORAGE_KEY = 'MYRAA_COMPANION_MEMORY';

const DEFAULT_MEMORY = {
  userName: 'Darling',
  userFacts: [
    'Enjoys programming and building cool software projects',
    'Prefers a warm, caring, intelligent AI companion',
    'Likes clean, dark aesthetic interfaces'
  ],
  conversationNotes: [],
  lastInteraction: new Date().toISOString()
};

export function getCompanionMemory() {
  try {
    const saved = localStorage.getItem(MEMORY_STORAGE_KEY);
    return saved ? { ...DEFAULT_MEMORY, ...JSON.parse(saved) } : DEFAULT_MEMORY;
  } catch (e) {
    return DEFAULT_MEMORY;
  }
}

export function saveCompanionMemory(memoryData) {
  try {
    const updated = { ...getCompanionMemory(), ...memoryData, lastInteraction: new Date().toISOString() };
    localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(updated));

    // Async sync with local backend server disk storage
    const host = (typeof window !== 'undefined' && window.location.hostname) ? window.location.hostname : 'localhost';
    fetch(`http://${host}:3001/api/memory/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated)
    }).catch(() => {});

    return updated;
  } catch (e) {
    console.warn('Memory save notice:', e);
  }
}

export function addFactToMemory(newFact) {
  if (!newFact || !newFact.trim()) return;
  const memory = getCompanionMemory();
  const trimmed = newFact.trim();
  if (!memory.userFacts.includes(trimmed)) {
    memory.userFacts.push(trimmed);
    saveCompanionMemory(memory);
  }
}

export function formatMemoryForPrompt() {
  const memory = getCompanionMemory();
  let text = `[MYRAA PERSONAL COMPANION MEMORY]\n`;
  text += `- User's Name / Preferred Callname: ${memory.userName}\n`;
  text += `- Key Personal Facts & Memory:\n`;
  memory.userFacts.forEach(fact => {
    text += `  * ${fact}\n`;
  });
  if (memory.conversationNotes.length > 0) {
    text += `- Recent Important Context:\n`;
    memory.conversationNotes.slice(-5).forEach(note => {
      text += `  * ${note}\n`;
    });
  }
  return text;
}
