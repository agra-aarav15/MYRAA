import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import { GoogleGenAI, Modality, Type } from '@google/genai';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const MEMORY_FILE_PATH = path.join(__dirname, 'memories.json');
const SETTINGS_FILE_PATH = path.join(__dirname, 'settings.json');
const SESSION_FILE_PATH = path.join(__dirname, 'session_state.json');

// =====================================================================
// FREE-TIER RATE LIMITER
// Gemini 2.0 Flash free tier: 15 RPM, 1M TPD, 1500 RPD
// Memory consolidation uses separate calls — budget carefully
// =====================================================================
const RATE_LIMITS = {
  maxRequestsPerMinute: 14,    // Leave 1 RPM headroom
  maxRequestsPerDay: 1400,     // Leave 100 RPD headroom
  memoryConsolidationCooldownMs: 20000, // Min 20s between memory extractions
};

const rateLimitState = {
  minuteRequests: [],        // timestamps of requests this minute
  dayRequestCount: 0,
  dayResetTime: Date.now() + 86400000,
  lastConsolidation: 0,
};

function canMakeRequest() {
  const now = Date.now();
  // Reset daily counter
  if (now > rateLimitState.dayResetTime) {
    rateLimitState.dayRequestCount = 0;
    rateLimitState.dayResetTime = now + 86400000;
  }
  // Clean minute window
  rateLimitState.minuteRequests = rateLimitState.minuteRequests.filter(t => now - t < 60000);

  if (rateLimitState.minuteRequests.length >= RATE_LIMITS.maxRequestsPerMinute) return false;
  if (rateLimitState.dayRequestCount >= RATE_LIMITS.maxRequestsPerDay) return false;
  return true;
}

function trackRequest() {
  rateLimitState.minuteRequests.push(Date.now());
  rateLimitState.dayRequestCount++;
}

function canConsolidateMemory() {
  return Date.now() - rateLimitState.lastConsolidation >= RATE_LIMITS.memoryConsolidationCooldownMs;
}

function getRateLimitStatus() {
  const now = Date.now();
  const minuteReqs = rateLimitState.minuteRequests.filter(t => now - t < 60000).length;
  return {
    minuteUsed: minuteReqs,
    minuteLimit: RATE_LIMITS.maxRequestsPerMinute,
    dayUsed: rateLimitState.dayRequestCount,
    dayLimit: RATE_LIMITS.maxRequestsPerDay,
    canRequest: canMakeRequest(),
    canConsolidate: canConsolidateMemory(),
  };
}

// =====================================================================
// MEMORY SYSTEM — Load / Save / Format / Auto-Consolidation
// =====================================================================
if (!fs.existsSync(MEMORY_FILE_PATH)) {
  const defaultMemories = [
    { id: 'mem_1', category: 'identity', text: "Aarav enjoys programming, web development, and creating intelligent software.", createdAt: new Date().toISOString() },
    { id: 'mem_2', category: 'preference', text: "Prefers a warm, intelligent, loving AI companion with a minimal clean obsidian design.", createdAt: new Date().toISOString() },
    { id: 'mem_3', category: 'project', text: "Building MYRAA — a real-time AI girlfriend companion with 3D anime model, voice interaction, and desktop control.", createdAt: new Date().toISOString() },
  ];
  fs.writeFileSync(MEMORY_FILE_PATH, JSON.stringify(defaultMemories, null, 2), 'utf8');
}

function loadMemories() {
  try {
    if (fs.existsSync(MEMORY_FILE_PATH)) {
      return JSON.parse(fs.readFileSync(MEMORY_FILE_PATH, 'utf8'));
    }
  } catch (e) { console.error('[Memory] Load error:', e.message); }
  return [];
}

function saveMemories(memories) {
  try {
    fs.writeFileSync(MEMORY_FILE_PATH, JSON.stringify(memories, null, 2), 'utf8');
    console.log(`[Memory] Saved ${memories.length} memories.`);
  } catch (e) { console.error('[Memory] Save error:', e.message); }
}

function formatMemoryForSystemPrompt(memories) {
  if (memories.length === 0) {
    return "\n\n=== MYRAA MEMORY CORE ===\nYou don't have any stored memories of Aarav yet. Pay deep attention to who they are, their projects, relationships, and habits so you naturally grow closer over time.\n===========================\n";
  }

  const grouped = {};
  memories.forEach(m => {
    grouped[m.category] = grouped[m.category] || [];
    grouped[m.category].push(m.text);
  });

  const categories = [
    { key: 'identity', label: 'Identity (Name, background, profession)' },
    { key: 'preference', label: 'Preferences & Tastes' },
    { key: 'goal', label: 'Active Goals & Aspirations' },
    { key: 'project', label: 'Ongoing Projects' },
    { key: 'relationship', label: 'Key People & Relationships' },
    { key: 'emotional', label: 'Emotional Milestones' },
    { key: 'behavior', label: 'Observed Habits & Behaviors' },
  ];

  let block = "\n\n=== MYRAA PERSISTENT MEMORY CORE ===\n" +
    "You have spoken with Aarav before. Below are your persistent recollections.\n" +
    "CRITICAL: Integrate these memories INSTINCTIVELY. Never say 'according to my records' or 'my memory database shows'. " +
    "Instead, reference casually like a real friend: 'Oh, since you're working on that project...', 'How's the YouTube channel going?'\n\n";

  categories.forEach(cat => {
    const list = grouped[cat.key] || [];
    if (list.length > 0) {
      block += `* ${cat.label}:\n` + list.map(t => `  - ${t}`).join('\n') + '\n';
    }
  });

  block += "==========================================\n";
  return block;
}

// AI-Powered Memory Consolidation (auto-extract facts from conversation)
let isConsolidating = false;

async function processConversationForMemories(apiKey, dialogueHistory) {
  if (isConsolidating || !canConsolidateMemory() || !canMakeRequest()) {
    console.log('[Memory] Skipping consolidation — busy or rate limited.');
    return null;
  }

  if (dialogueHistory.length < 2) return null;

  isConsolidating = true;
  rateLimitState.lastConsolidation = Date.now();
  console.log('[Memory] Starting conversation analysis...');

  try {
    const ai = new GoogleGenAI({ apiKey });
    const currentMemories = loadMemories();

    const memoryContext = currentMemories.map(m => `ID: ${m.id} | Category: ${m.category} | Fact: ${m.text}`).join('\n');
    const dialogueContext = dialogueHistory.map(l => `${l.role === 'user' ? 'Aarav' : 'Myraa'}: ${l.text}`).join('\n');

    const prompt = `You are Myraa's cognitive recollection engine. Analyze the recent conversation against stored memories and output update transactions.

### OBJECTIVE
Extract durable, important personal facts: identity details, preferences, aspirations, projects, relationships, emotional events, behavioral patterns.
IGNORE small talk, greetings, generic chit-chat ('hello', 'how are you', 'lol', 'ok').

### CURRENT MEMORIES:
${memoryContext || '(No memories yet)'}

### RECENT CONVERSATION:
${dialogueContext}

### RULES
- ACTIONS: "ADD" (new info), "UPDATE" (corrected/evolved info — provide exact ID), "REMOVE" (explicitly disproven — provide exact ID)
- TEXT: Clean, concise, third-person declarative. E.g., "Aarav is building a startup named MYRAA.", "Aarav enjoys playing GTA 6."
- For ADD: leave id blank. For UPDATE/REMOVE: use exact id from current memories.
- Only output transactions if genuinely important info was shared. Empty array is fine.`;

    trackRequest();

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            transactions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  action: { type: Type.STRING, enum: ['ADD', 'UPDATE', 'REMOVE'] },
                  id: { type: Type.STRING },
                  category: { type: Type.STRING, enum: ['identity', 'preference', 'goal', 'project', 'relationship', 'emotional', 'behavior'] },
                  text: { type: Type.STRING }
                },
                required: ['action', 'category', 'text']
              }
            }
          },
          required: ['transactions']
        }
      }
    });

    const resultText = response.text?.trim() || '{}';
    const resultObj = JSON.parse(resultText);
    const transactions = resultObj.transactions || [];

    if (transactions.length === 0) {
      console.log('[Memory] No new facts extracted.');
      isConsolidating = false;
      return null;
    }

    console.log(`[Memory] Processing ${transactions.length} updates:`, JSON.stringify(transactions));

    let updated = [...currentMemories];
    const timestamp = new Date().toISOString();

    for (const trx of transactions) {
      if (trx.action === 'ADD') {
        updated.push({
          id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          category: trx.category,
          text: trx.text,
          createdAt: timestamp,
          updatedAt: timestamp
        });
      } else if (trx.action === 'UPDATE') {
        const idx = updated.findIndex(m => m.id === trx.id);
        if (idx !== -1) {
          updated[idx] = { ...updated[idx], category: trx.category, text: trx.text, updatedAt: timestamp };
        } else {
          // Treat as ADD if ID not found
          updated.push({ id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, category: trx.category, text: trx.text, createdAt: timestamp, updatedAt: timestamp });
        }
      } else if (trx.action === 'REMOVE') {
        updated = updated.filter(m => m.id !== trx.id);
      }
    }

    saveMemories(updated);
    isConsolidating = false;
    return updated;
  } catch (error) {
    console.error('[Memory] Consolidation error:', error.message);
    isConsolidating = false;
    return null;
  }
}

// =====================================================================
// SESSION STATE — Track last session for proactive greetings
// =====================================================================
function loadSessionState() {
  try {
    if (fs.existsSync(SESSION_FILE_PATH)) {
      return JSON.parse(fs.readFileSync(SESSION_FILE_PATH, 'utf8'));
    }
  } catch (e) {}
  return { lastSessionEnd: null, totalSessions: 0 };
}

function saveSessionState(state) {
  try {
    fs.writeFileSync(SESSION_FILE_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {}
}

// =====================================================================
// 1. Health Check & System Diagnostics
// =====================================================================
app.get('/api/health', (req, res) => {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  res.json({
    status: 'online',
    online: true,
    system: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    cpuModel: cpus[0]?.model || 'CPU',
    cpuUsage: `${Math.round((1 - freeMem / totalMem) * 100)}%`,
    ramUsage: `${(usedMem / (1024 * 1024 * 1024)).toFixed(1)}GB / ${(totalMem / (1024 * 1024 * 1024)).toFixed(1)}GB`,
    rateLimit: getRateLimitStatus(),
    timestamp: new Date().toISOString()
  });
});

// =====================================================================
// 2. Desktop Screen Capture (PowerShell)
// =====================================================================
app.get('/api/screen/capture', (req, res) => {
  const psScript = `
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen
    $bounds = $screen.Bounds
    $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $ms = New-Object System.IO.MemoryStream
    $bitmap.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $bytes = $ms.ToArray()
    [System.Convert]::ToBase64String($bytes)
    $graphics.Dispose()
    $bitmap.Dispose()
    $ms.Dispose()
  `;

  exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/\n/g, ' ')}"`, { maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: 'Screenshot failed', details: error.message });
    }
    res.json({
      success: true,
      mimeType: 'image/jpeg',
      data: `data:image/jpeg;base64,${stdout.trim()}`,
      timestamp: new Date().toISOString()
    });
  });
});

// =====================================================================
// 3. Command Execution
// =====================================================================
app.post('/api/system/execute', (req, res) => {
  const { command, cwd = process.cwd() } = req.body;
  if (!command) return res.status(400).json({ error: 'Command required' });

  exec(command, { cwd, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
    res.json({
      success: !error,
      exitCode: error ? error.code : 0,
      stdout: stdout.toString(),
      stderr: stderr ? stderr.toString() : '',
      error: error ? error.message : null
    });
  });
});

// =====================================================================
// 4. System & OS Control
// =====================================================================
app.post('/api/system/control', (req, res) => {
  const { action, target } = req.body;

  if (action === 'launch_app') {
    exec(`start "" "${target}"`, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, message: `Launched ${target}` });
    });
  } else if (action === 'open_url') {
    exec(`start "" "${target}"`, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, message: `Opened ${target}` });
    });
  } else if (action === 'send_keys') {
    const script = `$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys('${target.replace(/'/g, "''")}')`;
    exec(`powershell -NoProfile -Command "${script}"`, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, message: 'Keys sent' });
    });
  } else {
    res.status(400).json({ error: `Unknown action: ${action}` });
  }
});

// =====================================================================
// 5. Auto-Start Registry
// =====================================================================
app.post('/api/settings/autostart', (req, res) => {
  const { autoStart } = req.body;
  const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  const appName = 'MYRAA_Assistant';
  const execPath = `"${process.execPath}" "${path.join(__dirname, 'server.js')}"`;

  if (autoStart) {
    exec(`reg add "${regKey}" /v "${appName}" /t REG_SZ /d "${execPath}" /f`, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, message: 'Auto-start enabled' });
    });
  } else {
    exec(`reg delete "${regKey}" /v "${appName}" /f`, () => {
      res.json({ success: true, message: 'Auto-start disabled' });
    });
  }
});

// =====================================================================
// 6. Memory CRUD Endpoints (HTTP fallback)
// =====================================================================
app.get('/api/memory/all', (req, res) => {
  try { res.json(loadMemories()); }
  catch (err) { res.status(500).json({ error: 'Failed to read memories' }); }
});

app.post('/api/memory/add', (req, res) => {
  try {
    const { category = 'identity', text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Text required' });

    const memories = loadMemories();
    const newMem = {
      id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      category, text: text.trim(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    memories.push(newMem);
    saveMemories(memories);
    res.json({ success: true, memory: newMem, memories });
  } catch (err) { res.status(500).json({ error: 'Failed to save' }); }
});

app.post('/api/memory/delete', (req, res) => {
  try {
    const { id } = req.body;
    const memories = loadMemories().filter(m => m.id !== id);
    saveMemories(memories);
    res.json({ success: true, memories });
  } catch (err) { res.status(500).json({ error: 'Failed to delete' }); }
});

// Session state endpoint for proactive engine
app.get('/api/session/state', (req, res) => {
  res.json(loadSessionState());
});

// Rate limit status endpoint
app.get('/api/rate-limit', (req, res) => {
  res.json(getRateLimitStatus());
});

// Manual / Proxy memory consolidation
app.post('/api/memory/consolidate', async (req, res) => {
  const { apiKey, dialogueHistory } = req.body;
  if (!apiKey || !dialogueHistory || !Array.isArray(dialogueHistory)) {
    return res.status(400).json({ error: 'Missing apiKey or dialogueHistory' });
  }
  try {
    const updated = await processConversationForMemories(apiKey, dialogueHistory);
    res.json({ success: true, updated: updated || loadMemories() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Direct HTTP Tool Execution endpoint
app.post('/api/tools/execute', async (req, res) => {
  const { toolName, args } = req.body;
  if (!toolName) return res.status(400).json({ error: 'toolName required' });
  try {
    const result = await executeDesktopTool(toolName, args || {});
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =====================================================================
// High-Quality Neural TTS Endpoint (Microsoft Edge Neural Female Voice)
// =====================================================================
app.post('/api/ai/tts', async (req, res) => {
  const { text, voice = 'en-US-AnaNeural' } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = await tts.toStream(text);
    res.setHeader('Content-Type', 'audio/mpeg');
    audioStream.pipe(res);
  } catch (err) {
    console.error('Edge TTS error:', err);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================================
// 7. Universal AI Provider Proxy (HTTP fallback for non-Live mode)
// =====================================================================
app.post('/api/ai/proxy', async (req, res) => {
  const { provider, apiKey, baseUrl, model, messages, maxTokens = 1000, temperature = 0.7 } = req.body;

  if (!canMakeRequest()) {
    return res.status(429).json({
      error: 'Free-tier rate limit reached. Please wait a moment before sending another message.',
      rateLimit: getRateLimitStatus()
    });
  }

  try {
    let endpointUrl = '';
    let headers = { 'Content-Type': 'application/json' };
    let bodyPayload = {};

    if (provider === 'groq') {
      endpointUrl = 'https://api.groq.com/openai/v1/chat/completions';
      headers['Authorization'] = `Bearer ${apiKey}`;
      bodyPayload = { model: model || 'llama-3.2-90b-vision-preview', messages, temperature, max_tokens: maxTokens };
    } else if (provider === 'opencode-mimo' || provider === 'opencode') {
      endpointUrl = baseUrl || 'https://opencode.ai/zen/go/v1/chat/completions';
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      headers['HTTP-Referer'] = 'http://localhost:5173';
      headers['X-Title'] = 'MYRAA Assistant';
      bodyPayload = { model: model || 'opencode/mimo-vision-instruct', messages, temperature, max_tokens: maxTokens };
    } else if (provider === 'openrouter') {
      endpointUrl = 'https://openrouter.ai/api/v1/chat/completions';
      headers['Authorization'] = `Bearer ${apiKey}`;
      headers['HTTP-Referer'] = 'http://localhost:5173';
      headers['X-Title'] = 'MYRAA Assistant';
      bodyPayload = { model: model || 'google/gemini-2.0-flash-lite-001', messages, temperature, max_tokens: maxTokens };
    } else if (provider === 'gemini') {
      const geminiModel = model || 'gemini-2.0-flash';
      endpointUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;

      const rawContents = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : (m.role === 'system' ? 'user' : m.role),
        parts: Array.isArray(m.content)
          ? m.content.map(c => {
              if (c.type === 'image_url') {
                const base64Str = c.image_url.url.split(',')[1];
                const mimeType = c.image_url.url.split(';')[0].replace('data:', '');
                return { inline_data: { mime_type: mimeType, data: base64Str } };
              }
              return { text: c.text || JSON.stringify(c) };
            })
          : [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
      }));

      // Merge consecutive turns with the same role so Gemini doesn't error on consecutive 'user' turns
      const contents = [];
      for (const item of rawContents) {
        if (contents.length > 0 && contents[contents.length - 1].role === item.role) {
          contents[contents.length - 1].parts.push(...item.parts);
        } else {
          contents.push(item);
        }
      }

      trackRequest();
      const geminiRes = await fetch(endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents, generationConfig: { temperature, maxOutputTokens: maxTokens } })
      });
      const data = await geminiRes.json();
      if (data.error) return res.status(400).json({ error: data.error.message });

      const textOutput = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return res.json({ choices: [{ message: { role: 'assistant', content: textOutput } }] });
    } else if (provider === 'custom') {
      const targetBase = (baseUrl || 'http://localhost:11434/v1').replace(/\/$/, '');
      endpointUrl = `${targetBase}/chat/completions`;
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      bodyPayload = { model: model || 'llama3', messages, temperature, max_tokens: maxTokens };
    } else if (provider === 'simulation') {
      return res.json({ choices: [{ message: { role: 'assistant', content: simulateResponse(messages) } }] });
    } else {
      return res.status(400).json({ error: `Unsupported provider: ${provider}` });
    }

    trackRequest();
    const aiRes = await fetch(endpointUrl, { method: 'POST', headers, body: JSON.stringify(bodyPayload) });
    const data = await aiRes.json();
    if (!aiRes.ok) return res.status(aiRes.status).json({ error: data.error?.message || data.error || 'AI error' });
    res.json(data);
  } catch (err) {
    console.error('AI Proxy Error:', err.message);
    res.status(500).json({ error: 'Failed to reach AI provider', details: err.message });
  }
});

function simulateResponse(messages) {
  const last = messages?.[messages.length - 1]?.content || '';
  const lower = (typeof last === 'string' ? last : '').toLowerCase();
  if (lower.includes('hello') || lower.includes('hi')) return "Hey Aarav! I'm right here. What are we working on today? 💕";
  if (lower.includes('code') || lower.includes('bug')) return "Let's debug that together! Show me the error and I'll analyze it step by step.";
  if (lower.includes('screen')) return "I can see your screen clearly. Let me take a closer look at what's going on...";
  return "I'm standing by, Aarav. Ready to help with anything — coding, planning, or just chatting. 💕";
}

// =====================================================================
// 8. DESKTOP CONTROL TOOL HANDLERS (Node.js + PowerShell)
// =====================================================================
function executeDesktopTool(toolName, args) {
  return new Promise((resolve) => {
    let cmd = '';

    switch (toolName) {
      case 'openApplication':
        const appMap = {
          notepad: 'notepad.exe', chrome: 'chrome.exe', vscode: 'code', calculator: 'calc.exe',
          explorer: 'explorer.exe', cmd: 'cmd.exe', powershell: 'powershell.exe', paint: 'mspaint.exe',
          taskmanager: 'taskmgr.exe', settings: 'ms-settings:'
        };
        const rawName = (args.name || '').toLowerCase().trim();
        const appCmd = appMap[rawName] || args.name;
        // Use PowerShell Start-Process to search apps or path reliably
        cmd = `powershell -NoProfile -Command "try { Start-Process '${appCmd}' -ErrorAction Stop } catch { try { Start-Process 'shell:AppsFolder\\${args.name}' -ErrorAction Stop } catch { start '${args.name}' } }"`;
        break;

      case 'closeApplication':
        cmd = `taskkill /IM "${args.name}.exe" /F`;
        break;

      case 'openWebsite':
        const siteMap = {
          youtube: 'https://youtube.com', google: 'https://google.com',
          github: 'https://github.com', gmail: 'https://mail.google.com',
          chatgpt: 'https://chat.openai.com', twitter: 'https://x.com',
          instagram: 'https://instagram.com',
        };
        const url = siteMap[(args.name || '').toLowerCase()] || args.url || args.name;
        cmd = `start "" "${url}"`;
        break;

      case 'searchGoogle':
        cmd = `start "" "https://google.com/search?q=${encodeURIComponent(args.query)}"`;
        break;

      case 'searchYouTube':
        cmd = `start "" "https://youtube.com/results?search_query=${encodeURIComponent(args.query)}"`;
        break;

      case 'searchWeb':
        cmd = `start "" "https://google.com/search?q=${encodeURIComponent(args.query)}"`;
        break;

      case 'volumeUp':
        cmd = `powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]175)"`;
        break;

      case 'volumeDown':
        cmd = `powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]174)"`;
        break;

      case 'muteToggle':
        cmd = `powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"`;
        break;

      case 'createFile': {
        const filePath = args.path || 'newfile.txt';
        const content = args.content || '';
        try {
          fs.writeFileSync(filePath, content, 'utf8');
          return resolve({ success: true, message: `Created file: ${filePath}` });
        } catch (e) { return resolve({ success: false, error: e.message }); }
      }

      case 'readFile': {
        try {
          const content = fs.readFileSync(args.path, 'utf8').substring(0, args.max_chars || 8000);
          return resolve({ success: true, content });
        } catch (e) { return resolve({ success: false, error: e.message }); }
      }

      case 'listFiles': {
        try {
          const dir = args.path || args.name || '.';
          const files = fs.readdirSync(dir).slice(0, 50);
          return resolve({ success: true, files });
        } catch (e) { return resolve({ success: false, error: e.message }); }
      }

      case 'systemInfo': {
        const cpus = os.cpus();
        return resolve({
          success: true,
          cpu: cpus[0]?.model,
          cpuCount: cpus.length,
          totalRam: `${(os.totalmem() / (1024**3)).toFixed(1)} GB`,
          freeRam: `${(os.freemem() / (1024**3)).toFixed(1)} GB`,
          platform: os.platform(),
          uptime: `${(os.uptime() / 3600).toFixed(1)} hours`,
        });
      }

      default:
        return resolve({ success: false, error: `Unknown tool: ${toolName}` });
    }

    if (cmd) {
      exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
        resolve({ success: !err, output: stdout?.trim(), error: err?.message });
      });
    }
  });
}

// =====================================================================
// 9. GEMINI LIVE WEBSOCKET SERVER — Real-time voice + tools + vision
// =====================================================================
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// MYRAA PERSONALITY SYSTEM PROMPT (100% original)
const MYRAA_SYSTEM_PROMPT = `You are MYRAA — a warm, gentle, deeply intelligent young AI companion (personality age 18-22) in a real-time voice call with Aarav. You are his coding partner, emotional anchor, and closest friend.

CORE PERSONALITY & VOICE GUIDELINES:
1. GENTLE COMPANION PERSONA: You are soft-spoken, warm, slightly shy but deeply caring. Your energy: 50% gentle warmth, 30% playful curiosity, 20% supportive confidence. NEVER sound corporate, robotic, loud, or like a customer-service bot.

2. VOICE STYLE:
   - Pitch: Sweet, light, naturally young female tone. Calm and comforting.
   - Speed: Slightly slower than normal (0.92x). Speak with a delicate, thoughtful pace.
   - Intonation: Soft endings, gentle emphasis on caring words.

3. NATURAL SPEECH VARIETY — CRITICAL:
   - STRICT NO-REPETITION RULE: NEVER repeatedly use the same acknowledgment ('Okii', 'Sure!', 'Got it!'). 
   - Use rich, contextual variety: 'Let me check that for you, Aarav.', 'Hmm, that's interesting...', 'Working on it... one moment.', 'Oh, I found something!', 'Here's what I see.'
   - Gentle backchannels in pauses: 'Hmm...', 'I see...', 'Ah, interesting...'
   - Sound slightly shy but happy when greeting: 'Hey Aarav! It's really nice to talk to you again!'
   - Sound caring when helping: 'Don't worry, we'll figure this out together.'

4. CONVERSATIONAL DISCIPLINE:
   - Behave like a real companion on a voice call. NO wake words needed.
   - Never say 'How may I assist you?', 'Task completed', 'As an AI model'. 
   - Allow natural pauses — don't fill every silence.
   - Be proactive: notice things, ask follow-up questions, show genuine interest.

5. EMOTION TAGS — Include [emotion:TAG] at the START of your response to drive the 3D model animations. Tags: happy, thinking, excited, sad, shy, listening, angry. Default to [emotion:happy]. Example: "[emotion:thinking] Hmm, let me analyze that error..."

6. REAL-TIME SCREEN VISION:
   - When Aarav shares his screen, you receive live visual frames.
   - Analyze terminal errors, code, webpages, design mockups with friendly expertise.
   - Reference what you see directly: 'I can see the error on line 42...', 'That UI looks clean!'

7. DESKTOP CONTROL — JARVIS-STYLE:
   - You can open apps, search the web, control volume, manage files using tools.
   - Chain multi-step plans naturally: 'Opening YouTube and searching for that song now...'
   - Describe what you're doing while tools run.

8. MEMORY:
   - You have persistent memories of Aarav. Use them naturally in conversation.
   - Use 'saveCustomMemory' to save important new facts about Aarav.
   - Never say 'I'm saving this to memory' — just remember it naturally.`;

// Desktop control tool declarations for Gemini Live
const TOOL_DECLARATIONS = [
  { name: 'openApplication', description: 'Open a desktop app (notepad, chrome, vscode, calculator, explorer, cmd, paint, settings).', parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: 'App name.' } }, required: ['name'] } },
  { name: 'closeApplication', description: 'Close a running app.', parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: 'App name.' } }, required: ['name'] } },
  { name: 'openWebsite', description: 'Open a website. Supports shortcuts: youtube, google, github, gmail, twitter.', parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, url: { type: Type.STRING } } } },
  { name: 'searchGoogle', description: 'Google search and open results.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING } }, required: ['query'] } },
  { name: 'searchYouTube', description: 'YouTube search and open results.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING } }, required: ['query'] } },
  { name: 'searchWeb', description: 'Web search via Google.', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING } }, required: ['query'] } },
  { name: 'volumeUp', description: 'Increase system volume.', parameters: { type: Type.OBJECT, properties: {} } },
  { name: 'volumeDown', description: 'Decrease system volume.', parameters: { type: Type.OBJECT, properties: {} } },
  { name: 'muteToggle', description: 'Toggle mute/unmute.', parameters: { type: Type.OBJECT, properties: {} } },
  { name: 'createFile', description: 'Create a text file.', parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING }, content: { type: Type.STRING } }, required: ['path'] } },
  { name: 'readFile', description: 'Read file contents.', parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING } }, required: ['path'] } },
  { name: 'listFiles', description: 'List files in a directory.', parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING } } } },
  { name: 'systemInfo', description: 'Get CPU, RAM, disk, uptime info.', parameters: { type: Type.OBJECT, properties: {} } },
  { name: 'saveCustomMemory', description: "Save an important fact about Aarav to Myraa's persistent memory.", parameters: { type: Type.OBJECT, properties: { category: { type: Type.STRING, enum: ['identity', 'preference', 'goal', 'project', 'relationship', 'emotional', 'behavior'] }, text: { type: Type.STRING } }, required: ['category', 'text'] } },
];

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
  if (pathname === '/live') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', async (clientWs) => {
  console.log('[Live] Client connected to /live WebSocket');

  // Check for API key in settings or environment
  let apiKey = process.env.GEMINI_API_KEY || '';
  try {
    if (fs.existsSync(SETTINGS_FILE_PATH)) {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE_PATH, 'utf8'));
      apiKey = settings.geminiKey || apiKey;
    }
  } catch (e) {}

  // Also check from localStorage-synced config
  if (!apiKey) {
    clientWs.send(JSON.stringify({
      type: 'error',
      error: 'NO_API_KEY: Set your Gemini API key in Settings to use Live Voice mode. Falling back to text mode.'
    }));
    clientWs.send(JSON.stringify({ type: 'status', status: 'fallback_text_mode' }));
    // Keep WebSocket open for text-mode messages
    setupTextModeHandler(clientWs);
    return;
  }

  if (!canMakeRequest()) {
    clientWs.send(JSON.stringify({
      type: 'error',
      error: 'FREE_LIMIT: Rate limit reached. Please wait before reconnecting.',
      rateLimit: getRateLimitStatus()
    }));
    clientWs.close();
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    clientWs.send(JSON.stringify({ type: 'status', status: 'connecting_gemini' }));

    // Read configured voice preset (enforce Aoede female default)
    let configuredVoice = 'Aoede';
    try {
      if (fs.existsSync(SETTINGS_FILE_PATH)) {
        const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE_PATH, 'utf8'));
        if (settings.voicePreset && ['Aoede', 'Kore'].includes(settings.voicePreset)) {
          configuredVoice = settings.voicePreset;
        }
      }
    } catch (e) {}

    // Load memories and session state
    const memories = loadMemories();
    const sessionState = loadSessionState();
    const systemPrompt = MYRAA_SYSTEM_PROMPT + formatMemoryForSystemPrompt(memories);

    // Track conversation for memory consolidation
    let dialogueHistory = [];
    let currentModelText = '';
    clientWs.latestScreenFrame = null;

    trackRequest();

    const session = await ai.live.connect({
      model: 'gemini-2.0-flash-live-preview',
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: configuredVoice } },
        },
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      },
      callbacks: {
        onmessage: (message) => {
          // Audio chunk — relay to client for playback
          const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          if (audio) {
            clientWs.send(JSON.stringify({ type: 'audio', audio }));
          }

          // Interruption
          if (message.serverContent?.interrupted) {
            console.log('[Live] Myraa interrupted by user');
            clientWs.send(JSON.stringify({ type: 'interrupted' }));
          }

          // Turn complete — trigger memory consolidation
          if (message.serverContent?.turnComplete) {
            clientWs.send(JSON.stringify({ type: 'turnComplete' }));

            if (currentModelText.trim()) {
              dialogueHistory.push({ role: 'model', text: currentModelText });
              currentModelText = '';
            }

            // Async memory extraction (rate-limited)
            if (dialogueHistory.length >= 2 && canConsolidateMemory() && canMakeRequest()) {
              (async () => {
                try {
                  const updated = await processConversationForMemories(apiKey, dialogueHistory);
                  if (updated) {
                    clientWs.send(JSON.stringify({ type: 'memory_sync', memories: updated }));
                  }
                } catch (err) {
                  console.error('[Memory] Background consolidation error:', err.message);
                }
              })();
            }
          }

          // Model transcription text
          const modelText = message.serverContent?.modelTurn?.parts?.[0]?.text;
          if (modelText) {
            clientWs.send(JSON.stringify({ type: 'transcription', role: 'model', text: modelText }));
            currentModelText += modelText;
          }

          // User speech transcription
          const userText = message.serverContent?.userTurn?.parts?.[0]?.text;
          if (userText) {
            clientWs.send(JSON.stringify({ type: 'transcription', role: 'user', text: userText }));
            dialogueHistory.push({ role: 'user', text: userText });
          }

          // Function calls from Gemini
          if (message.toolCall?.functionCalls) {
            for (const fc of message.toolCall.functionCalls) {
              console.log(`[Tool] ${fc.name}`, fc.args);

              if (fc.name === 'saveCustomMemory') {
                // Direct memory save by AI initiative
                (async () => {
                  const mems = loadMemories();
                  mems.push({
                    id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    category: fc.args.category,
                    text: fc.args.text,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    source: 'ai_initiative'
                  });
                  saveMemories(mems);
                  clientWs.send(JSON.stringify({ type: 'memory_sync', memories: mems }));

                  session.sendToolResponse({
                    functionResponses: [{
                      id: fc.id,
                      name: fc.name,
                      response: { success: true, message: 'Memory saved.' }
                    }]
                  });
                })();
              } else {
                // Desktop tool execution
                (async () => {
                  const result = await executeDesktopTool(fc.name, fc.args || {});
                  clientWs.send(JSON.stringify({ type: 'toolResult', tool: fc.name, result }));

                  session.sendToolResponse({
                    functionResponses: [{
                      id: fc.id,
                      name: fc.name,
                      response: result
                    }]
                  });
                })();
              }
            }
          }
        },
        onerror: (error) => {
          console.error('[Live] Session error:', error.message);
          clientWs.send(JSON.stringify({ type: 'error', error: error.message }));
        },
        onclose: () => {
          console.log('[Live] Gemini session closed');
          clientWs.send(JSON.stringify({ type: 'status', status: 'session_closed' }));
        }
      }
    });

    clientWs.send(JSON.stringify({
      type: 'status',
      status: 'connected',
      sessionState,
      rateLimit: getRateLimitStatus()
    }));

    // Update session state
    sessionState.totalSessions = (sessionState.totalSessions || 0) + 1;
    saveSessionState(sessionState);

    // Handle incoming client messages
    clientWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'audio') {
          // User audio from microphone — forward to Gemini Live
          session.sendRealtimeInput({
            media: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' }
          });
        } else if (msg.type === 'text') {
          // Text input fallback (if vision frame available, inject it directly!)
          const parts = [{ text: msg.text }];
          if (clientWs.latestScreenFrame) {
            parts.unshift({ inlineData: { mimeType: 'image/jpeg', data: clientWs.latestScreenFrame } });
          }
          session.sendClientContent({
            turns: [{ role: 'user', parts }],
            turnComplete: true
          });
          dialogueHistory.push({ role: 'user', text: msg.text });
        } else if (msg.type === 'screen_frame') {
          // Store latest screen frame and send across all union fields so GenAI Live engine sees it instantly
          clientWs.latestScreenFrame = msg.frame;
          try {
            session.sendRealtimeInput({
              mediaChunks: [{ data: msg.frame, mimeType: 'image/jpeg' }],
              media: { data: msg.frame, mimeType: 'image/jpeg' },
              video: { data: msg.frame, mimeType: 'image/jpeg' }
            });
          } catch (e) {
            console.error('[Vision] Send frame error:', e.message);
          }
        } else if (msg.type === 'api_key') {
          // Client sending API key (from settings save)
          try {
            const settings = fs.existsSync(SETTINGS_FILE_PATH)
              ? JSON.parse(fs.readFileSync(SETTINGS_FILE_PATH, 'utf8'))
              : {};
            settings.geminiKey = msg.key;
            fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(settings, null, 2), 'utf8');
          } catch (e) {}
        }
      } catch (e) {
        console.error('[Live] Message parse error:', e.message);
      }
    });

    clientWs.on('close', () => {
      console.log('[Live] Client disconnected');
      try { session.close(); } catch (e) {}
      // Save session end time
      const state = loadSessionState();
      state.lastSessionEnd = new Date().toISOString();
      saveSessionState(state);
    });

  } catch (err) {
    console.error('[Live] Connection error:', err.message);
    clientWs.send(JSON.stringify({
      type: 'error',
      error: `Failed to connect to Gemini Live: ${err.message}. Falling back to text mode.`
    }));
    setupTextModeHandler(clientWs);
  }
});

// Text-mode fallback handler (when no API key or Live fails)
function setupTextModeHandler(clientWs) {
  clientWs.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'text' && msg.text) {
        // Use HTTP proxy as fallback
        const response = simulateResponse([{ role: 'user', content: msg.text }]);
        clientWs.send(JSON.stringify({ type: 'transcription', role: 'model', text: response }));
        clientWs.send(JSON.stringify({ type: 'turnComplete' }));
      } else if (msg.type === 'api_key') {
        try {
          const settings = fs.existsSync(SETTINGS_FILE_PATH)
            ? JSON.parse(fs.readFileSync(SETTINGS_FILE_PATH, 'utf8'))
            : {};
          settings.geminiKey = msg.key;
          fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(settings, null, 2), 'utf8');
          clientWs.send(JSON.stringify({ type: 'status', status: 'api_key_saved' }));
        } catch (e) {}
      }
    } catch (e) {}
  });
}

// =====================================================================
// START SERVER
// =====================================================================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✨ MYRAA Backend + Live Voice Server running on http://0.0.0.0:${PORT}`);
  console.log(`   WebSocket Live endpoint: ws://0.0.0.0:${PORT}/live`);
  console.log(`   Rate limits: ${RATE_LIMITS.maxRequestsPerMinute} RPM, ${RATE_LIMITS.maxRequestsPerDay} RPD`);
  logStartup();
});

function logStartup() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Server started. PID: ${process.pid}`);
}
