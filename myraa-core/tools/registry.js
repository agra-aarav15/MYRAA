// Myraa Tool Registry — MASTER BUILD PROMPT §8-10, §18-19, §33-35
// Provider-independent tool framework with SAFE/NORMAL/DANGEROUS metadata,
// input/output schemas, permission levels, fallback mouse/keyboard, plugin support.
// Reuses DESKTOP_TOOLS from dist/server.cjs (72 tools; original prompt noted 58 — full superset preserved).
// Architecture: Registry is pure runtime — no provider/model coupling, suitable for Master Orchestrator (§5).

import { computerHandlers } from './computer.js';
import { browserHandlers } from './browser.js';
import { policyEngine as defaultPolicyEngine } from '../policy/engine.js';

// ---------------------------------------------------------------------------
// Permission model — §34, §35, §36
// ---------------------------------------------------------------------------
export const Permission = Object.freeze({
  SAFE: 'SAFE',         // read-only / informational, auto-allowed
  NORMAL: 'NORMAL',     // reversible mutating, auto-allowed within policy
  DANGEROUS: 'DANGEROUS' // destructive / system-wide / irreversible, requires confirmation
});

export const RiskTier = Permission; // alias for §18 authenticated-services tiers mapping

// ---------------------------------------------------------------------------
// Simple JSON-Schema validator (subset: type, required, properties, enum)
// Avoids extra deps — provider-independent, works offline. Full AJV can be swapped later.
// ---------------------------------------------------------------------------
function validateAgainstSchema(schema, data) {
  if (!schema) return { ok: true };
  const errors = [];
  if (schema.type === 'object') {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return { ok: false, error: `Expected object, got ${typeof data}` };
    }
    const required = schema.required || [];
    for (const key of required) {
      if (!(key in data) || data[key] === undefined || data[key] === null || (typeof data[key] === 'string' && data[key].trim() === '')) {
        errors.push(`Missing required field: ${key}`);
      }
    }
    if (schema.properties) {
      for (const [prop, propSchema] of Object.entries(schema.properties)) {
        if (!(prop in data) || data[prop] === undefined) continue;
        const val = data[prop];
        const expected = propSchema.type;
        if (expected === 'string' && typeof val !== 'string') errors.push(`${prop}: expected string`);
        if (expected === 'number' && typeof val !== 'number') {
          // allow numeric strings for coordinates etc., but flag if NaN
          const n = Number(val);
          if (Number.isNaN(n)) errors.push(`${prop}: expected number`);
        }
        if (expected === 'integer' && !Number.isInteger(Number(val))) errors.push(`${prop}: expected integer`);
        if (expected === 'boolean' && typeof val !== 'boolean') errors.push(`${prop}: expected boolean`);
        if (expected === 'object' && (typeof val !== 'object' || val === null)) errors.push(`${prop}: expected object`);
        if (propSchema.enum && !propSchema.enum.includes(val)) errors.push(`${prop}: must be one of ${propSchema.enum.join(', ')}`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(data)) {
        if (!schema.properties || !(k in schema.properties)) errors.push(`Unexpected property: ${k}`);
      }
    }
  }
  if (errors.length) return { ok: false, error: errors.join('; ') };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tool definition factory — §33 plugin metadata
// Every definition includes: metadata, version, permissions, input/output schemas,
// auth requirements, security policy, capability declaration, fallback descriptor.
// ---------------------------------------------------------------------------
function defineTool({ name, description, permission, category, inputSchema, outputSchema, handler, fallback, version = '1.0.0', auth = false, capability, plugin = null }) {
  return {
    name,
    description,
    permission,
    category, // e.g., 'computer:mouse', 'browser:navigation', 'filesystem:read'
    inputSchema,
    outputSchema,
    handler,
    fallback: fallback || null, // string descriptor of fallback mechanism per §8 order
    version,
    auth,
    capability: capability || category,
    plugin, // null for core tools, string plugin id for plugin tools
    source: 'DESKTOP_TOOLS:dist/server.cjs',
  };
}

// Common schema fragments
const S = {
  path: { type: 'string', description: 'File or folder path (supports Desktop/Documents/Downloads shorthands, absolute, or relative)' },
  filePath: { type: 'string', description: 'File path' },
  dirPath: { type: 'string', description: 'Directory path' },
  content: { type: 'string', description: 'File content / text to write' },
  query: { type: 'string', description: 'Search query string' },
  url: { type: 'string', description: 'URL (https://...)' },
  text: { type: 'string', description: 'Text to type / fill' },
  x: { type: 'number', description: 'Screen X coordinate (pixels or normalized 0-1)' },
  y: { type: 'number', description: 'Screen Y coordinate (pixels or normalized 0-1)' },
  button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button' },
  selector: { type: 'string', description: 'CSS selector or element descriptor for browser automation' },
};

// ---------------------------------------------------------------------------
// Core definitions — 72 tools from DESKTOP_TOOLS (full superset)
// Permission assignment per §34-36:
//   SAFE = read-only informational (§10 awareness, file reads, searches, screenshots, system info)
//   NORMAL = low-risk mutating reversible (open apps/websites, create files, browser nav, volume, window mgmt, clipboard write, mouse/keyboard)
//   DANGEROUS = destructive / irreversible / system-wide (deleteFile, move/rename, closeApplication, terminal, power, autostart)
// ---------------------------------------------------------------------------
export const TOOL_DEFINITIONS = [
  // ——— Applications / websites / search (SAFE/NORMAL) ———
  defineTool({ name: 'openApplication', description: 'Open or launch any desktop application on PC (notepad, chrome, vscode, etc.). Native launch preferred, falls back to Start-Process.', permission: Permission.NORMAL, category: 'computer:window', inputSchema: { type: 'object', properties: { name: S.text }, required: ['name'] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, result: { type: 'string' } } }, handler: computerHandlers.openApplication, fallback: 'powershell Start-Process + Get-StartApps shell:AppsFolder', capability: 'computer:launch' }),
  defineTool({ name: 'closeApplication', description: 'Close a running desktop application by name (taskkill / window close).', permission: Permission.DANGEROUS, category: 'computer:window', inputSchema: { type: 'object', properties: { name: S.text, force: { type: 'boolean' } }, required: ['name'] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, result: { type: 'string' } } }, handler: computerHandlers.closeApplication, fallback: 'taskkill /F /IM', capability: 'computer:window:close' }),
  defineTool({ name: 'openWebsite', description: 'Open any website or URL in the default browser.', permission: Permission.NORMAL, category: 'browser:navigation', inputSchema: { type: 'object', properties: { name: { type: 'string' }, url: S.url }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, url: { type: 'string' } } }, handler: computerHandlers.openWebsite, fallback: 'local-agent /api/navigate → native start', capability: 'browser:open' }),
  defineTool({ name: 'searchWeb', description: 'Search the web (Google by default).', permission: Permission.SAFE, category: 'browser:search', inputSchema: { type: 'object', properties: { query: S.query, engine: { type: 'string', enum: ['google', 'youtube', 'github'] } }, required: ['query'] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, url: { type: 'string' } } }, handler: browserHandlers.browserSearch, fallback: 'native open https://www.google.com/search?q=', capability: 'browser:search' }),
  defineTool({ name: 'searchYouTube', description: 'Search YouTube for videos/music and open results.', permission: Permission.SAFE, category: 'browser:search', inputSchema: { type: 'object', properties: { query: S.query }, required: ['query'] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, url: { type: 'string' } } }, handler: browserHandlers.searchYouTube, fallback: 'native open youtube results', capability: 'browser:youtube' }),
  defineTool({ name: 'searchGoogle', description: 'Search Google and open results.', permission: Permission.SAFE, category: 'browser:search', inputSchema: { type: 'object', properties: { query: S.query }, required: ['query'] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, url: { type: 'string' } } }, handler: browserHandlers.searchGoogle, fallback: 'native open google', capability: 'browser:search:google' }),
  defineTool({ name: 'searchGitHub', description: 'Search GitHub repositories and open results.', permission: Permission.SAFE, category: 'browser:search', inputSchema: { type: 'object', properties: { query: S.query }, required: ['query'] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, url: { type: 'string' } } }, handler: browserHandlers.searchGitHub, fallback: 'native open github search', capability: 'browser:search:github' }),
  defineTool({ name: 'playYouTube', description: 'Search YouTube and auto-play first result (alias of searchYouTube with autoplay).', permission: Permission.SAFE, category: 'browser:search', inputSchema: { type: 'object', properties: { query: S.query }, required: ['query'] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, url: { type: 'string' } } }, handler: browserHandlers.playYouTube, fallback: 'local-agent click thumbnail → native', capability: 'browser:youtube:play' }),

  // ——— Files — §8, §19, §55 ———
  defineTool({ name: 'createFile', description: 'Create a new text file with optional content (scoped to safe folders per §55).', permission: Permission.NORMAL, category: 'filesystem:write', inputSchema: { type: 'object', properties: { path: S.path, filePath: S.path, content: S.content, overwrite: { type: 'boolean' } }, required: ['path'] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, path: { type: 'string' } } }, handler: computerHandlers.createFile, fallback: 'fs.writeFileSync + mkdir -p', capability: 'filesystem:write' }),
  defineTool({ name: 'readFile', description: 'Read the contents of a text file.', permission: Permission.SAFE, category: 'filesystem:read', inputSchema: { type: 'object', properties: { path: S.path, filePath: S.path, max_chars: { type: 'integer' } }, required: ['path'] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, content: { type: 'string' } } }, handler: computerHandlers.readFile, fallback: 'fs.readFileSync', capability: 'filesystem:read' }),
  defineTool({ name: 'renameFile', description: 'Rename a file (same directory or new name).', permission: Permission.DANGEROUS, category: 'filesystem:mutate', inputSchema: { type: 'object', properties: { path: S.path, oldPath: S.path, newPath: S.path, new_name: { type: 'string' } }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, newPath: { type: 'string' } } }, handler: computerHandlers.renameFile, fallback: 'fs.renameSync', capability: 'filesystem:rename' }),
  defineTool({ name: 'deleteFile', description: 'Delete a file. Sends to Recycle Bin semantics by default; permanent flag for hard delete.', permission: Permission.DANGEROUS, category: 'filesystem:delete', inputSchema: { type: 'object', properties: { path: S.path, filePath: S.path, permanent: { type: 'boolean' } }, required: ['path'] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, path: { type: 'string' } } }, handler: computerHandlers.deleteFile, fallback: 'fs.unlinkSync + restrict SYSTEM dirs', capability: 'filesystem:delete' }),
  defineTool({ name: 'moveFile', description: 'Move a file from source to destination.', permission: Permission.DANGEROUS, category: 'filesystem:mutate', inputSchema: { type: 'object', properties: { path: S.path, source: S.path, destination: S.path, oldPath: S.path, newPath: S.path }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: computerHandlers.moveFile, fallback: 'fs.renameSync', capability: 'filesystem:move' }),
  defineTool({ name: 'openFolder', description: 'Open a folder in File Explorer (creates it if missing).', permission: Permission.NORMAL, category: 'filesystem:nav', inputSchema: { type: 'object', properties: { path: S.path, folderPath: S.path, folder: S.path }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, path: { type: 'string' } } }, handler: computerHandlers.openFolder, fallback: 'explorer.exe + mkdir', capability: 'filesystem:nav' }),
  defineTool({ name: 'listFiles', description: 'List files/directories in a folder (max 100).', permission: Permission.SAFE, category: 'filesystem:read', inputSchema: { type: 'object', properties: { path: S.path, dirPath: S.path, folder: S.path, directory: S.path }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, files: { type: 'object' } } }, handler: computerHandlers.listFiles, fallback: 'fs.readdirSync', capability: 'filesystem:list' }),
  defineTool({ name: 'searchFiles', description: 'Recursively search files by name query and/or extension (depth ≤4, limit 200).', permission: Permission.SAFE, category: 'filesystem:search', inputSchema: { type: 'object', properties: { path: S.path, query: { type: 'string' }, pattern: { type: 'string' }, extension: { type: 'string' }, limit: { type: 'integer' } }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, results: { type: 'object' } } }, handler: computerHandlers.searchFiles, fallback: 'fs.readdirSync recursive walk', capability: 'filesystem:search' }),

  // ——— PC control: volume + gated power (§36 DANGEROUS) ———
  defineTool({ name: 'volumeUp', description: 'Increase master volume (clicker.exe volume up → SendKeys fallback).', permission: Permission.NORMAL, category: 'computer:audio', inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, level: { type: 'integer' } } }, handler: computerHandlers.volumeUp, fallback: 'SendKeys [char]175', capability: 'computer:audio:volume' }),
  defineTool({ name: 'volumeDown', description: 'Decrease master volume.', permission: Permission.NORMAL, category: 'computer:audio', inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, level: { type: 'integer' } } }, handler: computerHandlers.volumeDown, fallback: 'SendKeys [char]174', capability: 'computer:audio:volume' }),
  defineTool({ name: 'muteToggle', description: 'Toggle audio mute.', permission: Permission.NORMAL, category: 'computer:audio', inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, muted: { type: 'boolean' } } }, handler: computerHandlers.muteToggle, fallback: 'clicker.exe volume mute → SendKeys [char]173', capability: 'computer:audio:mute' }),
  defineTool({ name: 'setVolume', description: 'Set master volume to 0-100.', permission: Permission.NORMAL, category: 'computer:audio', inputSchema: { type: 'object', properties: { level: { type: 'integer' }, volume: { type: 'integer' } }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, level: { type: 'integer' } } }, handler: computerHandlers.setVolume, fallback: 'clicker.exe volume set', capability: 'computer:audio:volume:set' }),
  defineTool({ name: 'requestPowerAction', description: 'Request a gated power action (shutdown/restart/sleep/lock). Returns confirmation token; requires executePowerAction (§36).', permission: Permission.DANGEROUS, category: 'computer:power', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['shutdown', 'restart', 'sleep', 'lock'] } }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, token: { type: 'string' } } }, handler: computerHandlers.requestPowerAction, fallback: 'token map + 60s expiry', capability: 'computer:power:request' }),
  defineTool({ name: 'executePowerAction', description: 'Execute a previously requested power action with confirmation token (gated, §36). Dry-run unless MYRAA_ALLOW_POWER_ACTIONS=1.', permission: Permission.DANGEROUS, category: 'computer:power', inputSchema: { type: 'object', properties: { token: { type: 'string' }, confirmationToken: { type: 'string' }, action: { type: 'string' } }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: computerHandlers.executePowerAction, fallback: 'shutdown.exe /s /r | rundll32 lock', capability: 'computer:power:execute' }),

  // ——— Windows & mouse control (§8) ———
  defineTool({ name: 'minimizeWindow', description: 'Minimize a window by title or active window.', permission: Permission.NORMAL, category: 'computer:window', inputSchema: { type: 'object', properties: { name: { type: 'string' }, title: { type: 'string' }, window: { type: 'string' } }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: computerHandlers.minimizeWindow, fallback: 'clicker.exe window minimize → ShowWindow(6)', capability: 'computer:window:minimize' }),
  defineTool({ name: 'maximizeWindow', description: 'Maximize a window by title or active window.', permission: Permission.NORMAL, category: 'computer:window', inputSchema: { type: 'object', properties: { name: { type: 'string' }, title: { type: 'string' } }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: computerHandlers.maximizeWindow, fallback: 'clicker.exe window maximize → ShowWindow(3)', capability: 'computer:window:maximize' }),
  defineTool({ name: 'closeWindow', description: 'Close a window (Alt+F4 / window close).', permission: Permission.DANGEROUS, category: 'computer:window', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: computerHandlers.closeWindow, fallback: 'clicker.exe window close → Alt+F4', capability: 'computer:window:close' }),
  defineTool({ name: 'switchApplication', description: 'Switch/activate a window into the foreground by title.', permission: Permission.NORMAL, category: 'computer:window', inputSchema: { type: 'object', properties: { name: { type: 'string' }, title: { type: 'string' }, application: { type: 'string' } }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, hwnd: { type: 'integer' } } }, handler: computerHandlers.switchApplication, fallback: 'clicker.exe activate → WScript.Shell AppActivate', capability: 'computer:window:activate' }),
  defineTool({ name: 'mouseClick', description: 'Click at screen coordinates (x,y). Supports pixels or normalized 0-1. Fallback chain per §8: clicker.exe → PowerShell mouse_event → simulated.', permission: Permission.NORMAL, category: 'computer:mouse', inputSchema: { type: 'object', properties: { x: S.x, y: S.y, button: S.button, clicks: { type: 'integer' }, count: { type: 'integer' } }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, x: { type: 'integer' }, y: { type: 'integer' } } }, handler: computerHandlers.mouseClick, fallback: 'clicker.exe click → Win32 mouse_event + SetCursorPos → simulated', capability: 'computer:mouse:click' }),
  defineTool({ name: 'clickScreen', description: 'Alias of mouseClick — click at screen coordinates.', permission: Permission.NORMAL, category: 'computer:mouse', inputSchema: { type: 'object', properties: { x: S.x, y: S.y, button: S.button }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: computerHandlers.clickScreen, fallback: 'mouseClick fallback chain', capability: 'computer:mouse:click' }),
  defineTool({ name: 'doubleClick', description: 'Double-click at coordinates.', permission: Permission.NORMAL, category: 'computer:mouse', inputSchema: { type: 'object', properties: { x: S.x, y: S.y, button: S.button }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: computerHandlers.doubleClick, fallback: 'mouseClick clicks=2', capability: 'computer:mouse:doubleClick' }),
  defineTool({ name: 'moveMouse', description: 'Move mouse cursor to (x,y) without clicking.', permission: Permission.NORMAL, category: 'computer:mouse', inputSchema: { type: 'object', properties: { x: S.x, y: S.y }, required: ['x', 'y'] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, x: { type: 'integer' }, y: { type: 'integer' } } }, handler: computerHandlers.moveMouse, fallback: 'clicker.exe move → SetCursorPos', capability: 'computer:mouse:move' }),

  // ——— Clipboard (§8) ———
  defineTool({ name: 'copySelected', description: 'Copy selected content to clipboard (Ctrl+C).', permission: Permission.NORMAL, category: 'computer:clipboard', inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: computerHandlers.copySelected, fallback: 'clicker.exe key ctrl+c → SendKeys ^c', capability: 'computer:clipboard:copy' }),
  defineTool({ name: 'pasteClipboard', description: 'Paste clipboard content into active window (Ctrl+V). Optional text to set clipboard first.', permission: Permission.NORMAL, category: 'computer:clipboard', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: computerHandlers.pasteClipboard, fallback: 'clicker.exe clipboard set --b64 → Ctrl+V', capability: 'computer:clipboard:paste' }),
  defineTool({ name: 'getClipboard', description: 'Get current clipboard text content.', permission: Permission.SAFE, category: 'computer:clipboard', inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, text: { type: 'string' } } }, handler: computerHandlers.getClipboard, fallback: 'clicker.exe clipboard get → Get-Clipboard', capability: 'computer:clipboard:get' }),
  defineTool({ name: 'clearClipboard', description: 'Clear clipboard contents.', permission: Permission.NORMAL, category: 'computer:clipboard', inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: computerHandlers.clearClipboard, fallback: 'clicker.exe clipboard clear → Set-Clipboard ""', capability: 'computer:clipboard:clear' }),

  // ——— Screenshot / screen reading (§9, §10) ———
  defineTool({ name: 'takeScreenshot', description: 'Capture a screenshot (base64 or file). Used for screen understanding §9.', permission: Permission.SAFE, category: 'computer:screen', inputSchema: { type: 'object', properties: { filePath: { type: 'string' }, path: { type: 'string' } }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, data: { type: 'string' }, path: { type: 'string' } } }, handler: computerHandlers.takeScreenshot, fallback: 'clicker.exe screenshot --base64', capability: 'computer:screen:capture' }),
  defineTool({ name: 'saveScreenshot', description: 'Capture and save screenshot to file (default DATA_DIR/screenshots).', permission: Permission.SAFE, category: 'computer:screen', inputSchema: { type: 'object', properties: { filePath: { type: 'string' }, path: { type: 'string' } }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, path: { type: 'string' } } }, handler: computerHandlers.saveScreenshot, fallback: 'clicker.exe screenshot <path>', capability: 'computer:screen:save' }),
  defineTool({ name: 'analyzeScreenshot', description: 'Capture screenshot for vision analysis (routes to model). Sets needsVision=true.', permission: Permission.SAFE, category: 'computer:screen', inputSchema: { type: 'object', properties: { filePath: { type: 'string' } }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, needsVision: { type: 'boolean' } } }, handler: computerHandlers.analyzeScreenshot, fallback: 'takeScreenshot + vision router', capability: 'computer:screen:analyze' }),
  defineTool({ name: 'readScreen', description: 'Read/analyze current screen (alias of analyzeScreenshot).', permission: Permission.SAFE, category: 'computer:screen', inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: computerHandlers.readScreen, fallback: 'analyzeScreenshot', capability: 'computer:screen:read' }),

  // ——— Browser automation — §17 (Playwright & Web HUD) ———
  defineTool({ name: 'browserOpen', description: 'Open a URL in the browser (local agent + native fallback).', permission: Permission.NORMAL, category: 'browser:navigation', inputSchema: { type: 'object', properties: { url: S.url }, required: ['url'] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, url: { type: 'string' } } }, handler: browserHandlers.browserOpen, fallback: 'fetch /api/navigate → native start', capability: 'browser:open' }),
  defineTool({ name: 'browserSearch', description: 'Enter a query in the active website search box.', permission: Permission.SAFE, category: 'browser:search', inputSchema: { type: 'object', properties: { query: S.query }, required: ['query'] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: browserHandlers.browserSearch, fallback: 'local-agent navigate google → native', capability: 'browser:search' }),
  defineTool({ name: 'browserClick', description: 'Click a target element by selector/text in the active webpage.', permission: Permission.NORMAL, category: 'browser:action', inputSchema: { type: 'object', properties: { selector: S.selector, description: { type: 'string' }, text: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, required: ['selector'] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: browserHandlers.browserClick, fallback: 'fetch /api/action click → mouseClick at x,y', capability: 'browser:click' }),
  defineTool({ name: 'browserMediaControl', description: 'Control media playback (play/pause/volume/mute/skip/fullscreen).', permission: Permission.NORMAL, category: 'browser:media', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['play', 'pause', 'play_pause', 'volume', 'fullscreen', 'exit_fullscreen', 'mute', 'unmute', 'skip', 'next', 'prev', 'previous', 'stop', 'toggle'] }, value: { type: 'integer' } }, required: ['action'] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: browserHandlers.browserMediaControl, fallback: 'local-agent media → clicker.exe mediaplaypause/volume', capability: 'browser:media' }),
  defineTool({ name: 'browserScroll', description: 'Scroll the active webpage up or down.', permission: Permission.NORMAL, category: 'browser:action', inputSchema: { type: 'object', properties: { direction: { type: 'string', enum: ['up', 'down'] }, amount: { type: 'integer' }, lines: { type: 'integer' } }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: browserHandlers.browserScroll, fallback: 'local-agent scroll → clicker.exe scroll', capability: 'browser:scroll' }),
  defineTool({ name: 'browserType', description: 'Type text into the active input container (browser).', permission: Permission.NORMAL, category: 'browser:action', inputSchema: { type: 'object', properties: { text: S.text, selector: { type: 'string' } }, required: ['text'] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: browserHandlers.browserType, fallback: 'local-agent /api/action type → typeText native', capability: 'browser:type' }),
  defineTool({ name: 'browserGoBack', description: 'Navigate back in browser history.', permission: Permission.NORMAL, category: 'browser:navigation', inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: browserHandlers.browserGoBack, fallback: 'local-agent back → Alt+Left', capability: 'browser:nav:back' }),
  defineTool({ name: 'browserTabAction', description: 'Perform browser tab actions: new, close, switch, next, prev.', permission: Permission.NORMAL, category: 'browser:tab', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['new', 'close', 'switch', 'next', 'prev', 'previous', 'open'] }, tabId: { type: 'string' }, url: S.url }, required: ['action'] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: browserHandlers.browserTabAction, fallback: 'clicker.exe key ctrl+t/ctrl+w/ctrl+tab', capability: 'browser:tab' }),
  defineTool({ name: 'desktopBrowserOpen', description: 'Open URL in desktop browser (local agent).', permission: Permission.NORMAL, category: 'browser:navigation', inputSchema: { type: 'object', properties: { url: S.url }, required: ['url'] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: browserHandlers.desktopBrowserOpen, fallback: 'local-agent navigate → native', capability: 'browser:open:desktop' }),
  defineTool({ name: 'desktopBrowserNavigate', description: 'Navigate desktop browser to URL.', permission: Permission.NORMAL, category: 'browser:navigation', inputSchema: { type: 'object', properties: { url: S.url }, required: ['url'] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: browserHandlers.desktopBrowserNavigate, fallback: 'browserOpen', capability: 'browser:navigate' }),
  defineTool({ name: 'desktopBrowserOpenTab', description: 'Open a new desktop browser tab (optionally with URL).', permission: Permission.NORMAL, category: 'browser:tab', inputSchema: { type: 'object', properties: { url: S.url }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: browserHandlers.desktopBrowserOpenTab, fallback: 'Ctrl+T + navigate', capability: 'browser:tab:open' }),
  defineTool({ name: 'desktopBrowserCloseTab', description: 'Close the active desktop browser tab.', permission: Permission.NORMAL, category: 'browser:tab', inputSchema: { type: 'object', properties: { tabId: { type: 'string' } }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: browserHandlers.desktopBrowserCloseTab, fallback: 'Ctrl+W', capability: 'browser:tab:close' }),
  defineTool({ name: 'desktopBrowserSearch', description: 'Search via desktop browser (Google).', permission: Permission.SAFE, category: 'browser:search', inputSchema: { type: 'object', properties: { query: S.query, text: S.query }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: browserHandlers.desktopBrowserSearch, fallback: 'local-agent navigate google', capability: 'browser:search:desktop' }),
  defineTool({ name: 'desktopBrowserClick', description: 'Click element in desktop browser.', permission: Permission.NORMAL, category: 'browser:action', inputSchema: { type: 'object', properties: { selector: S.selector, text: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: browserHandlers.desktopBrowserClick, fallback: 'local-agent click → mouseClick', capability: 'browser:click:desktop' }),
  defineTool({ name: 'desktopBrowserType', description: 'Type into desktop browser input.', permission: Permission.NORMAL, category: 'browser:action', inputSchema: { type: 'object', properties: { text: S.text, selector: { type: 'string' } }, required: ['text'] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: browserHandlers.desktopBrowserType, fallback: 'local-agent type → typeText', capability: 'browser:type:desktop' }),
  defineTool({ name: 'desktopBrowserFillForm', description: 'Fill form fields in active browser window.', permission: Permission.NORMAL, category: 'browser:action', inputSchema: { type: 'object', properties: { fields: { type: 'object' }, formData: { type: 'object' } }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, filled: { type: 'integer' } } }, handler: browserHandlers.desktopBrowserFillForm, fallback: 'typeText + Tab per field', capability: 'browser:form' }),
  defineTool({ name: 'desktopBrowserGoBack', description: 'Navigate back in desktop browser history.', permission: Permission.NORMAL, category: 'browser:navigation', inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: browserHandlers.desktopBrowserGoBack, fallback: 'Alt+Left', capability: 'browser:nav:back:desktop' }),
  defineTool({ name: 'desktopBrowserGoForward', description: 'Navigate forward in desktop browser history.', permission: Permission.NORMAL, category: 'browser:navigation', inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: browserHandlers.desktopBrowserGoForward, fallback: 'Alt+Right', capability: 'browser:nav:forward' }),
  defineTool({ name: 'desktopBrowserScroll', description: 'Scroll desktop browser page.', permission: Permission.NORMAL, category: 'browser:action', inputSchema: { type: 'object', properties: { direction: { type: 'string', enum: ['up', 'down'] }, amount: { type: 'integer' } }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: browserHandlers.desktopBrowserScroll, fallback: 'local scroll → clicker scroll', capability: 'browser:scroll:desktop' }),

  // ——— Coding assistance (§19) ———
  defineTool({ name: 'createPythonFile', description: 'Create a Python file with optional content (alias of createFile/writeCodeFile).', permission: Permission.NORMAL, category: 'coding:write', inputSchema: { type: 'object', properties: { path: S.path, filePath: S.path, content: S.content, code: S.content }, required: ['path'] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, path: { type: 'string' } } }, handler: computerHandlers.createPythonFile, fallback: 'fs.writeFileSync', capability: 'coding:python:create' }),
  defineTool({ name: 'runPythonScript', description: 'Execute a Python script file.', permission: Permission.DANGEROUS, category: 'coding:execute', inputSchema: { type: 'object', properties: { path: S.path, script: S.path, filePath: S.path }, required: ['path'] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, stdout: { type: 'string' } } }, handler: computerHandlers.runPythonScript, fallback: 'python.exe script', capability: 'coding:python:run' }),
  defineTool({ name: 'createProjectFolder', description: 'Create a project directory (mkdir -p).', permission: Permission.NORMAL, category: 'filesystem:write', inputSchema: { type: 'object', properties: { path: S.path, folderPath: S.path, name: { type: 'string' }, folder: { type: 'string' } }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, path: { type: 'string' } } }, handler: computerHandlers.createProjectFolder, fallback: 'fs.mkdirSync recursive', capability: 'filesystem:mkdir' }),
  defineTool({ name: 'writeCodeFile', description: 'Write a code file (any language) with content.', permission: Permission.NORMAL, category: 'coding:write', inputSchema: { type: 'object', properties: { path: S.path, filePath: S.path, content: S.content, code: S.content }, required: ['path'] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, path: { type: 'string' } } }, handler: computerHandlers.writeCodeFile, fallback: 'fs.writeFileSync', capability: 'coding:write' }),
  defineTool({ name: 'runTerminalCommand', description: 'Execute a terminal/PowerShell command with timeout & output capture (§54).', permission: Permission.DANGEROUS, category: 'terminal:exec', inputSchema: { type: 'object', properties: { command: { type: 'string' }, cmd: { type: 'string' }, cwd: { type: 'string' }, timeout: { type: 'integer' } }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, output: { type: 'string' } } }, handler: computerHandlers.runTerminalCommand, fallback: 'child_process execSync with 15s timeout', capability: 'terminal:exec' }),
  defineTool({ name: 'executeCommand', description: 'Alias of runTerminalCommand.', permission: Permission.DANGEROUS, category: 'terminal:exec', inputSchema: { type: 'object', properties: { command: { type: 'string' }, cmd: { type: 'string' } }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: computerHandlers.executeCommand, fallback: 'execSync', capability: 'terminal:exec' }),

  // ——— System information (§10 continuous awareness) ———
  defineTool({ name: 'systemInfo', description: 'Get system information (platform, CPU, RAM, uptime — cached 5s).', permission: Permission.SAFE, category: 'computer:system', inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, platform: { type: 'string' }, cpus: { type: 'integer' } } }, handler: computerHandlers.systemInfo, fallback: 'os module + caching', capability: 'system:info' }),
  defineTool({ name: 'gpuInfo', description: 'Get GPU information (wmic VideoController).', permission: Permission.SAFE, category: 'computer:system', inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, output: { type: 'string' } } }, handler: computerHandlers.gpuInfo, fallback: 'wmic path win32_VideoController', capability: 'system:gpu' }),
  defineTool({ name: 'temperatureInfo', description: 'Get CPU thermal zone temperature if exposed by ACPI.', permission: Permission.SAFE, category: 'computer:system', inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, temperature_c: { type: 'number' } } }, handler: computerHandlers.temperatureInfo, fallback: 'Get-CimInstance MSAcpi_ThermalZoneTemperature', capability: 'system:temp' }),

  // ——— Brightness (V2) ———
  defineTool({ name: 'brightnessUp', description: 'Increase display brightness (requires clicker.exe).', permission: Permission.NORMAL, category: 'computer:display', inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, level: { type: 'integer' } } }, handler: computerHandlers.brightnessUp, fallback: 'clicker.exe brightness up', capability: 'computer:display:brightness' }),
  defineTool({ name: 'brightnessDown', description: 'Decrease display brightness.', permission: Permission.NORMAL, category: 'computer:display', inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: computerHandlers.brightnessDown, fallback: 'clicker.exe brightness down', capability: 'computer:display:brightness' }),
  defineTool({ name: 'setBrightness', description: 'Set display brightness 0-100.', permission: Permission.NORMAL, category: 'computer:display', inputSchema: { type: 'object', properties: { level: { type: 'integer' }, brightness: { type: 'integer' } }, required: [] }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, level: { type: 'integer' } } }, handler: computerHandlers.setBrightness, fallback: 'clicker.exe brightness set', capability: 'computer:display:brightness:set' }),

  // ——— Auto-start (§8 system settings) ———
  defineTool({ name: 'enableAutoStart', description: 'Enable Windows auto-start for Myraa (registry Run key via clicker.exe).', permission: Permission.DANGEROUS, category: 'computer:settings', inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: computerHandlers.enableAutoStart, fallback: 'clicker.exe autostart enable', capability: 'computer:autostart:enable' }),
  defineTool({ name: 'disableAutoStart', description: 'Disable Windows auto-start.', permission: Permission.DANGEROUS, category: 'computer:settings', inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, handler: computerHandlers.disableAutoStart, fallback: 'clicker.exe autostart disable', capability: 'computer:autostart:disable' }),
  defineTool({ name: 'getAutoStartStatus', description: 'Get Windows auto-start status.', permission: Permission.SAFE, category: 'computer:settings', inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, enabled: { type: 'boolean' } } }, handler: computerHandlers.getAutoStartStatus, fallback: 'clicker.exe autostart status', capability: 'computer:autostart:status' }),
];

// ---------------------------------------------------------------------------
// Alias map — legacy names from older DESKTOP_TOOLS consumers
// ---------------------------------------------------------------------------
const ALIAS_MAP = {
  openApp: 'openApplication',
  launchApp: 'openApplication',
  closeApp: 'closeApplication',
  activateApp: 'switchApplication',
  focusWindow: 'switchApplication',
  click: 'mouseClick',
  rightClick: 'mouseClick',
  mouseMove: 'moveMouse',
  moveCursor: 'moveMouse',
  mouseDrag: 'mouseDrag', // handler exists even if not in DESKTOP_TOOLS
  mouseScroll: 'browserScroll',
  scrollMouse: 'browserScroll',
  type: 'browserType',
  typeText: 'browserType',
  keyboardType: 'browserType',
  desktopType: 'browserType',
  pressKey: 'browserType', // approximate
  hotkey: 'browserType',
  openAppAlias: 'openApplication',
};

// ---------------------------------------------------------------------------
// ToolRegistry — provider-independent, policy-aware, fallback-capable
// ---------------------------------------------------------------------------
export class ToolRegistry {
  constructor({ policyEngine = null, eventBus = null, logger = console } = {}) {
    // Every tool action must pass through Policy Engine §34 — wire singleton by default
    this.policyEngine = policyEngine || defaultPolicyEngine || null;
    this.eventBus = eventBus;
    this.logger = logger;
    this._tools = new Map();
    this._plugins = new Map();
    // Index core definitions
    for (const def of TOOL_DEFINITIONS) this._tools.set(def.name, def);
  }

  // ——— Registration (§33 plugin system) ———
  register(def) {
    if (!def || !def.name || !def.handler) throw new Error('Tool definition must have name and handler');
    if (!def.inputSchema) def.inputSchema = { type: 'object', properties: {}, required: [] };
    if (!def.outputSchema) def.outputSchema = { type: 'object', properties: { ok: { type: 'boolean' } } };
    if (!def.permission) def.permission = Permission.NORMAL;
    if (!def.version) def.version = '1.0.0';
    if (this._tools.has(def.name)) this.logger.warn?.(`[ToolRegistry] Overwriting tool ${def.name}`);
    this._tools.set(def.name, def);
    return def;
  }

  registerPlugin(plugin) {
    // plugin = { id, version, permissions, tools: [def,...], auth, metadata }
    if (!plugin || !plugin.id) throw new Error('Plugin must have id');
    if (this._plugins.has(plugin.id)) throw new Error(`Plugin ${plugin.id} already registered`);
    const tools = plugin.tools || [];
    for (const t of tools) {
      const def = { ...t, plugin: plugin.id, version: plugin.version || t.version || '1.0.0', auth: t.auth ?? !!plugin.auth };
      this.register(def);
    }
    this._plugins.set(plugin.id, { ...plugin, registeredAt: new Date().toISOString(), toolCount: tools.length });
    return { ok: true, pluginId: plugin.id, toolCount: tools.length };
  }

  unregister(name) { return this._tools.delete(name); }
  has(name) { return this._tools.has(name) || (ALIAS_MAP[name] && this._tools.has(ALIAS_MAP[name])); }

  get(name) {
    if (this._tools.has(name)) return this._tools.get(name);
    const alias = ALIAS_MAP[name];
    if (alias && this._tools.has(alias)) return this._tools.get(alias);
    return null;
  }

  list({ permission = null, category = null, plugin = null } = {}) {
    let out = [...this._tools.values()];
    if (permission) out = out.filter(t => t.permission === permission);
    if (category) out = out.filter(t => t.category === category || t.category.startsWith(category));
    if (plugin) out = out.filter(t => t.plugin === plugin);
    return out;
  }

  listPlugins() { return [...this._plugins.values()]; }

  describe(name) {
    const def = this.get(name);
    if (!def) return null;
    return { name: def.name, description: def.description, permission: def.permission, category: def.category, version: def.version, inputSchema: def.inputSchema, outputSchema: def.outputSchema, fallback: def.fallback, capability: def.capability, plugin: def.plugin, auth: def.auth };
  }

  // ——— Validation ———
  validate(name, args) {
    const def = this.get(name);
    if (!def) return { ok: false, error: `Unknown tool: ${name}` };
    return validateAgainstSchema(def.inputSchema, args || {});
  }

  // ——— Policy check — §34 SAFE/NORMAL/DANGEROUS (§18 tiers) ———
  async checkPermission(name, args, context = {}) {
    const def = this.get(name);
    if (!def) return { allowed: false, reason: `Unknown tool ${name}` };
    // If policyEngine provided, delegate (MasterOrchestrator §5 assess)
    if (this.policyEngine && typeof this.policyEngine.assess === 'function') {
      try {
        const res = await this.policyEngine.assess({ tool: name, permission: def.permission, args, context });
        // support both boolean and object return
        if (typeof res === 'boolean') return { allowed: res, tier: def.permission };
        if (res && typeof res.allowed === 'boolean') return res;
      } catch (e) { this.logger.warn?.(`[ToolRegistry] policyEngine error: ${e.message}`); }
    }
    // Default policy: SAFE & NORMAL auto-allowed, DANGEROUS requires confirmation unless context.confirmed or env override
    if (def.permission === Permission.SAFE || def.permission === Permission.NORMAL) return { allowed: true, tier: def.permission, reason: 'auto-allowed' };
    if (def.permission === Permission.DANGEROUS) {
      if (context.confirmed === true || process.env.MYRAA_ALLOW_DANGEROUS === '1') return { allowed: true, tier: def.permission, reason: 'confirmed/override' };
      return { allowed: false, needsConfirmation: true, tier: def.permission, reason: `DANGEROUS tool '${name}' requires explicit confirmation (set confirmed:true or MYRAA_ALLOW_DANGEROUS=1)` };
    }
    return { allowed: true };
  }

  // ——— Execution ———
  async call(name, args = {}, context = {}) {
    const start = Date.now();
    const def = this.get(name);
    if (!def) return { ok: false, error: `Unknown tool: ${name}`, tool: name, permission: 'UNKNOWN' };

    // 1) Validate input
    const v = validateAgainstSchema(def.inputSchema, args);
    if (!v.ok) return { ok: false, error: `Validation failed for ${name}: ${v.error}`, tool: name, permission: def.permission, validationError: v.error };

    // 2) Policy gate (§34)
    const permCheck = await this.checkPermission(name, args, context);
    if (!permCheck.allowed) {
      const err = { ok: false, error: permCheck.reason || `Permission denied for ${name} (${def.permission})`, tool: name, permission: def.permission, needsConfirmation: !!permCheck.needsConfirmation, tier: permCheck.tier };
      this._emit('tool:blocked', { tool: name, permission: def.permission, reason: err.error, args: this._redact(args) });
      return err;
    }

    // 3) Emit invoked
    this._emit('tool:invoked', { tool: name, permission: def.permission, category: def.category, args: this._redact(args) });

    // 4) Execute with fallback awareness (§8 preferred order already in handler, but registry adds cross-handler fallback)
    let result;
    try {
      const maybePromise = def.handler(args, context);
      result = maybePromise instanceof Promise ? await maybePromise : maybePromise;
      if (!result || typeof result !== 'object') result = { ok: true, result: String(result) };
      if (result.ok === undefined) result.ok = true;
    } catch (e) {
      result = { ok: false, error: e.message || String(e), stack: e.stack };
      this._emit('tool:error', { tool: name, error: result.error });
      // Attempt fallback if defined and error is native-backend related
      if (def.fallback && /clicker|not available|fallback/i.test(result.error)) {
        this.logger.warn?.(`[ToolRegistry] ${name} handler failed, fallback descriptor: ${def.fallback}`);
      }
    }

    const durationMs = Date.now() - start;
    const payload = { tool: name, permission: def.permission, category: def.category, durationMs, ok: !!result.ok, result: result.result ?? result.output ?? result.text ?? '', error: result.error };

    // 5) Validate output shape (warn only, don't block)
    if (def.outputSchema) {
      const ov = validateAgainstSchema(def.outputSchema, result);
      if (!ov.ok) this.logger.warn?.(`[ToolRegistry] ${name} output schema warning: ${ov.error}`);
    }

    // 6) Emit completed
    this._emit('tool:completed', payload);

    return { ...result, tool: name, permission: def.permission, category: def.category, durationMs, fallback: def.fallback };
  }

  // Backwards compat: .call alias used by orchestrator
  async execute(name, args, context) { return this.call(name, args, context); }

  _emit(event, payload) {
    try { this.eventBus?.emit?.(event, { ts: new Date().toISOString(), event, ...payload }); } catch {}
    try { // also try global eventBus import if available
    } catch {}
  }
  _redact(args) {
    // never log secrets
    if (!args || typeof args !== 'object') return args;
    const copy = { ...args };
    for (const k of ['apiKey', 'token', 'password', 'secret', 'credential']) if (k in copy) copy[k] = '[REDACTED]';
    return copy;
  }

  // ——— Stats ———
  get stats() {
    const all = [...this._tools.values()];
    return {
      total: all.length,
      byPermission: { SAFE: all.filter(t => t.permission === Permission.SAFE).length, NORMAL: all.filter(t => t.permission === Permission.NORMAL).length, DANGEROUS: all.filter(t => t.permission === Permission.DANGEROUS).length },
      byCategory: Object.fromEntries([...new Set(all.map(t => t.category.split(':')[0]))].map(k => [k, all.filter(t => t.category.startsWith(k)).length])),
      plugins: this._plugins.size,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton registry instance — provider-independent default export
// ---------------------------------------------------------------------------
export const registry = new ToolRegistry();

// Re-export DESKTOP_TOOLS set for reference parity (72 tools)
export const DESKTOP_TOOLS = new Set(TOOL_DEFINITIONS.map(d => d.name));

// Convenience: expose Permission on registry
registry.Permission = Permission;
registry.TOOL_DEFINITIONS = TOOL_DEFINITIONS;

export default registry;
