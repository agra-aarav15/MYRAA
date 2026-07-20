// =====================================================================
// MYRAA Desktop & Browser Command Engine
// Automatically parses and executes user commands ("open youtube", etc.)
// =====================================================================

/**
 * Checks if text contains a command to execute a desktop app or website.
 * If found, executes via backend `/api/tools/execute` AND `window.open` for web URLs.
 * @param {string} text - User prompt or AI response
 * @returns {Promise<boolean>} True if a command was matched and executed
 */
export async function executeDirectCommand(text = '') {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase().trim();

  let toolName = null;
  let args = {};
  let popupUrl = null;

  // Web shortcuts
  if (/open(ing)?\s+(the\s+)?youtube/i.test(lower) || lower === 'youtube') {
    toolName = 'openWebsite';
    args = { name: 'youtube' };
    popupUrl = 'https://www.youtube.com';
  } else if (/open(ing)?\s+(the\s+)?google/i.test(lower) || lower === 'google') {
    toolName = 'openWebsite';
    args = { name: 'google' };
    popupUrl = 'https://www.google.com';
  } else if (/open(ing)?\s+(the\s+)?github/i.test(lower) || lower === 'github') {
    toolName = 'openWebsite';
    args = { name: 'github' };
    popupUrl = 'https://github.com';
  } else if (/open(ing)?\s+(the\s+)?chat\s*gpt/i.test(lower)) {
    toolName = 'openWebsite';
    args = { name: 'chatgpt' };
    popupUrl = 'https://chat.openai.com';
  } else if (/open(ing)?\s+(the\s+)?(twitter|x\.com)/i.test(lower)) {
    toolName = 'openWebsite';
    args = { name: 'twitter' };
    popupUrl = 'https://x.com';
  }
  // Search shortcuts
  else if (/search\s+youtube\s+for|play\s+.+\s+on\s+youtube/i.test(lower)) {
    const q = lower.replace(/search youtube for |play | on youtube/gi, '').trim();
    toolName = 'searchYouTube';
    args = { query: q };
    popupUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  } else if (/search\s+(google\s+for|for)\s+/i.test(lower)) {
    const q = lower.replace(/search google for |search for /gi, '').trim();
    toolName = 'searchGoogle';
    args = { query: q };
    popupUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  }
  // App shortcuts
  else if (/open(ing)?\s+(the\s+)?notepad/i.test(lower)) {
    toolName = 'openApplication';
    args = { name: 'notepad' };
  } else if (/open(ing)?\s+(the\s+)?calc(ulator)?/i.test(lower)) {
    toolName = 'openApplication';
    args = { name: 'calculator' };
  } else if (/open(ing)?\s+(the\s+)?chrome/i.test(lower)) {
    toolName = 'openApplication';
    args = { name: 'chrome' };
  } else if (/open(ing)?\s+(the\s+)?(vs\s*code|code)/i.test(lower)) {
    toolName = 'openApplication';
    args = { name: 'vscode' };
  }
  // Volume controls
  else if (/volume\s+up|increase\s+volume/i.test(lower)) {
    toolName = 'volumeUp';
  } else if (/volume\s+down|decrease\s+volume/i.test(lower)) {
    toolName = 'volumeDown';
  } else if (/^(mute|unmute)$/i.test(lower) || /toggle\s+mute/i.test(lower)) {
    toolName = 'muteToggle';
  }

  if (toolName) {
    console.log(`[Command Engine] Matched command "${toolName}" with args:`, args);

    // 1. Try backend desktop automation execution
    try {
      await fetch('/api/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName, args })
      });
    } catch (e) {
      console.warn('[Command Engine] Backend execution fallback:', e);
    }

    // 2. If it's a website/search, also open directly in browser window to ensure instant execution
    if (popupUrl) {
      try {
        window.open(popupUrl, '_blank');
      } catch (e) {
        console.warn('[Command Engine] window.open blocked or failed:', e);
      }
    }

    return true;
  }

  return false;
}
