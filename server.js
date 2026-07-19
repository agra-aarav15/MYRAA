import express from 'express';
import cors from 'cors';
import { exec, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const MEMORY_FILE_PATH = path.join(__dirname, 'memories.json');
const SETTINGS_FILE_PATH = path.join(__dirname, 'settings.json');

// Initialize default memories file if not exists
if (!fs.existsSync(MEMORY_FILE_PATH)) {
  const defaultMemories = [
    {
      id: 'mem_1',
      category: 'identity',
      text: 'User enjoys programming, web development, and creating intelligent software.',
      createdAt: new Date().toISOString()
    },
    {
      id: 'mem_2',
      category: 'preference',
      text: 'Prefers a warm, intelligent, loving AI companion with a minimal clean obsidian design.',
      createdAt: new Date().toISOString()
    }
  ];
  fs.writeFileSync(MEMORY_FILE_PATH, JSON.stringify(defaultMemories, null, 2), 'utf8');
}

// 1. Health check & System Diagnostic Status
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
    toolCount: 12,
    timestamp: new Date().toISOString()
  });
});

// 2. Desktop Screen Capture Endpoint using Native PowerShell
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
      console.error('Screen capture error:', error);
      return res.status(500).json({ error: 'Failed to capture screenshot', details: stderr || error.message });
    }

    const base64Data = stdout.trim();
    res.json({
      success: true,
      mimeType: 'image/jpeg',
      data: `data:image/jpeg;base64,${base64Data}`,
      timestamp: new Date().toISOString()
    });
  });
});

// 3. Command Execution Endpoint
app.post('/api/system/execute', (req, res) => {
  const { command, cwd = process.cwd() } = req.body;
  if (!command) {
    return res.status(400).json({ error: 'Command is required' });
  }

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

// 4. System & OS Control Automation
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
      res.json({ success: true, message: `Opened URL ${target}` });
    });
  } else if (action === 'send_keys') {
    const script = `
      $wshell = New-Object -ComObject WScript.Shell
      $wshell.SendKeys('${target.replace(/'/g, "''")}')
    `;
    exec(`powershell -NoProfile -Command "${script.replace(/\n/g, ' ')}"`, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, message: `Keys sent` });
    });
  } else {
    res.status(400).json({ error: `Unknown action: ${action}` });
  }
});

// 5. Windows Auto-Start Registry Toggle (Silent Startup)
app.post('/api/settings/autostart', (req, res) => {
  const { autoStart } = req.body;
  const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  const appName = 'MYRAA_Assistant';
  const execPath = `"${process.execPath}" "${path.join(__dirname, 'server.js')}"`;

  if (autoStart) {
    exec(`reg add "${regKey}" /v "${appName}" /t REG_SZ /d "${execPath}" /f`, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, message: 'Auto-start enabled in Windows registry' });
    });
  } else {
    exec(`reg delete "${regKey}" /v "${appName}" /f`, (err) => {
      res.json({ success: true, message: 'Auto-start disabled' });
    });
  }
});

// 6. Categorized Memory Management CRUD Endpoints
app.get('/api/memory/all', (req, res) => {
  try {
    if (fs.existsSync(MEMORY_FILE_PATH)) {
      const data = fs.readFileSync(MEMORY_FILE_PATH, 'utf8');
      return res.json(JSON.parse(data));
    }
    res.json([]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read memory file' });
  }
});

app.post('/api/memory/add', (req, res) => {
  try {
    const { category = 'identity', text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Memory text is required' });
    }

    let memories = [];
    if (fs.existsSync(MEMORY_FILE_PATH)) {
      memories = JSON.parse(fs.readFileSync(MEMORY_FILE_PATH, 'utf8'));
    }

    const newMemory = {
      id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      category,
      text: text.trim(),
      createdAt: new Date().toISOString()
    };

    memories.push(newMemory);
    fs.writeFileSync(MEMORY_FILE_PATH, JSON.stringify(memories, null, 2), 'utf8');

    res.json({ success: true, memory: newMemory, memories });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save memory' });
  }
});

app.post('/api/memory/delete', (req, res) => {
  try {
    const { id } = req.body;
    let memories = [];
    if (fs.existsSync(MEMORY_FILE_PATH)) {
      memories = JSON.parse(fs.readFileSync(MEMORY_FILE_PATH, 'utf8'));
    }

    const filtered = memories.filter(m => m.id !== id);
    fs.writeFileSync(MEMORY_FILE_PATH, JSON.stringify(filtered, null, 2), 'utf8');

    res.json({ success: true, memories: filtered });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete memory' });
  }
});

// 7. Universal AI Provider Proxy Endpoint
app.post('/api/ai/proxy', async (req, res) => {
  const { provider, apiKey, baseUrl, model, messages, maxTokens = 1000, temperature = 0.7 } = req.body;

  try {
    let endpointUrl = '';
    let headers = { 'Content-Type': 'application/json' };
    let bodyPayload = {};

    if (provider === 'groq') {
      endpointUrl = 'https://api.groq.com/openai/v1/chat/completions';
      headers['Authorization'] = `Bearer ${apiKey}`;
      bodyPayload = {
        model: model || 'llama-3.3-70b-versatile',
        messages,
        temperature,
        max_tokens: maxTokens
      };
    } else if (provider === 'grok') {
      endpointUrl = 'https://api.x.ai/v1/chat/completions';
      headers['Authorization'] = `Bearer ${apiKey}`;
      bodyPayload = {
        model: model || 'grok-beta',
        messages,
        temperature,
        max_tokens: maxTokens
      };
    } else if (provider === 'openai') {
      endpointUrl = 'https://api.openai.com/v1/chat/completions';
      headers['Authorization'] = `Bearer ${apiKey}`;
      bodyPayload = {
        model: model || 'gpt-4o',
        messages,
        temperature,
        max_tokens: maxTokens
      };
    } else if (provider === 'gemini') {
      const geminiModel = model || 'gemini-2.5-flash';
      endpointUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;
      
      const contents = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : (m.role === 'system' ? 'user' : m.role),
        parts: Array.isArray(m.content) 
          ? m.content.map(c => {
              if (c.type === 'image_url') {
                const base64Str = c.image_url.url.split(',')[1];
                const mimeType = c.image_url.url.split(';')[0].replace('data:', '');
                return { inline_data: { mime_type: mimeType, data: base64Str } };
              }
              return { text: c.text || c };
            })
          : [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
      }));

      const geminiResponse = await fetch(endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents, generationConfig: { temperature, maxOutputTokens: maxTokens } })
      });

      const data = await geminiResponse.json();
      if (data.error) {
        return res.status(400).json({ error: data.error.message || 'Gemini API Error' });
      }

      const textOutput = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return res.json({
        choices: [{ message: { role: 'assistant', content: textOutput } }]
      });
    } else if (provider === 'custom') {
      const targetBase = (baseUrl || 'http://localhost:11434/v1').replace(/\/$/, '');
      endpointUrl = `${targetBase}/chat/completions`;
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      bodyPayload = {
        model: model || 'llama3',
        messages,
        temperature,
        max_tokens: maxTokens
      };
    } else {
      return res.status(400).json({ error: `Unsupported provider: ${provider}` });
    }

    const aiRes = await fetch(endpointUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload)
    });

    const data = await aiRes.json();
    if (!aiRes.ok) {
      return res.status(aiRes.status).json({ error: data.error?.message || data.error || 'AI Provider Error' });
    }

    res.json(data);
  } catch (err) {
    console.error('AI Proxy Error:', err);
    res.status(500).json({ error: 'Failed to connect to AI provider', details: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`MYRAA Desktop Control & Vision Backend running on http://0.0.0.0:${PORT}`);
});
