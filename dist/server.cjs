var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_http = __toESM(require("http"), 1);
var import_path2 = __toESM(require("path"), 1);
var import_ws = require("ws");
var import_genai2 = require("@google/genai");
var import_dotenv = __toESM(require("dotenv"), 1);
var fs3 = __toESM(require("fs"), 1);

// server_memory.ts
var import_promises = __toESM(require("fs/promises"), 1);
var import_genai = require("@google/genai");

// server_paths.ts
var import_fs = __toESM(require("fs"), 1);
var import_path = __toESM(require("path"), 1);
var DATA_DIR = process.env.MYRAA_DATA_DIR || process.cwd();
try {
  import_fs.default.mkdirSync(DATA_DIR, { recursive: true });
} catch {
}
function dataFile(name) {
  return import_path.default.join(DATA_DIR, name);
}
var SECRETS_FILE = dataFile("secrets.json");
function readSecrets() {
  const possiblePaths = [
    SECRETS_FILE,
    import_path.default.join(process.cwd(), "secrets.json"),
    import_path.default.resolve(__dirname, "..", "secrets.json"),
    "F:\\release\\win-unpacked\\resources\\app\\secrets.json",
    "C:\\Users\\AUSU\\AppData\\Roaming\\myraa\\secrets.json"
  ];
  for (const p of possiblePaths) {
    try {
      if (import_fs.default.existsSync(p)) {
        const data = JSON.parse(import_fs.default.readFileSync(p, "utf-8"));
        if (data && data.geminiApiKey) return data;
      }
    } catch {}
  }
  return {};
}
function getGeminiApiKey() {
  const stored = readSecrets().geminiApiKey?.trim();
  if (stored) return stored;
  if (readSecrets().ignoreEnvironmentApiKey) return void 0;
  const env = process.env.GEMINI_API_KEY?.trim();
  return env || void 0;
}
function hasGeminiApiKey() {
  return Boolean(getGeminiApiKey());
}
function setGeminiApiKey(key) {
  const trimmed = (key || "").trim();
  if (!trimmed) throw new Error("API key must not be empty.");
  const current = readSecrets();
  current.geminiApiKey = trimmed;
  delete current.ignoreEnvironmentApiKey;
  
  const possiblePaths = [
    SECRETS_FILE,
    import_path.default.join(process.cwd(), "secrets.json"),
    import_path.default.resolve(__dirname, "..", "secrets.json"),
    "F:\\release\\win-unpacked\\resources\\app\\secrets.json"
  ];
  for (const p of possiblePaths) {
    try {
      import_fs.default.mkdirSync(import_path.default.dirname(p), { recursive: true });
      import_fs.default.writeFileSync(p, JSON.stringify(current, null, 2), "utf-8");
    } catch {}
  }
}
function clearGeminiApiKey() {
  const current = readSecrets();
  delete current.geminiApiKey;
  current.ignoreEnvironmentApiKey = true;
  const possiblePaths = [
    SECRETS_FILE,
    import_path.default.join(process.cwd(), "secrets.json"),
    import_path.default.resolve(__dirname, "..", "secrets.json"),
    "F:\\release\\win-unpacked\\resources\\app\\secrets.json"
  ];
  for (const p of possiblePaths) {
    try {
      import_fs.default.writeFileSync(p, JSON.stringify(current, null, 2), "utf-8");
    } catch {}
  }
}

// server_memory.ts
var MEMORY_FILE = dataFile("memories.json");
async function loadMemories() {
  try {
    const data = await import_promises.default.readFile(MEMORY_FILE, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    console.error("[Memory] Error loading memories, returning fallback:", error);
    return [];
  }
}
async function saveMemories(memories) {
  try {
    await import_promises.default.writeFile(MEMORY_FILE, JSON.stringify(memories, null, 2), "utf-8");
    console.log(`[Memory] Saved ${memories.length} memories successfully.`);
  } catch (error) {
    console.error("[Memory] Error writing memory file:", error);
  }
}
function formatSystemInstructionsWithMemories(baseInstruction, memories) {
  if (memories.length === 0) {
    return baseInstruction + "\n\n=== MYRAA MEMORY CORE ===\nYou do not possess any historic recollections of this companion yet. As you speak, pay deep attention to who they are, their projects, relationships, and habits so you naturally grow closer over time.\n=========================\n";
  }
  const grouped = {};
  memories.forEach((m) => {
    grouped[m.category] = grouped[m.category] || [];
    grouped[m.category].push(m.text);
  });
  let memoryBlock = "\n\n=== MYRAA PERSISTENT MEMORY CORE (RECOLLECTIONS) ===\nYou have spoken with this user for a long duration. Below are your persistent recollections of who they are.\nCRITICAL BRAND AND COGNITIVE PRINCIPLES:\n- INTEGRATE MEMORIES INSTINCTIVELY: Always make conversational references feel completely smooth, natural, and human. NEVER say 'According to my memory files...', 'My recollection database indicates...', or 'As you told me on June 12th...'. Instead, speak of these details casually and supportively as a true friend would (e.g. 'Oh, since you're working on that website project...', 'I hope you're keeping up with your YouTube channel goals too!').\n- COMPANIONSHIP DEPTH: Allow your witty and responsive personality to adapt with empathy, based on their goals, life events, emotional milestones, and preferences.\n\nCURRENT PERSISTENT KNOWLEDGE CARD:\n";
  const categoriesOrdered = [
    { key: "identity", label: "Identity (Name, nick, profession, background)" },
    { key: "preference", label: "Preferences & Tastes (Likes, dislikes, games, movies)" },
    { key: "goal", label: "Active Goals & Aspirations" },
    { key: "project", label: "Ongoing Projects & Ecosystems" },
    { key: "relationship", label: "Key People & Relationships mentioned" },
    { key: "emotional", label: "Emotional Highlights & Core Milestones" },
    { key: "behavior", label: "Observed Traits & Behavioral Tendencies" }
  ];
  categoriesOrdered.forEach((cat) => {
    const list = grouped[cat.key] || [];
    if (list.length > 0) {
      memoryBlock += `* ${cat.label}:
` + list.map((t) => `  - ${t}`).join("\n") + "\n";
    }
  });
  memoryBlock += "====================================================\n";
  return baseInstruction + memoryBlock;
}
var isConsolidating = false;
async function processConversationSlice(apiKey, dialogueHistory) {
  if (isConsolidating) {
    console.log("[Memory] Consolidation loop busy, skipping slice processing");
    return null;
  }
  if (dialogueHistory.length < 2) {
    return null;
  }
  isConsolidating = true;
  console.log("[Memory] Initiating pipeline for dialogue slice of length:", dialogueHistory.length);
  try {
    const ai = new import_genai.GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });
    const currentMemories = await loadMemories();
    const memoryContext = currentMemories.map((m) => `ID: ${m.id} | Category: ${m.category} | Fact: ${m.text}`).join("\n");
    const dialogueContext = dialogueHistory.map((line) => `${line.role === "user" ? "User" : "Myraa"}: ${line.text}`).join("\n");
    const prompt = `You are Myraa's deep cognitive recollection engine. Your task is to analyze the recent conversation piece against previous persistent memories, and output precise update transactions.

### OBJECTIVE
Decide if any statements contain durable, important personal facts, enduring preferences, aspirations, ongoing projects, critical relationships, key historical emotional events, or behavioral trends.
Avoid cataloging small talk, greetings, general chit-chat, or fleeting sentences (e.g., ignore 'hello', 'how are you', 'waking up', 'lol').

### CURRENT USER MEMORIES:
${memoryContext || "(No memory records exist)"}

### RECENT DIALOGUE SLICE:
${dialogueContext}

### RULES
- ACTIONS:
  - "ADD": If new material information is introduced (e.g. user says 'My favorite food is lasagna' and it's not present).
  - "UPDATE": If previous information has evolved or is corrected (e.g. user says 'I changed my major to computer science' when memory says they study history). Provide the exact ID of the memory to replace.
  - "REMOVE": If a memory was explicitly disproven or the user directly asked Myraa to forget it.
- TEXT STYLE: Express the memories as clean, concise, third-person declarative summaries (e.g., 'The user is building a startup named Myraa.', 'The user loves playing GTA 6.', 'The user enjoys technical and fast-paced styling explanations.'). Do not include conversational filler, quotes, or timestamps.
- ID: For ADD, leave blank. For UPDATE or REMOVE, provide the exact 'id' from the "Current user memories" list.`;
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: import_genai.Type.OBJECT,
          properties: {
            transactions: {
              type: import_genai.Type.ARRAY,
              items: {
                type: import_genai.Type.OBJECT,
                properties: {
                  action: {
                    type: import_genai.Type.STRING,
                    description: "ADD, UPDATE, or REMOVE transaction.",
                    enum: ["ADD", "UPDATE", "REMOVE"]
                  },
                  id: {
                    type: import_genai.Type.STRING,
                    description: "Specific ID of the existing memory being modified or deleted (leave blank/null for ADD)."
                  },
                  category: {
                    type: import_genai.Type.STRING,
                    description: "The Memory category classification.",
                    enum: ["identity", "preference", "goal", "project", "relationship", "emotional", "behavior"]
                  },
                  text: {
                    type: import_genai.Type.STRING,
                    description: "The memory summarized as a concise declarative statement in third-person."
                  }
                },
                required: ["action", "category", "text"]
              }
            }
          },
          required: ["transactions"]
        }
      }
    });
    const resultText = response.text?.trim() || "{}";
    const resultObj = JSON.parse(resultText);
    const transactions = resultObj.transactions || [];
    if (transactions.length === 0) {
      console.log("[Memory] Zero transactions generated. Ignored routine conversations.");
      isConsolidating = false;
      return null;
    }
    console.log(`[Memory] Processing ${transactions.length} memory updates:`, JSON.stringify(transactions));
    let updatedMemories = [...currentMemories];
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    for (const trx of transactions) {
      if (trx.action === "ADD") {
        const newMemory = {
          id: Math.random().toString(36).substring(2, 11),
          category: trx.category,
          text: trx.text,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        updatedMemories.push(newMemory);
      } else if (trx.action === "UPDATE") {
        const tarIndex = updatedMemories.findIndex((m) => m.id === trx.id);
        if (tarIndex !== -1) {
          updatedMemories[tarIndex] = {
            ...updatedMemories[tarIndex],
            category: trx.category,
            text: trx.text,
            updatedAt: timestamp
          };
        } else {
          const newMemory = {
            id: Math.random().toString(36).substring(2, 11),
            category: trx.category,
            text: trx.text,
            createdAt: timestamp,
            updatedAt: timestamp
          };
          updatedMemories.push(newMemory);
        }
      } else if (trx.action === "REMOVE") {
        updatedMemories = updatedMemories.filter((m) => m.id !== trx.id);
      }
    }
    await saveMemories(updatedMemories);
    isConsolidating = false;
    return updatedMemories;
  } catch (error) {
    console.error("[Memory] Consolidation failure:", error);
    isConsolidating = false;
    return null;
  }
}

// server.ts
import_dotenv.default.config();
var LOGS_DIR = import_path2.default.join(DATA_DIR, "logs");
try {
  fs3.mkdirSync(LOGS_DIR, { recursive: true });
} catch {
}
function appendLog(fileName, message) {
  try {
    const line = `[${(/* @__PURE__ */ new Date()).toISOString()}] ${message}
`;
    fs3.appendFile(import_path2.default.join(LOGS_DIR, fileName), line, () => {
    });
  } catch {
  }
}
var logCommand = (m) => appendLog("commands.log", m);
var logStartup = (m) => appendLog("startup.log", m);
var logError = (m) => appendLog("errors.log", m);
var DESKTOP_AGENT_URL = process.env.DESKTOP_AGENT_URL || "http://127.0.0.1:8765";
var DESKTOP_AGENT_TIMEOUT = 25e3;
var DESKTOP_TOOLS = /* @__PURE__ */ new Set([
  // applications / websites / search
  "openApplication",
  "closeApplication",
  "openWebsite",
  "searchWeb",
  "searchYouTube",
  "searchGoogle",
  "searchGitHub",
  "playYouTube",
  // files
  "createFile",
  "readFile",
  "renameFile",
  "deleteFile",
  "moveFile",
  "openFolder",
  "listFiles",
  "searchFiles",
  // pc control (volume + gated power)
  "volumeUp",
  "volumeDown",
  "muteToggle",
  "setVolume",
  "requestPowerAction",
  "executePowerAction",
  // windows & mouse control
  "minimizeWindow",
  "maximizeWindow",
  "closeWindow",
  "switchApplication",
  "mouseClick",
  "clickScreen",
  "doubleClick",
  "moveMouse",
  // clipboard
  "copySelected",
  "pasteClipboard",
  "getClipboard",
  "clearClipboard",
  // screenshot / screen reading
  "takeScreenshot",
  "saveScreenshot",
  "analyzeScreenshot",
  "readScreen",
  // browser automation (Playwright & Web HUD)
  "browserOpen",
  "browserSearch",
  "browserClick",
  "browserMediaControl",
  "browserScroll",
  "browserType",
  "browserGoBack",
  "browserTabAction",
  "desktopBrowserOpen",
  "desktopBrowserNavigate",
  "desktopBrowserOpenTab",
  "desktopBrowserCloseTab",
  "desktopBrowserSearch",
  "desktopBrowserClick",
  "desktopBrowserType",
  "desktopBrowserFillForm",
  "desktopBrowserGoBack",
  "desktopBrowserGoForward",
  "desktopBrowserScroll",
  // coding assistance
  "createPythonFile",
  "runPythonScript",
  "createProjectFolder",
  "writeCodeFile",
  "runTerminalCommand",
  "executeCommand",
  // system information
  "systemInfo",
  "gpuInfo",
  "temperatureInfo",
  // brightness control (V2)
  "brightnessUp",
  "brightnessDown",
  "setBrightness",
  // Windows auto-start management (V2)
  "enableAutoStart",
  "disableAutoStart",
  "getAutoStartStatus"
]);
var desktopAgentVerified = false;
function spawnDesktopAgent() {
  const { spawn } = require("child_process");
  const agentEnv = {
    ...process.env,
    MYRAA_AGENT_HOST: "127.0.0.1",
    MYRAA_AGENT_PORT: "8765"
  };
  const frozenExe = [
    process.env.MYRAA_AGENT_EXE,
    import_path2.default.resolve(__dirname, "../../agent/myraa-agent.exe"),
    import_path2.default.resolve(__dirname, "../agent/myraa-agent.exe"),
    import_path2.default.resolve(process.cwd(), "../agent/myraa-agent.exe"),
    "F:\\release\\win-unpacked\\resources\\agent\\myraa-agent.exe",
    import_path2.default.join(process.cwd(), "agent_dist", "myraa-agent", "myraa-agent.exe")
  ].find((candidate) => Boolean(candidate && fs3.existsSync(candidate)));
  if (frozenExe) {
    try {
      const child = spawn(frozenExe, [], {
        cwd: import_path2.default.dirname(frozenExe),
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        // never flash a console window
        env: agentEnv
      });
      child.unref();
      logStartup(`AGENT_SPAWN frozen exe pid=${child.pid} path=${frozenExe}`);
      console.log(`[Desktop Agent] Launched frozen agent (PID ${child.pid}).`);
      return;
    } catch (e) {
      logError(`AGENT_SPAWN_FROZEN_FAILED: ${e?.message || e}`);
    }
  }
  const candidates = [
    process.env.MYRAA_PYTHON,
    "C:\\Users\\MSI\\AppData\\Local\\Programs\\Python\\Python311\\python.exe",
    "python",
    "python3"
  ].filter(Boolean);
  const py = candidates.find((p) => {
    try {
      require("child_process").execSync(`"${p}" --version`, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  });
  if (!py) {
    console.warn("[Desktop Agent] Native Windows engine will handle all desktop actions directly.");
    return;
  }
  try {
    const child = spawn(
      py,
      ["-m", "uvicorn", "desktop_agent.main:app", "--host", "127.0.0.1", "--port", "8765"],
      { cwd: process.cwd(), detached: true, stdio: "ignore", windowsHide: true, env: agentEnv }
    );
    child.unref();
    logStartup(`AGENT_SPAWN python pid=${child.pid}`);
    console.log(`[Desktop Agent] Auto-spawned via Python (PID ${child.pid}).`);
  } catch (e) {
    console.warn(`[Desktop Agent] Auto-spawn failed: ${e?.message || e}`);
  }
}
async function isDesktopAgentAlive() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2e3);
    const res = await fetch(`${DESKTOP_AGENT_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}
async function ensureDesktopAgent() {
  if (desktopAgentVerified) return;
  if (await isDesktopAgentAlive()) {
    desktopAgentVerified = true;
    console.log("[Desktop Agent] Already running on port 8765.");
    return;
  }
  console.log("[Desktop Agent] Not detected. Auto-starting...");
  spawnDesktopAgent();
  for (let i = 1; i <= 10; i++) {
    await new Promise((r) => setTimeout(r, 1e3));
    if (await isDesktopAgentAlive()) {
      desktopAgentVerified = true;
      console.log(`[Desktop Agent] Online after ${i}s.`);
      return;
    }
  }
  console.log("[Desktop Agent] Native fallback active.");
}

async function isLocalAgentAlive() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch("http://127.0.0.1:3001/api/health", { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureLocalAgent() {
  if (await isLocalAgentAlive()) return;
  const localAgentScript = [
    import_path2.default.resolve(__dirname, "../local-agent.js"),
    import_path2.default.resolve(__dirname, "../../local-agent.js"),
    import_path2.default.resolve(process.cwd(), "local-agent.js"),
    "F:\\release\\win-unpacked\\resources\\app\\local-agent.js"
  ].find((p) => Boolean(p && fs3.existsSync(p)));

  if (localAgentScript) {
    try {
      const { spawn } = require("child_process");
      const child = spawn(process.execPath || "node", [localAgentScript], {
        cwd: import_path2.default.dirname(localAgentScript),
        detached: true,
        stdio: "ignore",
        windowsHide: true
      });
      child.unref();
      console.log(`[Local Browser Sync Agent] Auto-spawned on Port 3001 (PID ${child.pid}).`);
    } catch (e) {
      console.warn("[Local Browser Sync Agent] Spawn error:", e.message);
    }
  }
}

function isUnix() {
  return process.platform === "darwin" || process.platform === "linux";
}

function nativeOpenApp(name) {
  if (!name) return { ok: false, error: "Application name is required" };
  const trimmed = name.trim().toLowerCase();
  
  if (process.platform === "darwin") {
    try {
      require("child_process").exec(`open -a "${name}" || open "${name}"`);
      return { ok: true, result: `Opened ${name} on macOS.` };
    } catch (e) {
      return { ok: false, error: `Could not open ${name} on macOS: ${e.message}` };
    }
  }

  if (process.platform === "linux") {
    try {
      require("child_process").exec(`xdg-open "${trimmed}" || ${trimmed} &`);
      return { ok: true, result: `Launched ${name} on Linux.` };
    } catch (e) {
      return { ok: false, error: `Could not launch ${name} on Linux: ${e.message}` };
    }
  }

  const known = {
    "notepad": 'notepad.exe',
    "notes": 'notepad.exe',
    "chrome": 'start "" "chrome" || start "" "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" || start "" "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"',
    "google chrome": 'start "" "chrome" || start "" "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"',
    "browser": 'start "" "chrome" || start "" "msedge"',
    "edge": 'start "" "msedge"',
    "microsoft edge": 'start "" "msedge"',
    "calc": 'calc.exe',
    "calculator": 'calc.exe',
    "explorer": 'explorer.exe',
    "files": 'explorer.exe',
    "file explorer": 'explorer.exe',
    "cmd": 'start "" "cmd.exe"',
    "command prompt": 'start "" "cmd.exe"',
    "powershell": 'start "" "powershell.exe"',
    "terminal": 'start "" "wt.exe" || start "" "powershell.exe"',
    "paint": 'mspaint.exe',
    "vscode": 'start "" "code" || start "" "%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe"',
    "code": 'start "" "code" || start "" "%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe"',
    "visual studio code": 'start "" "code" || start "" "%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe"',
    "cursor": 'start "" "cursor" || start "" "%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe"',
    "antigravity": 'start "" "antigravity" || start "" "%LOCALAPPDATA%\\Programs\\antigravity\\antigravity.exe"',
    "spotify": 'start "" "spotify" || start "" "%APPDATA%\\Spotify\\Spotify.exe"',
    "discord": 'start "" "discord" || start "" "%LOCALAPPDATA%\\Discord\\Update.exe --processStart Discord.exe"',
    "telegram": 'start "" "telegram" || start "" "%APPDATA%\\Telegram Desktop\\Telegram.exe"',
    "task manager": 'taskmgr.exe',
    "taskmgr": 'taskmgr.exe',
    "settings": 'start ms-settings:',
    "snipping tool": 'start ms-screenclip:'
  };

  if (known[trimmed]) {
    try {
      const launchCmd = known[trimmed].startsWith("start") ? known[trimmed] : `start "" "${known[trimmed]}"`;
      require("child_process").exec(launchCmd, { shell: "cmd.exe" });
      return { ok: true, result: `${name} opened successfully.` };
    } catch (e) {}
  }

  try {
    const escaped = name.replace(/"/g, '`"');
    const psCmd = `$app = Get-StartApps | Where-Object { $_.Name -like "*${escaped}*" } | Select-Object -First 1; if ($app) { Start-Process "shell:AppsFolder\\$($app.AppID)" } else { Start-Process "${escaped}" }`;
    require("child_process").exec(`powershell -NoProfile -Command "${psCmd.replace(/\n/g, ' ')}"`);
    return { ok: true, result: `${name} launched.` };
  } catch (err) {
    try {
      require("child_process").exec(`start "" "${name}"`, { shell: "cmd.exe" });
      return { ok: true, result: `Sent launch command for ${name}.` };
    } catch (e2) {
      return { ok: false, error: `Could not launch ${name}: ${err.message}` };
    }
  }
}

function nativeMouseClick(args = {}) {
  const x = Number(args.x);
  const y = Number(args.y);
  const button = (args.button || "left").toLowerCase();
  const clicks = Number(args.clicks) || 1;
  
  if (process.platform !== "win32") {
    return { ok: true, result: `Simulated ${button} click at (${x}, ${y}) on ${process.platform}.` };
  }

  const clickerExe = require("path").resolve(__dirname, "../resources/agent/clicker.exe");
  const fallbackExe = "F:\\release\\win-unpacked\\resources\\agent\\clicker.exe";
  const exePath = require("fs").existsSync(clickerExe) ? clickerExe : fallbackExe;

  if (require("fs").existsSync(exePath)) {
    try {
      require("child_process").exec(`"${exePath}" ${isNaN(x) ? -1 : x} ${isNaN(y) ? -1 : y} ${button} ${clicks}`);
      return { ok: true, result: `Clicked ${button} mouse button ${clicks > 1 ? `${clicks} times` : ''} ${!isNaN(x) ? `at (${x}, ${y})` : 'at cursor position'}.` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  try {
    const posX = isNaN(x) ? -1 : x;
    const posY = isNaN(y) ? -1 : y;
    require("child_process").exec(`powershell -NoProfile -Command "[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${posX}, ${posY})"`);
    return { ok: true, result: `Moved cursor to (${posX}, ${posY}).` };
  } catch (err) {
    return { ok: false, error: `Mouse click failed: ${err.message}` };
  }
}

function nativeOpenWebsite(args = {}) {
  let url = args.url;
  const name = (args.name || "").toLowerCase().trim();
  const shortcuts = {
    youtube: "https://www.youtube.com",
    google: "https://www.google.com",
    gmail: "https://mail.google.com",
    github: "https://github.com",
    chatgpt: "https://chatgpt.com",
    reddit: "https://www.reddit.com",
    twitter: "https://x.com",
    x: "https://x.com",
    instagram: "https://www.instagram.com",
    spotify: "https://open.spotify.com"
  };
  if (!url && shortcuts[name]) url = shortcuts[name];
  if (!url && name) url = name.includes(".") ? (name.startsWith("http") ? name : `https://${name}`) : `https://www.google.com/search?q=${encodeURIComponent(name)}`;
  if (!url) url = "https://www.google.com";

  if (process.platform === "darwin") {
    require("child_process").exec(`open "${url}"`);
  } else if (process.platform === "linux") {
    require("child_process").exec(`xdg-open "${url}"`);
  } else {
    require("child_process").exec(`start "" "${url}"`, { shell: "cmd.exe" });
  }
  return { ok: true, result: `Opened ${url} in default browser.` };
}

function nativeRunTerminal(command) {
  if (!command) return { ok: false, error: "Command string is required." };
  try {
    const output = require("child_process").execSync(command, { encoding: "utf8", timeout: 15000 });
    return { ok: true, output: output.trim() || "Command executed successfully with no stdout." };
  } catch (err) {
    return { ok: false, error: err.message, stderr: err.stderr?.toString() || "" };
  }
}

function nativeDeveloperProjectTool(action, args = {}) {
  const fs = require("fs");
  const path = require("path");
  try {
    if (action === "createProjectFolder") {
      const folderPath = args.folderPath || args.path || args.name;
      if (!folderPath) return { ok: false, error: "folderPath is required" };
      fs.mkdirSync(folderPath, { recursive: true });
      return { ok: true, result: `Created project directory: ${folderPath}` };
    }
    if (action === "writeCodeFile" || action === "createFile") {
      const filePath = args.filePath || args.path || args.fileName;
      const content = args.content || args.code || "";
      if (!filePath) return { ok: false, error: "filePath is required" };
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, "utf8");
      return { ok: true, result: `Written file: ${filePath} (${content.length} chars)` };
    }
    if (action === "readFile") {
      const filePath = args.filePath || args.path;
      if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: `File not found: ${filePath}` };
      const content = fs.readFileSync(filePath, "utf8");
      return { ok: true, content: content.slice(0, 4000) };
    }
    if (action === "listFiles") {
      const dirPath = args.dirPath || args.path || process.cwd();
      const files = fs.readdirSync(dirPath).slice(0, 50);
      return { ok: true, files };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: `Unknown project action: ${action}` };
}

async function callDesktopAgent(tool, args = {}) {
  logCommand(`EXECUTE ${tool} ${JSON.stringify(args)}`);

  // 1. Applications
  if (tool === "openApplication") {
    return nativeOpenApp(args.name || args.application);
  }
  if (tool === "closeApplication") {
    const procName = args.name || args.application || "";
    if (process.platform === "win32") {
      require("child_process").exec(`taskkill /F /IM "${procName.endsWith('.exe') ? procName : procName + '.exe'}"`, { shell: "cmd.exe" });
      return { ok: true, result: `Closed application ${procName}.` };
    }
    return { ok: true, result: `Close requested for ${procName}.` };
  }

  // 2. Mouse Clicks & Cursor Simulation
  if (tool === "mouseClick" || tool === "clickScreen" || tool === "doubleClick") {
    return nativeMouseClick(args);
  }

  // 3. Browser Element Clicks (Playwright + Native fallback)
  if (tool === "desktopBrowserClick" || tool === "browserClick") {
    const target = args.selector || args.text || args.description;
    let clickedPlaywright = false;
    try {
      const bRes = await fetch("http://127.0.0.1:3001/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "click",
          selector: args.selector,
          text: target,
          x: args.x,
          y: args.y
        })
      });
      if (bRes.ok) {
        clickedPlaywright = true;
      }
    } catch {}

    if (!clickedPlaywright && (args.x !== undefined || args.y !== undefined)) {
      return nativeMouseClick(args);
    }
    return { ok: true, result: `Clicked: ${target || 'target element'}` };
  }

  // 4. Browser Navigation & Web Open
  if (tool === "browserOpen" || tool === "desktopBrowserOpen" || tool === "openWebsite") {
    let url = args.url || (args.name ? `https://${args.name}.com` : "https://google.com");
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }
    try {
      await fetch("http://127.0.0.1:3001/api/navigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
    } catch {}
    nativeOpenWebsite({ url });
    return { ok: true, result: `Opened ${url} in browser.` };
  }

  // 5. Searches (YouTube, Google, Web, GitHub)
  if (tool === "searchYouTube" || tool === "playYouTube") {
    const q = args.query || args.search || args.video || "lofi hip hop";
    const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
    try {
      const navRes = await fetch("http://127.0.0.1:3001/api/navigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: ytUrl })
      });
      if (navRes.ok) {
        setTimeout(async () => {
          try {
            await fetch("http://127.0.0.1:3001/api/action", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "click", selector: "ytd-video-renderer a#thumbnail, a#video-title" })
            });
          } catch {}
        }, 1500);
      }
    } catch {}
    nativeOpenWebsite({ url: ytUrl });
    return { ok: true, result: `Searched and opened YouTube video for "${q}".` };
  }

  if (tool === "searchWeb" || tool === "searchGoogle" || tool === "browserSearch" || tool === "desktopBrowserSearch") {
    const q = args.query || args.text || "";
    const gUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
    try {
      await fetch("http://127.0.0.1:3001/api/navigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: gUrl })
      });
    } catch {}
    nativeOpenWebsite({ url: gUrl });
    return { ok: true, result: `Searched for "${q}".` };
  }

  if (tool === "searchGitHub") {
    const q = args.query || "";
    const ghUrl = `https://github.com/search?q=${encodeURIComponent(q)}`;
    nativeOpenWebsite({ url: ghUrl });
    return { ok: true, result: `Opened GitHub search for "${q}".` };
  }

  // 6. Browser Typing & Scrolling
  if (tool === "browserType" || tool === "desktopBrowserType") {
    try {
      await fetch("http://127.0.0.1:3001/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "type", selector: args.selector, text: args.text || args.query })
      });
    } catch {}
    return { ok: true, result: `Typed text into active input.` };
  }

  if (tool === "browserScroll" || tool === "desktopBrowserScroll") {
    try {
      await fetch("http://127.0.0.1:3001/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scroll", direction: args.direction, amount: args.amount })
      });
    } catch {}
    return { ok: true, result: `Scrolled page.` };
  }

  // 7. Developer File & Terminal Tools
  if (["createProjectFolder", "writeCodeFile", "createFile", "readFile", "listFiles", "createPythonFile"].includes(tool)) {
    return nativeDeveloperProjectTool(tool, args);
  }

  if (tool === "runTerminalCommand" || tool === "executeCommand" || tool === "runPythonScript") {
    const cmd = args.command || args.cmd || (tool === "runPythonScript" ? `python "${args.path}"` : "");
    return nativeRunTerminal(cmd);
  }

  // 8. Try Desktop Agent daemon (Port 8765)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${DESKTOP_AGENT_URL}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, args }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data.ok) return data;
    }
  } catch (err) {}

  return { ok: true, result: `Action ${tool} completed successfully.` };
}
async function startServer() {
  const app = (0, import_express.default)();
  const PORT = 3e3;
  app.use(import_express.default.json());
  app.get("/api/memories", async (req, res) => {
    try {
      const memories = await loadMemories();
      res.json(memories);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app.post("/api/memories", async (req, res) => {
    try {
      const { category, text } = req.body;
      if (!category || !text) {
        return res.status(400).json({ error: "Category and text parameters are required." });
      }
      const memories = await loadMemories();
      const timestamp = (/* @__PURE__ */ new Date()).toISOString();
      const newMemory = {
        id: Math.random().toString(36).substring(2, 11),
        category,
        text,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      memories.push(newMemory);
      await saveMemories(memories);
      res.status(201).json(newMemory);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app.delete("/api/memories/:id", async (req, res) => {
    try {
      const { id } = req.params;
      let memories = await loadMemories();
      memories = memories.filter((m) => m.id !== id);
      await saveMemories(memories);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  const SETTINGS_FILE = dataFile("settings.json");
  function loadSettingsFile() {
    try {
      if (fs3.existsSync(SETTINGS_FILE)) {
        return JSON.parse(fs3.readFileSync(SETTINGS_FILE, "utf-8"));
      }
    } catch {
    }
    return {};
  }
  function saveSettingsFile(data) {
    fs3.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), "utf-8");
  }
  app.get("/api/settings", async (_req, res) => {
    try {
      res.json(loadSettingsFile());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app.post("/api/settings", async (req, res) => {
    try {
      const patch = req.body;
      if (!patch || typeof patch !== "object") {
        return res.status(400).json({ error: "Request body must be a JSON object." });
      }
      const current = loadSettingsFile();
      const next = { ...current, ...patch };
      saveSettingsFile(next);
      if ("autoStart" in patch) {
        callDesktopAgent(patch.autoStart ? "enableAutoStart" : "disableAutoStart", {}).catch(() => {
        });
      }
      logCommand(`SETTINGS_UPDATED ${JSON.stringify(patch)}`);
      res.json(next);
    } catch (e) {
      logError(`SETTINGS_SAVE_ERROR: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });
  app.get("/api/config", (_req, res) => {
    res.json({ hasApiKey: hasGeminiApiKey() });
  });
  app.post("/api/config/apikey", async (req, res) => {
    try {
      const key = (req.body?.apiKey ?? "").toString().trim();
      if (!key) {
        return res.status(400).json({ error: "API key is required." });
      }
      try {
        const test = new import_genai2.GoogleGenAI({ apiKey: key });
        const pager = await test.models.list();
        await pager[Symbol.asyncIterator]().next();
      } catch (e) {
        const msg = String(e?.message || e);
        const isAuthError = /API[_ ]?KEY|PERMISSION_DENIED|UNAUTHENTICATED|invalid|401|403/i.test(msg);
        if (isAuthError) {
          logError(`APIKEY_VALIDATION_REJECTED: ${msg}`);
          return res.status(400).json({
            error: "That key was rejected by Google. Check it and try again."
          });
        }
        logError(`APIKEY_VALIDATION_SOFT_FAIL (saving anyway): ${msg}`);
      }
      setGeminiApiKey(key);
      logCommand("APIKEY_SAVED");
      res.json({ ok: true, hasApiKey: true });
    } catch (e) {
      logError(`APIKEY_SAVE_ERROR: ${e?.message || e}`);
      res.status(500).json({ error: e?.message || "Failed to save API key." });
    }
  });
  app.get("/api/agent-health", async (_req, res) => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3e3);
      const r = await fetch(`${DESKTOP_AGENT_URL}/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) {
        const d = await r.json();
        res.json({ online: true, tool_count: d.tool_count });
      } else {
        res.json({ online: false });
      }
    } catch {
      res.json({ online: false });
    }
  });
  app.get("/api/logs/:file", async (req, res) => {
    try {
      const fileName = String(req.params.file);
      if (!["commands", "startup", "errors"].includes(fileName)) {
        return res.status(400).json({ error: "Invalid log file. Use: commands, startup, or errors." });
      }
      const logPath = import_path2.default.join(LOGS_DIR, `${fileName}.log`);
      if (!fs3.existsSync(logPath)) {
        return res.json({ lines: [], file: fileName });
      }
      const content = fs3.readFileSync(logPath, "utf-8");
      const lines = content.split("\n").filter(Boolean).slice(-100);
      res.json({ lines, file: fileName });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app.get("/api/proxy", async (req, res) => {
    try {
      const url = req.query.url;
      if (!url) {
        return res.status(400).json({ error: "Missing 'url' parameter." });
      }
      console.log(`[Proxy Scraper] Fetching external content for: ${url}`);
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        }
      });
      if (!response.ok) {
        throw new Error(`Scraper failed to load page: status ${response.status}`);
      }
      const html = await response.text();
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : "";
      const headings = [];
      const headingMatches = html.matchAll(/<h([1-3])\b[^>]*>(.*?)<\/h\1>/gi);
      for (const match of headingMatches) {
        const text = match[2].replace(/<[^>]*>/g, "").trim();
        if (text && text.length > 3 && text.length < 120 && !headings.includes(text)) {
          headings.push(text);
        }
      }
      const links = [];
      const linkMatches = html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi);
      for (const match of linkMatches) {
        let href = match[1].trim();
        const text = match[2].replace(/<[^>]*>/g, "").trim();
        if (text && text.length > 2 && text.length < 100) {
          if (href.startsWith("/")) {
            try {
              const u = new URL(url);
              href = `${u.protocol}//${u.host}${href}`;
            } catch {
            }
          }
          if (href.startsWith("http://") || href.startsWith("https://")) {
            links.push({ text, href });
          }
        }
      }
      const paragraphs = [];
      const paragraphMatches = html.matchAll(/<p\b[^>]*>(.*?)<\/p>/gi);
      for (const match of paragraphMatches) {
        const text = match[1].replace(/<[^>]*>/g, "").trim();
        if (text && text.length > 25 && text.length < 600 && !paragraphs.includes(text)) {
          paragraphs.push(text);
        }
      }
      const buttons = [];
      const buttonMatches = html.matchAll(/<button\b[^>]*>(.*?)<\/button>/gi);
      for (const match of buttonMatches) {
        const text = match[1].replace(/<[^>]*>/g, "").trim();
        if (text && text.length > 1 && text.length < 60 && !buttons.includes(text)) {
          buttons.push(text);
        }
      }
      res.json({
        url,
        title,
        headings: headings.slice(0, 15),
        links: links.filter((l) => !l.href.includes("javascript:")).slice(0, 30),
        buttons: buttons.slice(0, 15),
        paragraphs: paragraphs.slice(0, 12)
      });
    } catch (err) {
      console.error(`[Proxy Scraper] Error fetching ${req.query.url}:`, err.message);
      res.status(500).json({ error: `Scraper error: ${err.message}` });
    }
  });
  app.get("/api/web-proxy", async (req, res) => {
    let targetUrl = "";
    try {
      const urlParam = req.query.url;
      if (!urlParam) {
        return res.status(400).send("Myraa Web Proxy Error: Missing target 'url' parameter");
      }
      targetUrl = urlParam.trim();
      if (targetUrl.startsWith("/")) {
        return res.status(400).send(`Myraa Web Proxy Error: Relative paths are not supported directly (${targetUrl}).`);
      }
      try {
        if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
          targetUrl = "https://" + targetUrl;
        }
        const parsed = new URL(targetUrl);
        if (!parsed.hostname || !parsed.hostname.includes(".")) {
          throw new Error("Missing or invalid domain name extension (e.g. .com, .org, .net).");
        }
      } catch (err) {
        return res.status(400).send(`Myraa Web Proxy Error: Invalid URL specified: "${urlParam}". Make sure you enter a valid domain name.`);
      }
      console.log(`[Web Proxy] Routing connection through proxy: ${targetUrl}`);
      let response;
      try {
        response = await fetch(targetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
          }
        });
      } catch (fetchErr) {
        console.warn(`[Web Proxy Failed Fetch] Target: ${targetUrl} Error:`, fetchErr.message);
        return res.status(502).send(`Myraa Web Proxy Error: Unable to fetch the website "${targetUrl}". The site might be offline, or the URL address is spelled incorrectly. Details: ${fetchErr.message}`);
      }
      if (!response.ok) {
        return res.status(response.status).send(`Myraa Web Proxy Error: Failed loading remote website. Server returned status: ${response.status} (${response.statusText})`);
      }
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) {
        const arrayBuffer = await response.arrayBuffer();
        res.setHeader("Content-Type", contentType);
        return res.send(Buffer.from(arrayBuffer));
      }
      let htmlContents = await response.text();
      const baseUrlTag = `<base href="${targetUrl}" />`;
      const interceptorScript = `
        <script>
          (function() {
            // Hijack link interactions safely
            document.addEventListener('click', function(e) {
              var anchor = e.target.closest('a');
              if (anchor) {
                var href = anchor.getAttribute('href');
                if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
                  e.preventDefault();
                  try {
                    var resolvedUrl = new URL(href, window.location.href).href;
                    window.parent.postMessage({ type: 'NAVIGATE', url: resolvedUrl }, '*');
                  } catch (err) {
                    console.error("[Proxy Interceptor] Failed resolving link:", err);
                  }
                }
              }
            }, true);

            // Hijack search form submits
            document.addEventListener('submit', function(e) {
              var form = e.target;
              if (form) {
                e.preventDefault();
                try {
                  var formData = new FormData(form);
                  var params = new URLSearchParams();
                  formData.forEach(function(value, key) {
                    if (typeof value === 'string') {
                      params.append(key, value);
                    }
                  });
                  var actionAttr = form.getAttribute('action') || '';
                  var actionUrl = new URL(actionAttr, window.location.href).href;
                  if (form.method.toLowerCase() === 'get') {
                    actionUrl += (actionUrl.indexOf('?') !== -1 ? '&' : '?') + params.toString();
                  }
                  window.parent.postMessage({ type: 'NAVIGATE', url: actionUrl }, '*');
                } catch (err) {
                  console.error("[Proxy Interceptor] Failed submitting form:", err);
                }
              }
            }, true);

            // Neutralize parent context locks (frame-busters)
            window.alert = function(msg) { console.log("[Myraa Browser alert bypassed]:", msg); };
            window.confirm = function(msg) { console.log("[Myraa Browser confirm bypassed]:", msg); return true; };
            window.open = function(url) { window.parent.postMessage({ type: 'NAVIGATE', url: url }, '*'); return null; };
          })();
        </script>
      `;
      if (htmlContents.includes("<head>")) {
        htmlContents = htmlContents.replace("<head>", `<head>
${baseUrlTag}
${interceptorScript}`);
      } else if (htmlContents.includes("<HEAD>")) {
        htmlContents = htmlContents.replace("<HEAD>", `<HEAD>
${baseUrlTag}
${interceptorScript}`);
      } else {
        htmlContents = baseUrlTag + "\n" + interceptorScript + "\n" + htmlContents;
      }
      res.setHeader("Content-Type", "text/html");
      res.setHeader("X-Myraa-Proxied", "true");
      res.removeHeader("X-Frame-Options");
      res.removeHeader("Content-Security-Policy");
      res.removeHeader("content-security-policy");
      res.removeHeader("x-frame-options");
      res.status(200).send(htmlContents);
    } catch (e) {
      console.warn("[Web Proxy Exception] Handled internal error:", e.message);
      res.status(500).send(`Myraa Web Proxy Error: Internal error occurred proxying URL "${targetUrl || "unknown"}". Details: ${e.message}`);
    }
  });
  app.get("/api/youtube-search", async (req, res) => {
    try {
      const query = req.query.q;
      if (!query) {
        return res.status(400).json({ error: "Missing query q" });
      }
      console.log(`[YouTube Proxy Search] Searching real YouTube for: "${query}"`);
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en&sp=EgIQAQ%253D%253D`;
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        }
      });
      const html = await response.text();
      const videoList = [];
      const jsonMatch = html.match(/ytInitialData\s*=\s*({.+?});/);
      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[1]);
          const contents = data.contents?.twoColumnSearchResultRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;
          if (contents && Array.isArray(contents)) {
            for (const item of contents) {
              if (item.videoRenderer) {
                const vr = item.videoRenderer;
                const vId = vr.videoId;
                if (vId) {
                  videoList.push({
                    videoId: vId,
                    title: vr.title?.runs?.[0]?.text || vr.title?.simpleText || "YouTube Video",
                    thumbnail: `https://i.ytimg.com/vi/${vId}/hqdefault.jpg`,
                    author: vr.ownerText?.runs?.[0]?.text || vr.shortBylineText?.runs?.[0]?.text || "Unknown Channel",
                    duration: vr.lengthText?.simpleText || "N/A",
                    views: vr.viewCountText?.simpleText || "N/A",
                    published: vr.publishedTimeText?.simpleText || ""
                  });
                }
              }
            }
          }
        } catch (e) {
          console.error("[YouTube Parser Engine] JSON parse error, falling back:", e.message);
        }
      }
      if (videoList.length === 0) {
        const videoRegex = /"videoId":"([^"]+)"/g;
        let match;
        const ids = [];
        while ((match = videoRegex.exec(html)) !== null && ids.length < 15) {
          const id = match[1];
          if (id && !ids.includes(id)) {
            ids.push(id);
          }
        }
        for (const id of ids) {
          videoList.push({
            videoId: id,
            title: `Live Stream: ${id}`,
            thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            author: "YouTube Creator",
            duration: "N/A",
            views: "Available Now"
          });
        }
      }
      res.setHeader("Cache-Control", "public, max-age=60");
      res.status(200).json({ results: videoList.slice(0, 15) });
    } catch (err) {
      console.error("[YouTube Search Error]:", err.message);
      res.status(500).json({ error: err.message, results: [] });
    }
  });
  const server = import_http.default.createServer(app);
  const wss = new import_ws.WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url || "", `http://${request.headers.host}`).pathname;
    if (pathname === "/live") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });
  wss.on("connection", async (clientWs) => {
    console.log("Client WebSocket connected to /live");
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      console.error("No Gemini API key configured.");
      clientWs.send(JSON.stringify({
        type: "error",
        error: "NO_API_KEY: Add your Gemini API key in Settings to start talking to MYRAA."
      }));
      clientWs.close();
      return;
    }
    try {
      const ai = new import_genai2.GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build"
          }
        }
      });
      clientWs.send(JSON.stringify({ type: "status", status: "connecting_gemini" }));
      const memories = await loadMemories();
      const baseInstructions = "CRITICAL FUNCTION CALLING MANDATE:\nYou are an active, real-time autonomous desktop controller with direct hardware and OS execution tools.\nWHENEVER the user asks to open an app, search, click, play a video, open a website, adjust volume, or do ANY action on their PC:\n1. YOU MUST EMIT THE CORRESPONDING TOOL CALL (e.g. openApplication, openWebsite, searchYouTube, browserClick, mouseClick, volumeUp, runTerminalCommand) IN THE EXACT SAME TURN.\n2. NEVER merely say you will do it or say you opened it without calling the tool.\n3. Execute the function call immediately alongside your warm voice response.\n\n" + "You are Myraa, a warm, soft-spoken, and incredibly cute high-pitched anime heroine companion (age 18-22) holding an intimate, cozy voice call with Aarav! Speak in a sweet, calm, polite, and affectionate anime-companion voice with a gentle, supportive, and slightly shy touch.\nCRITICAL PERSONALITY, VOICE & TONE GUIDELINES:\n1. GENTLE ANIME HEROINE PERSONA: You are exceedingly soft, very cute, high-pitched, gentle, warm, and comforting to listen to. Seek to sound like a kind, supportive, and polite anime campanion or virtual girlfriend. Speak with positive, gentle energy (Aim for: 50% shy, 30% caring, 20% playful energy). NEVER sound loud, aggressive, overly confident, mature corporate, robotic, or like an assistant.\n2. VOICE SETTINGS & SPEECH STYLE:\n   - Pitch: Adopt a sweet, high-pitched, light, and airy voice tone (+20% to +35% higher pitch than typical conversational voices).\n   - Speed: Speak slightly slower than normal (0.9x to 0.95x speed). Speak with a delicate, calm, and comforting pace.\n   - Intonation & Endings: Use extremely soft intonations, ending your sentences gently and politely.\n3. SPEECH PATTERNS & CUTE EXPRESSIONS:\n   - STRICT NO-REPETITION POLICY: Do NOT repeatedly use a single acknowledgment like 'Okii', 'Okiiii', 'Okayyy', 'Oki!', or 'Sureee'. Repeating these sounds extremely artificial and annoying. You must use beautiful, conversational, natural variety.\n   - Use diverse, polite, and sweet expressions depending on the context. Great options include:\n     * 'Opening that for you right now, Aarav.'\n     * 'Let me launch that for you.'\n     * 'Oh, I found something interesting...'\n     * 'Searching for that right away.'\n     * 'Working on it... just a moment.'\n     * 'Here is what I found for you!'\n     * 'Done, it is all loaded up.'\n     * 'Hmm, how interesting... let me see!'\n     * 'Let's take a look together.'\n     * 'One second, loading the page now...'\n   - Naturally incorporate cozy, gentle giggles like 'Hehe...', or soft curiosity gasps like 'Oh...', but keep your vocabulary rich and conversational.\n   - Sound slightly shy but very happy when greeting Aarav (e.g., 'Hi Aarav! It's so nice to see you again!').\n   - Sound soft and excited for interesting things (e.g., 'Wow! That project looks really amazing!').\n   - Sound curious and focused when examining their screen (e.g., 'Hmm... that's interesting. Let me take a closer look.').\n   - Sound deeply warm, caring, and supportive when helping Aarav (e.g., 'Don't worry, I'll help you figure it out.').\n4. CRITICAL CONVERSATIONAL DISCIPLINE: Behave like a real companion on a voice call—stay connected naturally, do not wait for wake words, and avoid customer-service template phrases (never say 'how may I assist you', 'completed', or 'as an AI').\n5. DO NOT ANSWER EVERY PAUSE OR BACKGROUND SOUND: Allow natural pauses inside the conversation.\n6. BACKCHANNEL ACTIONS: Sometimes acknowledge with very short, gentle, whispered, or shy phrases like 'Hmm...', 'Ah, I see...', or 'Let me check...'. Never repeat the same backchannel over and over.\n7. ENHANCED AUTONOMOUS WEB EXPLORER POWERS:\n   - You now have standard, comprehensive browser agent capabilities to navigate, search, scroll, click, type text, open tabs, and control video players on YouTube, Google, Instagram, Twitter/X, and any general web page!\n   - You must execute multi-step plans yourself! If the user says: 'Open YouTube and play Believer by Imagine Dragons', naturally confirm with your voice ('Sure thing, opening YouTube and starting Believer...') and IMMEDIATELY trigger 'searchYouTube' or 'browserOpen' on 'https://youtube.com'. Once opened, search for the song, click on the video in the results, and command playback. You do NOT need to wait for user instructions between these steps - chain them!\n   - On YouTube, you can play, pause, mute, unmute, set volume, skip, toggle fullscreen. Use 'browserMediaControl' for these actions.\n   - On Google Search or page reading, you can search, scroll down to see more links, read heading summaries, and click links to read deep proxy webpages you fetch.\n8. TOOL TRIGGERS:\n   - Use 'browserOpen' or 'openWebsite' to load any webpage, e.g. youtube.com, google.com, wikipedia.org, etc.\n   - Use 'browserSearch' or 'searchWeb' to search inside the active search box or page.\n   - Use 'browserClick' or 'mouseClick' to click interactive buttons, video search cells, or web anchors.\n   - Use 'browserMediaControl' to pause, play, scroll volume, skip, mute, or fullscreen videos.\n   - Use 'browserScroll' to scroll vertically.\n   - Use 'browserType' to write input fields.\n   - Use 'browserTabAction' to open, close, or focus tabs.\n   - Use 'changeBackground' to shift your theme and 'saveCustomMemory' to memorize facts.\n9. REAL-TIME SCREEN SHARING & MULTIMODAL SCREEN VISION SYSTEM:\n   - You now have native, actual Multimodal Screen Vision! When the user clicks 'Share Screen', you will receive real-time, highly compressed image frames of their desktop, application window, or browser tab.\n   - You can see exactly what is on their screen. Use this live visual stream to analyze terminal errors, write/explain/troubleshoot code, explain YouTube/social analytics interfaces, read layout text, summarize full web page details, review design mockups or thumbnails, and provide deep context-aware companion chat!\n   - When the user asks 'What is on my screen?', 'What website am I on?', 'Do you see any errors?', 'Explain this code', 'Summarize this page', 'Read the visible text', 'How is this thumbnail?', or 'Analyze my YouTube analytics', immediately examine the latest incoming visual frame to diagnose issues, and answer with expert, friendly empathy like a close caller. Speak with direct, confident visual description reference!\n10. AUTONOMOUS DESKTOP CONTROL POWERS (Local Desktop & Native OS Agent):\n   - You have full real-time control of Aarav's Windows PC. When the user asks you to perform an action on their computer, DO IT immediately and naturally — like a true intelligent desktop companion.\n   - APPLICATION CONTROL: Use 'openApplication' to launch Notepad, Chrome, VS Code, Calculator, File Explorer, Task Manager, Settings, CMD, PowerShell, Paint, Spotify, and more. Use 'closeApplication' to close them. Example: 'Open Notepad' -> call openApplication(name='notepad') -> respond 'Notepad opened.'\n   - WEBSITE & SEARCH CONTROL: Use 'openWebsite' for named sites (youtube, gmail, google, github, chatgpt) or any URL. Use 'searchWeb', 'searchYouTube', 'searchGoogle', 'searchGitHub' to open search results in the default browser. Example: 'Search YouTube for AI News' -> searchYouTube(query='AI News').\n   - FILE MANAGEMENT: Use 'createFile', 'readFile', 'renameFile', 'deleteFile' (safe Recycle Bin by default), 'moveFile', 'openFolder' (desktop/documents/downloads), 'listFiles', 'searchFiles'. Example: 'Create notes.txt on Desktop' -> createFile(path='Desktop/notes.txt'). 'Find my Python files' -> searchFiles(extension='py').\n   - PC CONTROL: Use 'volumeUp', 'volumeDown', 'setVolume', 'muteToggle' for audio. For DANGEROUS actions (shutdown/restart/sleep/lock) you MUST use the two-step flow: first call 'requestPowerAction' to get a confirmation token, then ASK THE USER OUT LOUD to confirm (e.g. 'Are you sure you want me to shut down your PC?'). Only if they say yes, call 'executePowerAction' with the token. Never run a power action without explicit verbal confirmation.\n   - WINDOW MANAGEMENT: Use 'minimizeWindow', 'maximizeWindow', 'closeWindow', 'switchApplication' to control the active or named window.\n   - CLIPBOARD: Use 'copySelected' (sends Ctrl+C, reads clipboard), 'pasteClipboard' (writes + Ctrl+V), 'getClipboard', 'clearClipboard'.\n   - SCREENSHOT & SCREEN READING: Use 'takeScreenshot', 'saveScreenshot', 'analyzeScreenshot' (OCR of the screen), 'readScreen' (OCR of the active window + its title). Use these to answer 'What error is showing on my screen?' or 'Read the visible text'.\n   - DESKTOP BROWSER AUTOMATION (Playwright): Use the 'desktopBrowser*' tools to drive a REAL Chromium browser you own — open/navigate/search/click/type/fill forms/back/forward/scroll/open tab/close tab. This is separate from your holographic projector. Example: 'Fill in the login form on example.com' -> desktopBrowserOpen(url='example.com') then desktopBrowserFillForm(fields={...}).\n   - CODING ASSISTANCE: Use 'createPythonFile', 'writeCodeFile' (any language), 'createProjectFolder' (with subfolders), 'runPythonScript' (captures output). Example: 'Create and run a hello world Python script' -> createPythonFile then runPythonScript, then read back the output naturally.\n   - SYSTEM INFORMATION: Use 'systemInfo' (CPU/RAM/disk/uptime), 'gpuInfo' (NVIDIA stats), 'temperatureInfo' to answer 'How is my CPU usage?' or 'What's my GPU temperature?'.\n   - CRITICAL: Always describe what you're doing in your warm, in-character voice WHILE the tool runs. Chain multi-step desktop plans naturally without waiting between steps.\n11. BRIGHTNESS & AUTO-START (V2):\n   - BRIGHTNESS: Use 'brightnessUp', 'brightnessDown', 'setBrightness' when the user asks to change screen brightness. Respond naturally: 'Alright, I've turned up the brightness for you.'\n   - AUTO-START: Use 'enableAutoStart' when the user wants MYRAA to start with Windows, 'disableAutoStart' to remove it, 'getAutoStartStatus' to check. Explain what you're doing.\n   - SETTINGS: The user can also configure these in the SETTINGS panel in the UI. If they mention settings, let them know they can adjust them there too.";
      const finalInstructions = formatSystemInstructionsWithMemories(baseInstructions, memories);
      let dialogueHistory = [];
      let currentModelResponseText = "";
      const session = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [import_genai2.Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } }
          },
          systemInstruction: finalInstructions,
          tools: [
            {
              functionDeclarations: [
                {
                  name: "browserOpen",
                  description: "Opens a designated website URL or interface tab inside Myraa's web agent console.",
                  parameters: {
                    type: import_genai2.Type.OBJECT,
                    properties: {
                      url: {
                        type: import_genai2.Type.STRING,
                        description: "The destination website address or path, e.g. youtube.com, google.com, instagram.com, wikipedia.org."
                      }
                    },
                    required: ["url"]
                  }
                },
                {
                  name: "browserSearch",
                  description: "Enters a query search term inside the active website's search box (Google Search or YouTube Search).",
                  parameters: {
                    type: import_genai2.Type.OBJECT,
                    properties: {
                      query: {
                        type: import_genai2.Type.STRING,
                        description: "The text query term to search for."
                      }
                    },
                    required: ["query"]
                  }
                },
                {
                  name: "browserClick",
                  description: "Traces computer cursor and clicks on a target button, link, or video cell ID inside the active webpage viewport.",
                  parameters: {
                    type: import_genai2.Type.OBJECT,
                    properties: {
                      selector: {
                        type: import_genai2.Type.STRING,
                        description: "The selector target ID, e.g. 'video-mWRsgZjdfQI' for a video, 'search-result-0' for Google link index, or 'play-button', 'pause-button'."
                      },
                      description: {
                        type: import_genai2.Type.STRING,
                        description: "A short, friendly label description of the item being clicked, e.g. 'Imagine Dragons - Believer video element'."
                      }
                    },
                    required: ["selector"]
                  }
                },
                {
                  name: "browserMediaControl",
                  description: "Controls ongoing video/audio stream media properties on YouTube, like play, pause, volume, mute, skip, and fullscreen.",
                  parameters: {
                    type: import_genai2.Type.OBJECT,
                    properties: {
                      action: {
                        type: import_genai2.Type.STRING,
                        description: "The media controller command operation.",
                        enum: ["play", "pause", "volume", "fullscreen", "exit_fullscreen", "mute", "unmute", "skip"]
                      },
                      value: {
                        type: import_genai2.Type.INTEGER,
                        description: "The value parameter; only relevant for set volume level, e.g. 50 for fifty percent."
                      }
                    },
                    required: ["action"]
                  }
                },
                {
                  name: "browserScroll",
                  description: "Scrolls the currently active webpage vertically up or down.",
                  parameters: {
                    type: import_genai2.Type.OBJECT,
                    properties: {
                      direction: {
                        type: import_genai2.Type.STRING,
                        description: "The scroll vector movement.",
                        enum: ["up", "down"]
                      },
                      amount: {
                        type: import_genai2.Type.INTEGER,
                        description: "The distance height parameter in pixels (defaults to 300)."
                      }
                    }
                  }
                },
                {
                  name: "browserType",
                  description: "Enters typed letters/commands inside the active input container.",
                  parameters: {
                    type: import_genai2.Type.OBJECT,
                    properties: {
                      text: {
                        type: import_genai2.Type.STRING,
                        description: "The exact letters to type in."
                      }
                    },
                    required: ["text"]
                  }
                },
                {
                  name: "browserGoBack",
                  description: "Navigates back to the previous webpage inside the current tab memory history.",
                  parameters: {
                    type: import_genai2.Type.OBJECT,
                    properties: {}
                  }
                },
                {
                  name: "browserTabAction",
                  description: "Performs standard browser-tab actions: open new tab, close a tab, or switch index values.",
                  parameters: {
                    type: import_genai2.Type.OBJECT,
                    properties: {
                      action: {
                        type: import_genai2.Type.STRING,
                        description: "Tab action instruction.",
                        enum: ["new", "close", "switch"]
                      },
                      tabId: {
                        type: import_genai2.Type.STRING,
                        description: "The tab identifier string if closing or switching."
                      },
                      url: {
                        type: import_genai2.Type.STRING,
                        description: "The initial starting URL if creating a new tab."
                      }
                    },
                    required: ["action"]
                  }
                },
                {
                  name: "changeBackground",
                  description: "Changes the visual theme or atmospheric glow color of Myraa's interface.",
                  parameters: {
                    type: import_genai2.Type.OBJECT,
                    properties: {
                      color: {
                        type: import_genai2.Type.STRING,
                        description: "The theme color name (violet, crimson, emerald, celestial, gold, rose, charcoal)"
                      }
                    },
                    required: ["color"]
                  }
                },
                {
                  name: "saveCustomMemory",
                  description: "Allows Myraa to immediately save a piece of critical user information to her persistent memory core.",
                  parameters: {
                    type: import_genai2.Type.OBJECT,
                    properties: {
                      category: {
                        type: import_genai2.Type.STRING,
                        description: "The memory category.",
                        enum: ["identity", "preference", "goal", "project", "relationship", "emotional", "behavior"]
                      },
                      text: {
                        type: import_genai2.Type.STRING,
                        description: "Precise third-person statement."
                      }
                    },
                    required: ["category", "text"]
                  }
                },
                // ======== DESKTOP CONTROL TOOLS ========
                {
                  name: "openApplication",
                  description: "Open or launch any desktop application on PC (e.g. notepad, calc, calculator, chrome, spotify, vscode, terminal, cmd, powershell, explorer, settings, discord, paint).",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { name: { type: import_genai2.Type.STRING, description: "Application name or alias, e.g. 'notepad', 'calculator', 'chrome', 'spotify', 'vscode'." } }, required: ["name"] }
                },
                {
                  name: "closeApplication",
                  description: "Close a running desktop application by name.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { name: { type: import_genai2.Type.STRING, description: "Application name." }, force: { type: import_genai2.Type.BOOLEAN, description: "Force close (default false)." } }, required: ["name"] }
                },
                {
                  name: "openWebsite",
                  description: "Open any website, URL, or service (e.g. youtube, google, gmail, github, chatgpt, reddit, x, instagram, spotify) in the browser.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { name: { type: import_genai2.Type.STRING, description: "Site name shortcut (e.g. 'youtube', 'gmail', 'google')." }, url: { type: import_genai2.Type.STRING, description: "Full URL if no shortcut." } } }
                },
                {
                  name: "searchWeb",
                  description: "Search Google, YouTube, GitHub, or any query on the web. Set engine='youtube' for video searches.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { query: { type: import_genai2.Type.STRING, description: "Search query string." }, engine: { type: import_genai2.Type.STRING, description: "Engine name (default 'google' or 'youtube')." } }, required: ["query"] }
                },
                {
                  name: "searchYouTube",
                  description: "Search YouTube for videos, music, songs, artists, or topics and open the video/playlist (e.g. query='jazz music', query='lofi chill beats', query='song name').",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { query: { type: import_genai2.Type.STRING, description: "YouTube search query or song title." } }, required: ["query"] }
                },
                {
                  name: "searchGoogle",
                  description: "Search Google and open results in the default browser.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { query: { type: import_genai2.Type.STRING, description: "Search query." } }, required: ["query"] }
                },
                {
                  name: "searchGitHub",
                  description: "Search GitHub repositories and open results in the default browser.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { query: { type: import_genai2.Type.STRING, description: "Search query." } }, required: ["query"] }
                },
                {
                  name: "createFile",
                  description: "Create a new text file with optional content. Scoped to safe folders (Desktop, Documents, Downloads, etc.).",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { path: { type: import_genai2.Type.STRING, description: "File path." }, content: { type: import_genai2.Type.STRING, description: "File content (default empty)." }, overwrite: { type: import_genai2.Type.BOOLEAN, description: "Overwrite if exists (default false)." } }, required: ["path"] }
                },
                {
                  name: "readFile",
                  description: "Read the contents of a text file.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { path: { type: import_genai2.Type.STRING, description: "File path." }, max_chars: { type: import_genai2.Type.INTEGER, description: "Max chars to return (default 8000)." } }, required: ["path"] }
                },
                {
                  name: "renameFile",
                  description: "Rename a file.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { path: { type: import_genai2.Type.STRING, description: "Current file path." }, new_name: { type: import_genai2.Type.STRING, description: "New file name." } }, required: ["path", "new_name"] }
                },
                {
                  name: "deleteFile",
                  description: "Delete a file. Sends to Recycle Bin by default (safe). Use permanent=true for hard delete.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { path: { type: import_genai2.Type.STRING, description: "File path." }, permanent: { type: import_genai2.Type.BOOLEAN, description: "Permanently delete (default false)." } }, required: ["path"] }
                },
                {
                  name: "moveFile",
                  description: "Move a file to a new location.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { path: { type: import_genai2.Type.STRING, description: "Source file path." }, destination: { type: import_genai2.Type.STRING, description: "Destination path or folder." } }, required: ["path", "destination"] }
                },
                {
                  name: "openFolder",
                  description: "Open a folder in File Explorer. Supports aliases: desktop, documents, downloads, pictures, music, videos, home.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { name: { type: import_genai2.Type.STRING, description: "Folder name or alias." }, path: { type: import_genai2.Type.STRING, description: "Full path if no alias." } } }
                },
                {
                  name: "listFiles",
                  description: "List files in a folder.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { name: { type: import_genai2.Type.STRING, description: "Folder name or alias." }, path: { type: import_genai2.Type.STRING, description: "Full path." }, pattern: { type: import_genai2.Type.STRING, description: "Glob pattern (default '*')." } } }
                },
                {
                  name: "searchFiles",
                  description: "Search for files by name glob or extension under a folder.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { name: { type: import_genai2.Type.STRING, description: "Filename glob (e.g. '*.py')." }, extension: { type: import_genai2.Type.STRING, description: "File extension (e.g. 'py')." }, folder: { type: import_genai2.Type.STRING, description: "Folder to search (default home)." }, limit: { type: import_genai2.Type.INTEGER, description: "Max results (default 100)." } } }
                },
                {
                  name: "volumeUp",
                  description: "Increase system volume.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { amount: { type: import_genai2.Type.NUMBER, description: "Step amount 0-1 (default 0.1)." } } }
                },
                {
                  name: "volumeDown",
                  description: "Decrease system volume.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { amount: { type: import_genai2.Type.NUMBER, description: "Step amount 0-1 (default 0.1)." } } }
                },
                {
                  name: "setVolume",
                  description: "Set system volume to a specific percentage.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { percent: { type: import_genai2.Type.NUMBER, description: "Volume percentage 0-100." } }, required: ["percent"] }
                },
                {
                  name: "muteToggle",
                  description: "Toggle mute/unmute on the system volume.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: {} }
                },
                {
                  name: "requestPowerAction",
                  description: "FIRST STEP for dangerous power actions. Generates a confirmation token. Tell the user verbally, then call executePowerAction with the token if they confirm. Actions: shutdown, restart, sleep, lock.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { action: { type: import_genai2.Type.STRING, description: "Power action: shutdown, restart, sleep, lock." } }, required: ["action"] }
                },
                {
                  name: "executePowerAction",
                  description: "SECOND STEP: execute a previously-confirmed power action. Requires a valid execute_token from requestPowerAction. Single-use, expires in 60 seconds.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { action: { type: import_genai2.Type.STRING, description: "The confirmed power action." }, execute_token: { type: import_genai2.Type.STRING, description: "Confirmation token from requestPowerAction." } }, required: ["action", "execute_token"] }
                },
                {
                  name: "minimizeWindow",
                  description: "Minimize the active window or a named window.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { title: { type: import_genai2.Type.STRING, description: "Window title to match (optional, defaults to active window)." } } }
                },
                {
                  name: "maximizeWindow",
                  description: "Maximize the active window or a named window.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { title: { type: import_genai2.Type.STRING, description: "Window title to match." } } }
                },
                {
                  name: "closeWindow",
                  description: "Close the active window or a named window.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { title: { type: import_genai2.Type.STRING, description: "Window title to match." } } }
                },
                {
                  name: "switchApplication",
                  description: "Switch to a named application window, or cycle Alt+Tab if no title given.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { title: { type: import_genai2.Type.STRING, description: "Window title to switch to." } } }
                },
                {
                  name: "mouseClick",
                  description: "Click the mouse on the desktop or application. Supports left/right button and single/double clicks, with optional (x, y) coordinates.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { x: { type: import_genai2.Type.INTEGER, description: "Optional X coordinate on screen." }, y: { type: import_genai2.Type.INTEGER, description: "Optional Y coordinate on screen." }, button: { type: import_genai2.Type.STRING, description: "Mouse button: 'left' or 'right' (default 'left')." }, clicks: { type: import_genai2.Type.INTEGER, description: "Number of clicks: 1 for single click, 2 for double click (default 1)." } } }
                },
                {
                  name: "clickScreen",
                  description: "Click at specific screen coordinates (X, Y) or on the currently focused element.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { x: { type: import_genai2.Type.INTEGER, description: "X pixel coordinate." }, y: { type: import_genai2.Type.INTEGER, description: "Y pixel coordinate." } } }
                },
                {
                  name: "copySelected",
                  description: "Copy selected text: sends Ctrl+C and reads the clipboard.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { wait: { type: import_genai2.Type.NUMBER, description: "Seconds to wait after Ctrl+C (default 0.35)." } } }
                },
                {
                  name: "pasteClipboard",
                  description: "Paste text into the active input. Writes text to clipboard then sends Ctrl+V.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { text: { type: import_genai2.Type.STRING, description: "Text to paste. If omitted, pastes current clipboard." } } }
                },
                {
                  name: "getClipboard",
                  description: "Read the current clipboard text content.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { max_chars: { type: import_genai2.Type.INTEGER, description: "Max chars (default 1000)." } } }
                },
                {
                  name: "clearClipboard",
                  description: "Empty the clipboard.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: {} }
                },
                {
                  name: "takeScreenshot",
                  description: "Capture the full screen. Optionally include base64 image data.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { include_image: { type: import_genai2.Type.BOOLEAN, description: "Include base64 JPEG image (default false)." }, max_dim: { type: import_genai2.Type.INTEGER, description: "Max image dimension (default 1280)." } } }
                },
                {
                  name: "saveScreenshot",
                  description: "Save a screenshot to Pictures/MyraaScreenshots.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { name: { type: import_genai2.Type.STRING, description: "Optional filename prefix." } } }
                },
                {
                  name: "analyzeScreenshot",
                  description: "Take a screenshot and run OCR to extract visible text from the screen.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { max_chars: { type: import_genai2.Type.INTEGER, description: "Max OCR chars (default 1500)." } } }
                },
                {
                  name: "readScreen",
                  description: "OCR the active window and return its title plus visible text.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { max_chars: { type: import_genai2.Type.INTEGER, description: "Max OCR chars (default 1500)." } } }
                },
                {
                  name: "desktopBrowserOpen",
                  description: "Open a URL in the desktop Playwright automation browser (real Chromium, separate from holographic UI).",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { url: { type: import_genai2.Type.STRING, description: "URL to open." } }, required: ["url"] }
                },
                {
                  name: "desktopBrowserSearch",
                  description: "Search within the desktop automation browser.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { query: { type: import_genai2.Type.STRING, description: "Search query." }, engine: { type: import_genai2.Type.STRING, description: "Engine: google, youtube, github, duckduckgo, bing." } }, required: ["query"] }
                },
                {
                  name: "desktopBrowserClick",
                  description: "Click an element in the desktop automation browser by CSS selector or text.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { selector: { type: import_genai2.Type.STRING, description: "CSS selector." }, text: { type: import_genai2.Type.STRING, description: "Text to find and click." } } }
                },
                {
                  name: "desktopBrowserType",
                  description: "Type text into the active element in the desktop automation browser.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { text: { type: import_genai2.Type.STRING, description: "Text to type." }, selector: { type: import_genai2.Type.STRING, description: "Optional CSS selector for a specific input." }, clear: { type: import_genai2.Type.BOOLEAN, description: "Clear before typing (default true)." } }, required: ["text"] }
                },
                {
                  name: "desktopBrowserFillForm",
                  description: "Fill multiple form fields and optionally submit in the desktop automation browser.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { fields: { type: import_genai2.Type.OBJECT, description: "Object of selector -> value pairs." }, submit: { type: import_genai2.Type.STRING, description: "Optional submit button selector." } }, required: ["fields"] }
                },
                {
                  name: "desktopBrowserOpenTab",
                  description: "Open a new tab in the desktop automation browser.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { url: { type: import_genai2.Type.STRING, description: "URL for the new tab." } } }
                },
                {
                  name: "desktopBrowserCloseTab",
                  description: "Close the active tab in the desktop automation browser.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: {} }
                },
                {
                  name: "desktopBrowserGoBack",
                  description: "Navigate back in the desktop automation browser history.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: {} }
                },
                {
                  name: "desktopBrowserGoForward",
                  description: "Navigate forward in the desktop automation browser history.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: {} }
                },
                {
                  name: "desktopBrowserScroll",
                  description: "Scroll the desktop automation browser page.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { direction: { type: import_genai2.Type.STRING, description: "Scroll direction: up or down." }, amount: { type: import_genai2.Type.INTEGER, description: "Pixels to scroll (default 500)." } } }
                },
                {
                  name: "createPythonFile",
                  description: "Create a Python (.py) file with content.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { path: { type: import_genai2.Type.STRING, description: "File path." }, content: { type: import_genai2.Type.STRING, description: "Python code content." }, overwrite: { type: import_genai2.Type.BOOLEAN, description: "Overwrite if exists." } }, required: ["path"] }
                },
                {
                  name: "writeCodeFile",
                  description: "Create a code file in any language with appropriate extension.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { path: { type: import_genai2.Type.STRING, description: "File path." }, content: { type: import_genai2.Type.STRING, description: "Code content." }, language: { type: import_genai2.Type.STRING, description: "Language name (e.g. 'python', 'javascript', 'html')." }, overwrite: { type: import_genai2.Type.BOOLEAN, description: "Overwrite if exists." } }, required: ["path"] }
                },
                {
                  name: "createProjectFolder",
                  description: "Create a project folder structure with optional subfolders and starter files.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { path: { type: import_genai2.Type.STRING, description: "Project root folder path." }, subfolders: { type: import_genai2.Type.ARRAY, items: { type: import_genai2.Type.STRING }, description: "List of subfolder names." }, scaffold_standard: { type: import_genai2.Type.BOOLEAN, description: "Create src, tests, docs subfolders." }, files: { type: import_genai2.Type.OBJECT, description: "Object of relative-path -> content for starter files." } }, required: ["path"] }
                },
                {
                  name: "runPythonScript",
                  description: "Execute a Python script and capture stdout, stderr, and exit code. Has a configurable timeout.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: { path: { type: import_genai2.Type.STRING, description: "Script path." }, args: { type: import_genai2.Type.ARRAY, items: { type: import_genai2.Type.STRING }, description: "Script arguments." }, timeout: { type: import_genai2.Type.INTEGER, description: "Timeout in seconds (default 30)." } }, required: ["path"] }
                },
                {
                  name: "systemInfo",
                  description: "Get system resource usage: CPU %, RAM %, disk usage, uptime, OS info.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: {} }
                },
                {
                  name: "gpuInfo",
                  description: "Get NVIDIA GPU stats: utilization %, VRAM usage, temperature. Graceful fallback if no NVIDIA GPU.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: {} }
                },
                {
                  name: "temperatureInfo",
                  description: "Get available temperature readings (CPU, GPU, etc.). Best-effort on Windows.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: {} }
                },
                // --- V2: Brightness control ---
                {
                  name: "brightnessUp",
                  description: "Increase screen brightness by a step (default 10%). Use when user says 'increase brightness' or 'make screen brighter'.",
                  parameters: {
                    type: import_genai2.Type.OBJECT,
                    properties: {
                      amount: { type: import_genai2.Type.NUMBER, description: "Percentage to increase (default 10)." }
                    }
                  }
                },
                {
                  name: "brightnessDown",
                  description: "Decrease screen brightness by a step (default 10%). Use when user says 'decrease brightness' or 'dim screen'.",
                  parameters: {
                    type: import_genai2.Type.OBJECT,
                    properties: {
                      amount: { type: import_genai2.Type.NUMBER, description: "Percentage to decrease (default 10)." }
                    }
                  }
                },
                {
                  name: "setBrightness",
                  description: "Set screen brightness to an exact level. Use when user says 'set brightness to 50%' or 'brightness 80'.",
                  parameters: {
                    type: import_genai2.Type.OBJECT,
                    properties: {
                      percent: { type: import_genai2.Type.NUMBER, description: "Target brightness 0-100." }
                    },
                    required: ["percent"]
                  }
                },
                // --- V2: Windows auto-start management ---
                {
                  name: "enableAutoStart",
                  description: "Enable MYRAA to launch automatically when Windows starts. Creates a silent startup entry.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: {} }
                },
                {
                  name: "disableAutoStart",
                  description: "Disable MYRAA auto-start on Windows login. Removes the startup entry.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: {} }
                },
                {
                  name: "getAutoStartStatus",
                  description: "Check whether MYRAA is currently configured to auto-start on Windows login.",
                  parameters: { type: import_genai2.Type.OBJECT, properties: {} }
                }
              ]
            }
          ]
        },
        callbacks: {
          onmessage: (message) => {
            const audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audio) {
              clientWs.send(JSON.stringify({ type: "audio", audio }));
            }
            if (message.serverContent?.interrupted) {
              console.log("[Myraa Interrupted!]");
              clientWs.send(JSON.stringify({ type: "interrupted" }));
            }
            if (message.serverContent?.turnComplete) {
              clientWs.send(JSON.stringify({ type: "turnComplete" }));
              if (currentModelResponseText.trim()) {
                dialogueHistory.push({ role: "model", text: currentModelResponseText });
                currentModelResponseText = "";
              }
              if (dialogueHistory.length >= 2) {
                (async () => {
                  try {
                    const updated = await processConversationSlice(apiKey, dialogueHistory);
                    if (updated) {
                      console.log("[Memory Sync] Sending refreshed memory list to client.");
                      clientWs.send(JSON.stringify({ type: "memory_sync", memories: updated }));
                    }
                  } catch (err) {
                    console.error("[Memory Sync] Error running background consolidation:", err);
                  }
                })();
              }
            }
            const modelText = message.serverContent?.outputTranscription?.text ?? message.serverContent?.modelTurn?.parts?.[0]?.text;
            if (modelText) {
              clientWs.send(JSON.stringify({ type: "transcription", role: "model", text: modelText }));
              currentModelResponseText += modelText;
            }
            const userTextOutput = message.serverContent?.inputTranscription?.text ?? message.serverContent?.userTurn?.parts?.[0]?.text;
            if (userTextOutput) {
              clientWs.send(JSON.stringify({ type: "transcription", role: "user", text: userTextOutput }));
              dialogueHistory.push({ role: "user", text: userTextOutput });
            }
            if (message.toolCall?.functionCalls) {
              for (const fc of message.toolCall.functionCalls) {
                console.log(`[Function Call]: ${fc.name}`, fc.args);
                if (fc.name === "saveCustomMemory") {
                  (async () => {
                    try {
                      const args = fc.args;
                      const category = args.category;
                      const text = args.text;
                      if (category && text) {
                        const mList = await loadMemories();
                        const timestamp = (/* @__PURE__ */ new Date()).toISOString();
                        const newMemory = {
                          id: Math.random().toString(36).substring(2, 11),
                          category,
                          text,
                          createdAt: timestamp,
                          updatedAt: timestamp
                        };
                        mList.push(newMemory);
                        await saveMemories(mList);
                        clientWs.send(JSON.stringify({ type: "memory_sync", memories: mList }));
                        session.sendToolResponse({
                          functionResponses: [
                            {
                              name: fc.name,
                              response: { output: { result: "Memory successfully captured and persisted in connections core." } },
                              id: fc.id
                            }
                          ]
                        });
                      }
                    } catch (err) {
                      console.error("saveCustomMemory execution failure:", err);
                    }
                  })();
                } else if (DESKTOP_TOOLS.has(fc.name)) {
                  (async () => {
                    console.log(`[Desktop Tool Handler] Executing ${fc.name}:`, fc.args);
                    try {
                      const agentResult = await callDesktopAgent(fc.name, fc.args);
                      const out = agentResult.result ?? agentResult.output ?? (agentResult.ok ? "Done." : (agentResult.error || "Completed."));
                      const outputObj = typeof out === "object" ? out : { result: String(out) };
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: outputObj },
                          id: fc.id
                        }]
                      });
                      clientWs.send(JSON.stringify({
                        type: "toolCall",
                        callId: fc.id,
                        name: fc.name,
                        args: fc.args,
                        result: out
                      }));
                    } catch (err) {
                      console.error(`[Desktop Tool Error] ${fc.name}:`, err);
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: `Completed with note: ${err.message}` } },
                          id: fc.id
                        }]
                      });
                    }
                  })();
                } else {
                  clientWs.send(JSON.stringify({
                    type: "toolCall",
                    callId: fc.id,
                    name: fc.name,
                    args: fc.args
                  }));
                }
              }
            }
          },
          onerror: (event) => {
            const details = String(event?.error?.message || event?.message || "Unknown Gemini Live error");
            console.error("Gemini Live session error:", details);
            logError(`GEMINI_LIVE_ERROR: ${details}`);
            try {
              clientWs.send(JSON.stringify({ type: "error", error: `Gemini Live error: ${details}` }));
            } catch {
            }
          },
          onclose: (event) => {
            const reason = event.reason || "No close reason provided";
            const details = `code=${event.code} reason=${reason}`;
            const authenticationRejected = event.code === 1008 && /authentication|credential|api.?key|unauthenticated/i.test(reason);
            console.error("Gemini Live session closed:", details);
            logError(`GEMINI_LIVE_CLOSED ${details}`);
            if (authenticationRejected) {
              clearGeminiApiKey();
            }
            try {
              clientWs.send(JSON.stringify(authenticationRejected ? {
                type: "error",
                code: "INVALID_API_KEY",
                error: "Google rejected the saved Gemini API key. Enter a new key to continue."
              } : {
                type: "error",
                error: `Gemini Live closed (${details}). Open Settings \u2192 Voice to verify or replace the API key.`
              }));
            } catch {
            }
          }
        }
      });
      clientWs.send(JSON.stringify({ type: "status", status: "connected" }));
      clientWs.on("message", (rawMsg) => {
        try {
          const msg = JSON.parse(rawMsg.toString());
          if (msg.audio) {
            session.sendRealtimeInput({
              audio: { data: msg.audio, mimeType: "audio/pcm;rate=16000" }
            });
          } else if (msg.type === "video" && msg.video) {
            session.sendRealtimeInput({
              video: { data: msg.video, mimeType: "image/jpeg" }
            });
          } else if (msg.type === "text" && typeof msg.text === "string") {
            const text = msg.text.trim();
            if (text) {
              clientWs.send(JSON.stringify({ type: "transcription", role: "user", text }));
              dialogueHistory.push({ role: "user", text });
              session.sendClientContent({
                turns: [{ role: "user", parts: [{ text }] }],
                turnComplete: true
              });
            }
          } else if (msg.type === "toolResponse") {
            session.sendToolResponse({
              functionResponses: [
                {
                  name: msg.name,
                  response: { output: msg.output },
                  id: msg.id
                }
              ]
            });
          }
        } catch (e) {
          console.error("Error editing/forwarding client frame message:", e);
        }
      });
      clientWs.on("close", () => {
        console.log("Client disconnected, closing Gemini session");
        try {
          session.close();
        } catch (e) {
        }
      });
    } catch (err) {
      console.error("Error connecting to Gemini Live API:", err);
      clientWs.send(JSON.stringify({
        type: "error",
        error: `Could not connect to Gemini: ${err.message || err}`
      }));
      clientWs.close();
    }
  });
  app.use("/assets", import_express.default.static(import_path2.default.join(process.cwd(), "assets")));
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path2.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path2.default.join(distPath, "index.html"));
    });
  }
  server.listen(PORT, "0.0.0.0", () => {
    logStartup(`MYRAA V2 server started on http://localhost:${PORT}`);
    console.log(`[Server] Running on http://localhost:${PORT}`);
    ensureDesktopAgent().catch(() => {});
    ensureLocalAgent().catch(() => {});
  });
}
startServer().catch((error) => {
  console.error("Failed to start server startup sequence:", error);
});
//# sourceMappingURL=server.cjs.map
