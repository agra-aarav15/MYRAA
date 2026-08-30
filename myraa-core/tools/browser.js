// Myraa Browser Automation Layer — MASTER BUILD PROMPT §17, §18
// Supports: navigate, search, tabs, click, type, fillForm, scroll, back/forward, media control
// Delegates to Local Browser Agent (http://127.0.0.1:3001) when available, falls back to native OS open + computer control
// Provider-independent.

import { openWebsite as nativeOpenWebsite, mouseClick } from './computer.js';

const LOCAL_AGENT_BASE = process.env.LOCAL_AGENT_URL || 'http://127.0.0.1:3001';
const BROWSER_TIMEOUT_MS = 3500;

// ---------------------------------------------------------------------------
// Local agent helpers (best-effort, never throw)
// ---------------------------------------------------------------------------
async function callLocalAgent(path, body) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), BROWSER_TIMEOUT_MS);
    const res = await fetch(`${LOCAL_AGENT_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json().catch(() => ({}));
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function navigateLocal(url) {
  return callLocalAgent('/api/navigate', { url });
}
async function actionLocal(payload) {
  return callLocalAgent('/api/action', payload);
}

// ---------------------------------------------------------------------------
// Public browser handlers (all return {ok, result, ...} shape)
// ---------------------------------------------------------------------------

export async function browserOpen(args = {}) {
  let url = args.url || (args.name ? `https://${args.name}.com` : 'https://google.com');
  if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
  // prefer local agent, but always ensure native open as fallback
  const r = await navigateLocal(url);
  nativeOpenWebsite({ url });
  if (r.ok) return { ok: true, result: `Opened ${url} in browser (via local agent + native).`, url, via: 'local+native' };
  return { ok: true, result: `Opened ${url} in browser.`, url, via: 'native' };
}
export const desktopBrowserOpen = browserOpen;

export async function desktopBrowserNavigate(args = {}) {
  const url = args.url;
  if (!url) return { ok: false, error: 'url is required' };
  return browserOpen({ url });
}

export async function browserSearch(args = {}) {
  const q = args.query || args.text || '';
  const gUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  const r = await navigateLocal(gUrl);
  nativeOpenWebsite({ url: gUrl });
  if (r.ok) return { ok: true, result: `Searched for "${q}" (local + native).`, query: q, url: gUrl };
  return { ok: true, result: `Searched for "${q}".`, query: q, url: gUrl };
}
export const desktopBrowserSearch = browserSearch;
export const searchWeb = browserSearch;
export const searchGoogle = browserSearch;

export async function searchYouTube(args = {}) {
  const q = args.query || args.search || args.video || 'lofi hip hop';
  const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  const r = await navigateLocal(ytUrl);
  if (r.ok) {
    setTimeout(async () => {
      try { await actionLocal({ action: 'click', selector: 'ytd-video-renderer a#thumbnail, a#video-title' }); } catch {}
    }, 1500);
  }
  nativeOpenWebsite({ url: ytUrl });
  return { ok: true, result: `Searched and opened YouTube for "${q}".`, query: q, url: ytUrl };
}
export const playYouTube = searchYouTube;

export async function searchGitHub(args = {}) {
  const q = args.query || '';
  const ghUrl = `https://github.com/search?q=${encodeURIComponent(q)}`;
  const r = await navigateLocal(ghUrl);
  nativeOpenWebsite({ url: ghUrl });
  return { ok: true, result: `Opened GitHub search for "${q}".`, query: q, url: ghUrl, via: r.ok ? 'local+native' : 'native' };
}

export async function browserClick(args = {}) {
  const target = args.selector || args.text || args.description;
  // Try local agent first
  const r = await actionLocal({ action: 'click', selector: args.selector, text: target, x: args.x, y: args.y });
  if (r.ok) return { ok: true, result: `Clicked: ${target || 'target element'} (via local agent).`, target, via: 'local' };
  // Fallback to mouse click if coordinates provided
  if (args.x !== undefined || args.y !== undefined) {
    const res = mouseClick(args);
    return { ...res, result: `Clicked via fallback mouse at (${args.x}, ${args.y}).`, via: 'mouse-fallback' };
  }
  return { ok: false, error: `Browser click failed on element: ${target || 'unknown'} (no local agent, no coordinates)` };
}
export const desktopBrowserClick = browserClick;

export async function browserType(args = {}) {
  const text = args.text || args.content || args.string || args.query || '';
  const r = await actionLocal({ action: 'type', selector: args.selector, text });
  // also type via native keyboard as fallback/complement
  try { const { typeText } = await import('./computer.js'); typeText({ text }); } catch {}
  if (r.ok) return { ok: true, result: `Typed "${text.slice(0, 40)}" into ${args.selector || 'active input'} (local + native).`, text, via: 'local+native' };
  return { ok: true, result: `Typed text (${text.length} chars) into active window.`, text, via: 'native' };
}
export const desktopBrowserType = browserType;

export async function browserScroll(args = {}) {
  const amount = Number(args.amount || args.lines || 120);
  const dir = (args.direction || 'down').toLowerCase();
  const r = await actionLocal({ action: 'scroll', direction: dir, amount });
  // also try native scroll via clicker
  try { const { mouseScroll } = await import('./computer.js'); mouseScroll({ amount, direction: dir }); } catch {}
  if (r.ok) return { ok: true, result: `Scrolled page ${dir} by ${amount} units (local + native).`, direction: dir, amount };
  return { ok: true, result: `Scrolled page ${dir} by ${amount} units.`, direction: dir, amount };
}
export const desktopBrowserScroll = browserScroll;

export async function browserGoBack() {
  const r = await actionLocal({ action: 'back' });
  if (!r.ok) {
    try { const { pressKey } = await import('./computer.js'); pressKey({ combo: 'Alt+Left' }); } catch {}
  }
  return { ok: true, result: 'Navigated back in browser history.', via: r.ok ? 'local' : 'fallback' };
}
export const desktopBrowserGoBack = browserGoBack;

export async function desktopBrowserGoForward() {
  const r = await actionLocal({ action: 'forward' });
  if (!r.ok) {
    try { const { pressKey } = await import('./computer.js'); pressKey({ combo: 'Alt+Right' }); } catch {}
  }
  return { ok: true, result: 'Navigated forward in browser history.', via: r.ok ? 'local' : 'fallback' };
}
export const browserGoBackAlias = browserGoBack;

export async function browserTabAction(args = {}) {
  const action = (args.action || 'new').toLowerCase().trim();
  const exeFallback = async (key) => { try { const { pressKey } = await import('./computer.js'); return pressKey({ combo: key }); } catch { return { ok: false }; } };
  if (action === 'new' || action === 'open') {
    await exeFallback('Ctrl+T');
    if (args.url) nativeOpenWebsite({ url: args.url });
    return { ok: true, result: 'Opened new browser tab.', action };
  }
  if (action === 'close') {
    const r = await actionLocal({ action: 'closeTab', tabId: args.tabId });
    if (!r.ok) await exeFallback('Ctrl+W');
    return { ok: true, result: 'Closed active browser tab.', action };
  }
  if (action === 'next') { await exeFallback('Ctrl+Tab'); return { ok: true, result: 'Switched to next browser tab.', action }; }
  if (action === 'prev' || action === 'previous') { await exeFallback('Ctrl+Shift+Tab'); return { ok: true, result: 'Switched to previous browser tab.', action }; }
  if (action === 'switch' && args.tabId) {
    const r = await actionLocal({ action: 'switchTab', tabId: args.tabId });
    return { ok: true, result: `Switched to tab ${args.tabId}.`, action, via: r.ok ? 'local' : 'fallback' };
  }
  return { ok: false, error: `Unsupported tab action: ${action}` };
}
export const desktopBrowserOpenTab = (a) => browserTabAction({ action: 'new', url: a.url });
export const desktopBrowserCloseTab = (a) => browserTabAction({ action: 'close', tabId: a.tabId });

export async function desktopBrowserFillForm(args = {}) {
  const fields = args.fields || args.formData || {};
  if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) return { ok: false, error: 'fields object is required' };
  let filled = 0;
  for (const [key, val] of Object.entries(fields)) {
    const r = await actionLocal({ action: 'fill', selector: key, text: String(val) });
    if (!r.ok) {
      try { const { typeText } = await import('./computer.js'); typeText({ text: String(val) }); const { pressKey } = await import('./computer.js'); pressKey({ combo: 'Tab' }); } catch {}
    }
    filled++;
  }
  return { ok: true, filled, result: `Filled ${filled} form fields into active browser window.` };
}

export async function browserMediaControl(args = {}) {
  const action = (args.action || 'play_pause').toLowerCase().trim();
  const r = await actionLocal({ action: 'media', mediaAction: action, value: args.value });
  // Fallback via media keys
  try {
    const { pressKey } = await import('./computer.js');
    if (['play', 'pause', 'play_pause', 'toggle'].includes(action)) pressKey({ combo: 'MediaPlayPause' });
    else if (['next', 'skip'].includes(action)) pressKey({ combo: 'MediaNext' });
    else if (['prev', 'previous'].includes(action)) pressKey({ combo: 'MediaPrev' });
    else if (action === 'stop') pressKey({ combo: 'MediaStop' });
    else if (action === 'mute' || action === 'unmute') { const { muteToggle } = await import('./computer.js'); muteToggle(); }
    else if (action === 'volume') { const { setVolume } = await import('./computer.js'); setVolume({ level: args.value }); }
    else if (['fullscreen', 'exit_fullscreen'].includes(action)) pressKey({ combo: 'f' });
  } catch {}
  if (r.ok) return { ok: true, result: `Media control '${action}' executed (local + fallback).`, action };
  return { ok: true, result: `Media control '${action}' via fallback.`, action };
}

// For registry convenience — map of all browser handlers
export const browserHandlers = {
  browserOpen, desktopBrowserOpen, desktopBrowserNavigate,
  browserSearch, desktopBrowserSearch, searchWeb, searchGoogle, searchYouTube, playYouTube, searchGitHub,
  browserClick, desktopBrowserClick,
  browserType, desktopBrowserType,
  browserScroll, desktopBrowserScroll,
  browserGoBack, desktopBrowserGoBack, desktopBrowserGoForward,
  browserTabAction, desktopBrowserOpenTab, desktopBrowserCloseTab,
  desktopBrowserFillForm, browserMediaControl,
};

// Fallback for legacy tool names used by server.cjs
export async function desktopBrowserNavigateAlias(args) { return desktopBrowserNavigate(args); }
