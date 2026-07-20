// =====================================================================
// MYRAA Desktop & Browser Command Engine
// Automatically parses and executes user commands ("open youtube and play starboy", etc.)
// =====================================================================

/**
 * Executes a single command object via backend API and browser window.open.
 * @param {string} toolName 
 * @param {Object} args 
 * @param {string|null} popupUrl 
 * @returns {Promise<boolean>}
 */
async function runSingleCommand(toolName, args = {}, popupUrl = null) {
  if (!toolName) return false;
  console.log(`[Command Engine] Executing command "${toolName}" with args:`, args);

  // 1. Try backend desktop automation execution
  try {
    const host = (typeof window !== 'undefined' && window.location.hostname) ? window.location.hostname : 'localhost';
    await fetch(`http://${host}:3001/api/tools/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolName, args })
    });
  } catch (e) {
    console.warn('[Command Engine] Backend execution fallback:', e);
  }

  // 2. Open directly in browser window to ensure instant execution
  if (popupUrl) {
    try {
      window.open(popupUrl, '_blank');
    } catch (e) {
      console.warn('[Command Engine] window.open blocked or failed:', e);
    }
  }

  return true;
}

/**
 * Checks if text contains one or multiple commands to execute desktop apps or websites.
 * Supports compound commands ("open youtube and also play starboy", "open google and search react", etc.)
 * @param {string} text - User prompt or AI response
 * @returns {Promise<boolean>} True if any command was matched and executed
 */
export async function executeDirectCommand(text = '') {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase().trim();

  let executedAny = false;

  // 1. Special Compound Intent: "open youtube and (also )?play [song/query]"
  const playYoutubeMatch = lower.match(/(?:open|opening)?\s*(?:the\s*)?youtube\s*(?:and|and also|then)?\s*(?:also)?\s*(?:play|search for|search)?\s*(.+)/i);
  if (playYoutubeMatch && (lower.includes('play ') || lower.includes('search ') || lower.includes('starboy'))) {
    let query = playYoutubeMatch[1].replace(/^(open|youtube|and|also|play|search for|search|\s)+/gi, '').trim();
    if (!query) query = 'starboy';
    const popupUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    await runSingleCommand('searchYouTube', { query }, popupUrl);
    return true;
  }

  // 2. Clause splitting for multi-intent commands
  const clauses = lower.split(/ and also | and | then |, /i);

  for (const clause of clauses) {
    const c = clause.trim();
    if (!c) continue;

    let toolName = null;
    let args = {};
    let popupUrl = null;

    if (/open(ing)?\s+(the\s+)?youtube/i.test(c) || c === 'youtube') {
      toolName = 'openWebsite';
      args = { name: 'youtube' };
      popupUrl = 'https://www.youtube.com';
    } else if (/open(ing)?\s+(the\s+)?google/i.test(c) || c === 'google') {
      toolName = 'openWebsite';
      args = { name: 'google' };
      popupUrl = 'https://www.google.com';
    } else if (/open(ing)?\s+(the\s+)?github/i.test(c) || c === 'github') {
      toolName = 'openWebsite';
      args = { name: 'github' };
      popupUrl = 'https://github.com';
    } else if (/open(ing)?\s+(the\s+)?chat\s*gpt/i.test(c)) {
      toolName = 'openWebsite';
      args = { name: 'chatgpt' };
      popupUrl = 'https://chat.openai.com';
    } else if (/open(ing)?\s+(the\s+)?(twitter|x\.com)/i.test(c)) {
      toolName = 'openWebsite';
      args = { name: 'twitter' };
      popupUrl = 'https://x.com';
    } else if (/search\s+youtube\s+for|play\s+.+/i.test(c)) {
      const q = c.replace(/search youtube for |play | on youtube|search /gi, '').trim();
      if (q) {
        toolName = 'searchYouTube';
        args = { query: q };
        popupUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
      }
    } else if (/search\s+(google\s+for|for)\s+/i.test(c)) {
      const q = c.replace(/search google for |search for /gi, '').trim();
      if (q) {
        toolName = 'searchGoogle';
        args = { query: q };
        popupUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
      }
    } else if (/open(ing)?\s+(the\s+)?notepad/i.test(c)) {
      toolName = 'openApplication';
      args = { name: 'notepad' };
    } else if (/open(ing)?\s+(the\s+)?calc(ulator)?/i.test(c)) {
      toolName = 'openApplication';
      args = { name: 'calculator' };
    } else if (/open(ing)?\s+(the\s+)?chrome/i.test(c)) {
      toolName = 'openApplication';
      args = { name: 'chrome' };
    } else if (/open(ing)?\s+(the\s+)?(vs\s*code|code)/i.test(c)) {
      toolName = 'openApplication';
      args = { name: 'vscode' };
    } else if (/volume\s+up|increase\s+volume/i.test(c)) {
      toolName = 'volumeUp';
    } else if (/volume\s+down|decrease\s+volume/i.test(c)) {
      toolName = 'volumeDown';
    } else if (/^(mute|unmute)$/i.test(c) || /toggle\s+mute/i.test(c)) {
      toolName = 'muteToggle';
    }

    if (toolName) {
      const ok = await runSingleCommand(toolName, args, popupUrl);
      if (ok) executedAny = true;
    }
  }

  return executedAny;
}
