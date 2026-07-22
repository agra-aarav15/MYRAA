// =====================================================================
// MYRAA Desktop & Browser Command Engine — v1.2.0
// Automatically parses and executes user commands ("open youtube and play
// starboy", etc.). Now returns result messages so MYRAA can confirm what
// she did in chat.
// =====================================================================

/**
 * Executes a single command object via backend API and browser window.open.
 * Returns a result object with humanMessage that MYRAA can speak back.
 * @param {string} toolName 
 * @param {Object} args 
 * @param {string|null} popupUrl 
 * @returns {Promise<{success: boolean, humanMessage?: string, action?: string}>}
 */
async function runSingleCommand(toolName, args = {}, popupUrl = null) {
  if (!toolName) return { success: false };
  console.log(`[Command Engine] Executing command "${toolName}" with args:`, args);

  // 1. Try backend desktop automation execution
  let backendResult = { success: false };
  try {
    const host = (typeof window !== 'undefined' && window.location.hostname) ? window.location.hostname : 'localhost';
    const res = await fetch(`http://${host}:3001/api/tools/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolName, args })
    });
    if (res.ok) {
      backendResult = await res.json();
    }
  } catch (e) {
    console.warn('[Command Engine] Backend execution fallback:', e);
  }

  // 2. Open directly in browser window to ensure instant execution
  if (popupUrl) {
    try {
      window.open(popupUrl, '_blank');
      return {
        success: true,
        humanMessage: backendResult?.result?.message || `Opening ${args?.name || toolName}...`,
        action: toolName
      };
    } catch (e) {
      console.warn('[Command Engine] window.open blocked or failed:', e);
    }
  }

  // 3. Backend result
  if (backendResult?.result?.success) {
    const msg = backendResult.result.message
      || backendResult.result.humanMessage
      || `Done! ${toolName} executed successfully.`;
    return { success: true, humanMessage: msg, action: toolName };
  }

  // 4. Website commands that just opened a window
  if (popupUrl) {
    return { success: true, humanMessage: `Opening that now...`, action: toolName };
  }

  return { success: false };
}

/**
 * Checks if text contains one or multiple commands to execute desktop apps or websites.
 * Supports compound commands ("open youtube and also play starboy", "open google and search react", etc.)
 * Returns an array of result objects {success, humanMessage} that the caller can inject into chat,
 * or empty array if nothing was matched.
 * @param {string} text - User prompt or AI response
 * @returns {Promise<Array<{success: boolean, humanMessage?: string}>>}
 */
export async function executeDirectCommand(text = '') {
  if (!text || typeof text !== 'string') return [];
  const lower = text.toLowerCase().trim();

  let results = [];
  let executedAny = false;

  // 1. Special Compound Intent: "open youtube and (also )?play [song/query]"
  const playYoutubeMatch = lower.match(/(?:open|opening)?\s*(?:the\s*)?youtube\s*(?:and|and also|then)?\s*(?:also)?\s*(?:play|search for|search)?\s*(.+)/i);
  if (playYoutubeMatch && (lower.includes('play ') || lower.includes('search ') || lower.includes('starboy'))) {
    let query = playYoutubeMatch[1].replace(/^(open|youtube|and|also|play|search for|search|\s)+/gi, '').trim();
    if (!query) query = 'starboy';
    const popupUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const r = await runSingleCommand('searchYouTube', { query }, popupUrl);
    results.push(r);
    return r.success ? r.humanMessage ? results : [] : [];
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
    } else if (/search\s+(web|the web|the internet|internet)\s+for\s+(.+)/i.test(c)) {
      // Full web search via the Layer A endpoint — returns real results as chat text.
      const q = c.replace(/search\s+(web|the web|the internet|internet)\s+for\s+/i, '').trim();
      if (q) {
        try {
          const host = (typeof window !== 'undefined' && window.location.hostname) || 'localhost';
          const res = await fetch(`http://${host}:3001/api/web/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: q, count: 5 })
          });
          if (res.ok) {
            const data = await res.json();
            if (data.results && data.results.length > 0) {
              const lines = data.results.map((r, i) => `${i+1}. ${r.title}: ${r.url}`);
              results.push({
                success: true,
                humanMessage: `🌐 Searched for "${q}":\n${lines.slice(0, 5).join('\n')}`
              });
            } else {
              results.push({ success: true, humanMessage: `I searched for "${q}" but didn't find any results.` });
            }
          }
        } catch (e) {
          results.push({ success: true, humanMessage: `Web search is currently unavailable.` });
        }
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
      const r = await runSingleCommand(toolName, args, popupUrl);
      if (r.success) executedAny = true;
      if (r.humanMessage) results.push(r);
    }
  }

  return results;
}
