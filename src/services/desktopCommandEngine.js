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
  if (lower.includes('open youtube') || lower === 'youtube') {
    toolName = 'openWebsite';
    args = { name: 'youtube' };
    popupUrl = 'https://www.youtube.com';
  } else if (lower.includes('open google') || lower === 'google') {
    toolName = 'openWebsite';
    args = { name: 'google' };
    popupUrl = 'https://www.google.com';
  } else if (lower.includes('open github') || lower === 'github') {
    toolName = 'openWebsite';
    args = { name: 'github' };
    popupUrl = 'https://github.com';
  } else if (lower.includes('open chatgpt') || lower.includes('open chat gpt')) {
    toolName = 'openWebsite';
    args = { name: 'chatgpt' };
    popupUrl = 'https://chat.openai.com';
  } else if (lower.includes('open twitter') || lower.includes('open x.com')) {
    toolName = 'openWebsite';
    args = { name: 'twitter' };
    popupUrl = 'https://x.com';
  }
  // Search shortcuts
  else if (lower.startsWith('search youtube for ') || lower.includes('on youtube')) {
    const q = lower.replace(/search youtube for |play | on youtube/gi, '').trim();
    toolName = 'searchYouTube';
    args = { query: q };
    popupUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  } else if (lower.startsWith('search google for ') || lower.startsWith('search for ')) {
    const q = lower.replace(/search google for |search for /gi, '').trim();
    toolName = 'searchGoogle';
    args = { query: q };
    popupUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  }
  // App shortcuts
  else if (lower.includes('open notepad')) {
    toolName = 'openApplication';
    args = { name: 'notepad' };
  } else if (lower.includes('open calculator') || lower.includes('open calc')) {
    toolName = 'openApplication';
    args = { name: 'calculator' };
  } else if (lower.includes('open chrome')) {
    toolName = 'openApplication';
    args = { name: 'chrome' };
  } else if (lower.includes('open vscode') || lower.includes('open code')) {
    toolName = 'openApplication';
    args = { name: 'vscode' };
  }
  // Volume controls
  else if (lower.includes('volume up') || lower.includes('increase volume')) {
    toolName = 'volumeUp';
  } else if (lower.includes('volume down') || lower.includes('decrease volume')) {
    toolName = 'volumeDown';
  } else if (lower === 'mute' || lower === 'unmute' || lower.includes('toggle mute')) {
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
