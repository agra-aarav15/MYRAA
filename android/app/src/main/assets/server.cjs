const path = require("path");
const fs = require("fs");
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
const appDataDir = process.env.APPDATA || (process.platform === 'darwin' ? path.join(process.env.HOME || '', 'Library', 'Application Support') : path.join(process.env.HOME || '', '.config'));



var DATA_DIR = process.env.MYRAA_DATA_DIR || path.join(appDataDir, 'myraa');
const AUTH_TOKEN_FILE = path.join(DATA_DIR, "token.txt");
function getAuthToken() {
  try {
    if (fs.existsSync(AUTH_TOKEN_FILE)) {
      const t = fs.readFileSync(AUTH_TOKEN_FILE, "utf8").trim();
      if (t) return t;
    }
  } catch {}
  const newToken = require("crypto").randomBytes(24).toString("hex");
  try { fs.writeFileSync(AUTH_TOKEN_FILE, newToken, "utf8"); } catch {}
  return newToken;
}
const MYRAA_AUTH_TOKEN = getAuthToken();

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'screenshots'), { recursive: true });
} catch {}
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
    path.join(DATA_DIR, "secrets.json"),
    path.join(process.cwd(), "secrets.json"),
    path.resolve(__dirname, "..", "secrets.json"),
    path.resolve(__dirname, "secrets.json")
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
  try {
    const settingsPath = import_path.default.join(DATA_DIR, "settings.json");
    if (import_fs.default.existsSync(settingsPath)) {
      const s = JSON.parse(import_fs.default.readFileSync(settingsPath, "utf-8"));
      const k = (s?.apiKeys?.gemini || s?.geminiApiKey)?.trim();
      if (k) return k;
    }
  } catch {}
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
    path.join(process.cwd(), "secrets.json")
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
    path.join(process.cwd(), "secrets.json")
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
  if (await isDesktopAgentAlive()) {
    desktopAgentVerified = true;
    return true;
  }
  desktopAgentVerified = false;
  console.log("[Desktop Agent] Not running. Auto-starting...");
  spawnDesktopAgent();
  for (let i = 1; i <= 6; i++) {
    await new Promise((r) => setTimeout(r, 800));
    if (await isDesktopAgentAlive()) {
      desktopAgentVerified = true;
      console.log(`[Desktop Agent] Online after ${i * 0.8}s.`);
      return true;
    }
  }
  console.log("[Desktop Agent] Native fallback active.");
  return false;
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
    path.resolve(__dirname, "../local-agent.js")
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



let cachedScreenMetrics = null;
let lastScreenCheck = 0;
function getScreenMetrics() {
  const now = Date.now();
  if (cachedScreenMetrics && (now - lastScreenCheck < 10000)) {
    return cachedScreenMetrics;
  }
  try {
    const exe = getClickerExePath();
    if (exe) {
      const out = require("child_process").execFileSync(exe, ["screen"], { encoding: "utf8", timeout: 2000 });
      const data = JSON.parse(out.trim());
      if (data.width && data.height) {
        cachedScreenMetrics = data;
        lastScreenCheck = now;
        return data;
      }
    }
  } catch {}
  return { width: 1920, height: 1080 };
}

function scaleCoordinates(rawX, rawY) {
  if (rawX === undefined || rawX === null || isNaN(rawX)) return { x: -1, y: -1 };
  const metrics = getScreenMetrics();
  const screenW = metrics.width || 1920;
  const screenH = metrics.height || 1080;

  let x = Number(rawX);
  let y = Number(rawY);

  if (x > 0 && x <= 1 && y > 0 && y <= 1) {
    return { x: Math.round(x * screenW), y: Math.round(y * screenH) };
  }

  if (screenW !== 1280 && x > 0 && x <= 1280 && y > 0 && y <= 720) {
    const scaledX = Math.round(x * (screenW / 1280));
    const scaledY = Math.round(y * (screenH / 720));
    logCommand(`[COORD_SCALE] (${x}, ${y}) -> (${scaledX}, ${scaledY}) on ${screenW}x${screenH}`);
    return { x: scaledX, y: scaledY };
  }

  return { x: Math.round(x), y: Math.round(y) };
}

function resolveUserPath(inputPath) {
  if (!inputPath) return "";
  const p = String(inputPath).trim();
  const userHome = process.env.USERPROFILE || process.env.HOME || process.cwd();
  const lower = p.toLowerCase();
  if (lower === "desktop" || lower === "/desktop" || lower === "\\desktop") {
    return path.join(userHome, "Desktop");
  }
  if (lower.startsWith("desktop/") || lower.startsWith("desktop\\")) {
    return path.join(userHome, "Desktop", p.slice(8));
  }
  if (lower === "documents" || lower === "docs") {
    return path.join(userHome, "Documents");
  }
  if (lower.startsWith("documents/") || lower.startsWith("documents\\")) {
    return path.join(userHome, "Documents", p.slice(10));
  }
  if (lower === "downloads") {
    return path.join(userHome, "Downloads");
  }
  if (lower.startsWith("downloads/") || lower.startsWith("downloads\\")) {
    return path.join(userHome, "Downloads", p.slice(10));
  }
  if (lower === "pictures" || lower === "photos") {
    return path.join(userHome, "Pictures");
  }
  if (lower === "music") {
    return path.join(userHome, "Music");
  }
  if (path.isAbsolute(p)) return p;
  return path.resolve(process.cwd(), p);
}

function isUnix() {
  return process.platform === "darwin" || process.platform === "linux";
}

function getClickerExePath() {
  const possiblePaths = [
    path.resolve(__dirname, "../../agent/clicker.exe"),
    path.resolve(__dirname, "../agent/clicker.exe"),
    path.resolve(__dirname, "agent/clicker.exe"),
    path.resolve(__dirname, "../../resources/agent/clicker.exe"),
    path.resolve(__dirname, "../resources/agent/clicker.exe"),
    path.resolve(__dirname, "resources/agent/clicker.exe"),
    path.resolve(__dirname, "../build/clicker.exe"),
    path.resolve(__dirname, "build/clicker.exe"),
    path.resolve(__dirname, "clicker.exe"),
    path.join(process.resourcesPath || "", "agent", "clicker.exe"),
    path.join(process.resourcesPath || "", "clicker.exe"),
    path.join(process.resourcesPath || "", "app", "resources", "agent", "clicker.exe"),
    path.resolve(process.cwd(), "resources/agent/clicker.exe"),
    path.resolve(process.cwd(), "resources/app/build/clicker.exe"),
    path.resolve(process.cwd(), "build/clicker.exe"),
    path.resolve(process.cwd(), "clicker.exe"),
    path.resolve(process.cwd(), "../agent/clicker.exe"),
    path.resolve(process.cwd(), "agent/clicker.exe")
  ];
  for (const p of possiblePaths) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function nativeOpenApp(name) {
  if (!name) return { ok: false, error: "Application name is required" };
  const trimmed = name.trim();
  logCommand("OPEN_APP: " + trimmed);

  const exePath = getClickerExePath();
  if (exePath) {
    try {
      const out = require("child_process").execFileSync(exePath, ["launch", trimmed], { encoding: "utf8", timeout: 6000 });
      const p = JSON.parse(out.trim());
      if (p.success) {
        return { ok: true, result: (p.title || trimmed) + " opened in the foreground.", ...p };
      }
    } catch (e) {
      logError("clicker launch error: " + e.message);
    }
  }

  const known = {
    "notepad": { exe: "notepad.exe", title: "Notepad" },
    "calculator": { exe: "calc.exe", title: "Calculator" },
    "calc": { exe: "calc.exe", title: "Calculator" },
    "command prompt": { exe: "cmd.exe", title: "Command Prompt" },
    "cmd": { exe: "cmd.exe", title: "Command Prompt" },
    "terminal": { exe: "wt.exe", title: "Terminal" },
    "powershell": { exe: "powershell.exe", title: "Windows PowerShell" },
    "file explorer": { exe: "explorer.exe", title: "File Explorer" },
    "explorer": { exe: "explorer.exe", title: "File Explorer" },
    "paint": { exe: "mspaint.exe", title: "Paint" },
    "chrome": { exe: "chrome.exe", title: "Google Chrome" },
    "google chrome": { exe: "chrome.exe", title: "Google Chrome" },
    "edge": { exe: "msedge.exe", title: "Microsoft Edge" },
    "microsoft edge": { exe: "msedge.exe", title: "Microsoft Edge" },
    "vscode": { exe: "code.cmd", title: "Visual Studio Code" },
    "vs code": { exe: "code.cmd", title: "Visual Studio Code" },
    "visual studio code": { exe: "code.cmd", title: "Visual Studio Code" },
    "discord": { exe: "discord", title: "Discord" },
    "telegram": { exe: "telegram", title: "Telegram" },
    "task manager": { exe: "taskmgr.exe", title: "Task Manager" },
    "taskmgr": { exe: "taskmgr.exe", title: "Task Manager" },
    "settings": { exe: "start ms-settings:", title: "Settings" },
    "snipping tool": { exe: "start ms-screenclip:", title: "Snipping Tool" }
  };

  const lowerName = trimmed.toLowerCase();
  const appInfo = known[lowerName];
  const targetExe = appInfo ? appInfo.exe : trimmed;
  const targetTitle = appInfo ? appInfo.title : name;

  const b64Target = Buffer.from(targetExe, "utf8").toString("base64");
  const b64Title = Buffer.from(targetTitle, "utf8").toString("base64");
  const b64Name = Buffer.from(trimmed, "utf8").toString("base64");

  const ps = `
    $target = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64Target}'));
    $title = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64Title}'));
    $name = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64Name}'));
    if ($target -like "start *") {
      Invoke-Expression $target;
    } else {
      $p = Start-Process -FilePath $target -PassThru -WindowStyle Normal -ErrorAction SilentlyContinue;
      if (-not $p) {
        $app = Get-StartApps | Where-Object { $_.Name -like "*$name*" } | Select-Object -First 1;
        if ($app) {
          Start-Process "shell:AppsFolder\$($app.AppID)" -WindowStyle Normal;
        } else {
          Start-Process $target -WindowStyle Normal;
        }
      }
    }
    Start-Sleep -Milliseconds 350;
    $wshell = New-Object -ComObject WScript.Shell;
    if ($p -and $p.Id) { $wshell.AppActivate($p.Id); }
    else { $wshell.AppActivate($title); }
  `;

  try {
    require("child_process").execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps.replace(/\n/g, " ")], { timeout: 8000 });
    return { ok: true, result: trimmed + " opened in the foreground." };
  } catch (err) {
    try {
      require("child_process").execFile("explorer.exe", [targetExe]);
      return { ok: true, result: trimmed + " launched via Explorer." };
    } catch (e2) {
      return { ok: false, error: "Could not launch " + trimmed + ": " + err.message };
    }
  }
}

function nativeMouseClick(args = {}) {
  const scaled = scaleCoordinates(args.x, args.y);
  const x = scaled.x;
  const y = scaled.y;
  const button = (args.button || "left").toLowerCase().trim();
  const clicks = Math.max(1, Math.min(3, Number(args.clicks || args.count || 1)));
  logCommand("MOUSE_CLICK: " + button + " button, clicks=" + clicks + " at (" + x + ", " + y + ") [raw: " + args.x + ", " + args.y + "]");

  if (process.platform === "darwin") {
    return { ok: true, result: "Simulated " + button + " click at (" + x + ", " + y + ") on " + process.platform + "." };
  }

  const exePath = getClickerExePath();
  if (exePath) {
    try {
      const targetX = isNaN(x) ? -1 : Math.round(x);
      const targetY = isNaN(y) ? -1 : Math.round(y);
      const out = require("child_process").execFileSync(exePath, ["click", String(targetX), String(targetY), button, String(clicks)], { encoding: "utf8", timeout: 4000 });
      return { ok: true, result: "Clicked " + button + " mouse button " + (clicks > 1 ? clicks + " times " : "") + (targetX >= 0 ? "at (" + targetX + ", " + targetY + ")" : "at cursor position") + ".", x: targetX, y: targetY };
    } catch (err) {
      logError("clicker click error: " + err.message);
      return { ok: false, error: "Mouse click failed: " + err.message };
    }
  }

  try {
    const isRight = button === "right";
    const down = isRight ? "0x0008" : "0x0002";
    const up = isRight ? "0x0010" : "0x0004";
    let ps = `
      if (-not ([System.Management.Automation.PSTypeName]"Win32.NativeInput").Type) {
        Add-Type -MemberDefinition "[DllImport(\\"user32.dll\\")] public static extern void mouse_event(uint f, uint x, uint y, uint d, int e); [DllImport(\\"user32.dll\\")] public static extern bool SetCursorPos(int x, int y);" -Name NativeInput -Namespace Win32;
      }
    `;
    if (!isNaN(x) && x >= 0 && !isNaN(y) && y >= 0) {
      ps += ` [Win32.NativeInput]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}); `;
    }
    for (let i = 0; i < clicks; i++) {
      ps += ` [Win32.NativeInput]::mouse_event(${down}, 0, 0, 0, 0); [Win32.NativeInput]::mouse_event(${up}, 0, 0, 0, 0); `;
    }
    require("child_process").execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps.replace(/\n/g, " ")}"`, { timeout: 3000 });
    return { ok: true, result: "Clicked " + button + " mouse button." };
  } catch (err) {
    return { ok: false, error: "Mouse click failed: " + err.message };
  }
}

function nativeTypeText(text) {
  if (!text) return { ok: false, error: "Text parameter is required." };
  logCommand("TYPE_TEXT: " + text.slice(0, 50));

  const exePath = getClickerExePath();
  if (exePath) {
    try {
      const b64 = Buffer.from(text, "utf8").toString("base64");
      require("child_process").execFileSync(exePath, ["type", "--b64", b64], { encoding: "utf8", timeout: 6000 });
      return { ok: true, result: "Typed text (" + text.length + " chars)." };
    } catch (e) {
      logError("clicker type error: " + e.message);
    }
  }

  try {
    const b64 = Buffer.from(text, "utf8").toString("base64");
    const ps = `$bytes = [System.Convert]::FromBase64String('${b64}'); $str = [System.Text.Encoding]::UTF8.GetString($bytes); [System.Windows.Forms.SendKeys]::SendWait($str);`;
    require("child_process").execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { timeout: 4000 });
    return { ok: true, result: "Typed text into active window." };
  } catch (e2) {
    return { ok: false, error: "Typing failed: " + e2.message };
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
  try {
    if (action === "createProjectFolder" || action === "openFolder") {
      const rawPath = args.folderPath || args.path || args.name || args.folder || args.directory;
      if (!rawPath) return { ok: false, error: "folderPath is required" };
      const folderPath = resolveUserPath(rawPath);
      if (action === "createProjectFolder") {
        fs.mkdirSync(folderPath, { recursive: true });
        return { ok: true, result: `Created project directory: ${folderPath}`, path: folderPath };
      } else {
        if (!fs.existsSync(folderPath)) {
          fs.mkdirSync(folderPath, { recursive: true });
        }
        if (process.platform === "win32") {
          require("child_process").exec(`explorer.exe "${folderPath}"`);
        }
        return { ok: true, result: `Opened folder: ${folderPath}`, path: folderPath };
      }
    }
    if (action === "writeCodeFile" || action === "createFile" || action === "createPythonFile") {
      const rawPath = args.filePath || args.path || args.fileName || args.file_name;
      const content = args.content ?? args.code ?? "";
      if (!rawPath) return { ok: false, error: "filePath is required" };
      const filePath = resolveUserPath(rawPath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, "utf8");
      return { ok: true, result: `Written file: ${filePath} (${content.length} chars)`, path: filePath };
    }
    if (action === "readFile") {
      const rawPath = args.filePath || args.path || args.fileName || args.file_name;
      if (!rawPath) return { ok: false, error: "filePath is required" };
      const filePath = resolveUserPath(rawPath);
      if (!fs.existsSync(filePath)) return { ok: false, error: `File not found: ${filePath}` };
      const content = fs.readFileSync(filePath, "utf8");
      return { ok: true, content: content.slice(0, 8000), result: `Read ${content.length} chars from ${filePath}`, path: filePath };
    }
    if (action === "deleteFile") {
      const rawPath = args.filePath || args.path || args.fileName || args.file_name;
      if (!rawPath) return { ok: false, error: "filePath is required" };
      const filePath = resolveUserPath(rawPath);
      if (!fs.existsSync(filePath)) return { ok: false, error: `File not found: ${filePath}` };
      fs.unlinkSync(filePath);
      return { ok: true, result: `Deleted file: ${filePath}`, path: filePath };
    }
    if (action === "renameFile" || action === "moveFile") {
      const rawOld = args.oldPath || args.filePath || args.source || args.path || args.old_path;
      const rawNew = args.newPath || args.destination || args.target || args.new_name || args.new_path || args.newName;
      if (!rawOld || !rawNew) return { ok: false, error: "Source and destination paths are required" };
      const oldPath = resolveUserPath(rawOld);
      let newPath = String(rawNew).trim();
      if (!path.isAbsolute(newPath) && !newPath.includes("/") && !newPath.includes("\\")) {
        newPath = path.join(path.dirname(oldPath), newPath);
      } else {
        newPath = resolveUserPath(newPath);
      }
      if (!fs.existsSync(oldPath)) return { ok: false, error: `Source not found: ${oldPath}` };
      fs.mkdirSync(path.dirname(newPath), { recursive: true });
      fs.renameSync(oldPath, newPath);
      return { ok: true, result: `Moved/renamed ${oldPath} to ${newPath}`, oldPath, newPath };
    }
    if (action === "listFiles") {
      const rawPath = args.dirPath || args.path || args.folder || args.directory || process.cwd();
      const dirPath = resolveUserPath(rawPath);
      if (!fs.existsSync(dirPath)) return { ok: false, error: `Directory not found: ${dirPath}` };
      const files = fs.readdirSync(dirPath).slice(0, 100);
      return { ok: true, files, result: `Found ${files.length} items in ${dirPath}`, path: dirPath };
    }
    if (action === "searchFiles") {
      const rawPath = args.folder || args.dirPath || args.path || args.directory || process.cwd();
      const dirPath = resolveUserPath(rawPath);
      const query = (args.query || args.pattern || args.name || "").toLowerCase();
      const ext = (args.extension || "").toLowerCase().replace(/^\./, "");
      const limit = Math.max(1, Math.min(200, Number(args.limit || 50)));
      const results = [];
      function walk(cur, depth = 0) {
        if (depth > 4 || results.length >= limit) return;
        try {
          const items = fs.readdirSync(cur, { withFileTypes: true });
          for (const item of items) {
            if (results.length >= limit) break;
            const matchesQuery = !query || item.name.toLowerCase().includes(query);
            const matchesExt = !ext || item.name.toLowerCase().endsWith("." + ext);
            if (matchesQuery && matchesExt && !item.isDirectory()) {
              results.push(path.join(cur, item.name));
            }
            if (item.isDirectory() && !item.name.startsWith(".") && item.name !== "node_modules") {
              walk(path.join(cur, item.name), depth + 1);
            }
          }
        } catch {}
      }
      walk(dirPath);
      return { ok: true, results, result: `Found ${results.length} files matching query in ${dirPath}` };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: `Unknown project action: ${action}` };
}

const activePowerTokens = new Map();
let lastToolExec = { name: "", time: 0, result: null };

async function callDesktopAgent(tool, args = {}) {
  const now = Date.now();
  const argsKey = JSON.stringify(args);
  if (lastToolExec.name === tool + argsKey && (now - lastToolExec.time) < 350) {
    return lastToolExec.result || { ok: true, result: `Action ${tool} completed.` };
  }

  logCommand(`EXECUTE ${tool} ${argsKey}`);

  let response = null;

  // 1. Applications & Window Activation
  if (["openApplication", "openApp", "launchApp"].includes(tool)) {
    response = nativeOpenApp(args.name || args.application || args.appName);
  } else if (["closeApplication", "closeApp"].includes(tool)) {
    const procName = args.name || args.application || args.appName || "";
    if (!procName) return { ok: false, error: "Application name is required to close." };
    if (process.platform === "win32") {
      let clickerSuccess = false;
      const clickerExe = getClickerExePath();
      if (clickerExe) {
        try {
          const out = require("child_process").execFileSync(clickerExe, ["window", "close", procName], { encoding: "utf8", timeout: 3000 });
          const p = JSON.parse(out.trim());
          if (p.success) clickerSuccess = true;
        } catch {}
      }
      
      let taskkillSuccess = false;
      let taskkillError = "";
      try {
        const target = procName.endsWith(".exe") ? procName : procName + ".exe";
        const out = require("child_process").execSync(`taskkill /F /IM "${target}" 2>&1`, { encoding: "utf8", timeout: 3000 });
        if (out.includes("SUCCESS:") || out.includes("PID")) {
          taskkillSuccess = true;
        } else if (out.includes("ERROR:") || out.includes("not found")) {
          taskkillError = out.trim();
        }
      } catch (e) {
        taskkillError = (e.stdout ? e.stdout.toString() : e.message).trim();
      }

      if (clickerSuccess || taskkillSuccess) {
        response = { ok: true, result: `Closed application ${procName}.` };
      } else {
        response = { ok: false, error: `Could not close application "${procName}": ${taskkillError || "Process not running or not found."}` };
      }
    } else {
      response = { ok: true, result: `Close requested for ${procName}.` };
    }
  } else if (["switchApplication", "activateApp", "focusWindow"].includes(tool)) {
    const target = args.name || args.application || args.title || args.window || "";
    const clickerExe = getClickerExePath();
    if (clickerExe && target) {
      try {
        const out = require("child_process").execFileSync(clickerExe, ["activate", target], { encoding: "utf8", timeout: 4000 });
        const p = JSON.parse(out.trim());
        if (p.success) {
          response = { ok: true, result: `Activated window "${p.title || target}" into the foreground.`, hwnd: p.hwnd };
        } else {
          response = { ok: false, error: p.error || `Window "${target}" not found.` };
        }
      } catch (e) {
        logError("switchApplication error: " + e.message);
        response = { ok: false, error: `Failed to activate window "${target}": ${e.message}` };
      }
    } else {
      response = { ok: false, error: "Target application/window name is required." };
    }
  }

  // 2. Window Geometry & State Tools
  else if (["minimizeWindow", "maximizeWindow", "restoreWindow", "closeWindow"].includes(tool)) {
    const action = tool === "minimizeWindow" ? "minimize" :
                   tool === "maximizeWindow" ? "maximize" :
                   tool === "restoreWindow" ? "restore" : "close";
    const target = args.name || args.application || args.title || args.window || "";
    const clickerExe = getClickerExePath();
    if (clickerExe) {
      try {
        const out = require("child_process").execFileSync(clickerExe, ["window", action, target], { encoding: "utf8", timeout: 3000 });
        const p = JSON.parse(out.trim());
        if (p.success) {
          response = { ok: true, result: `Window ${action} executed successfully for "${target || 'active window'}".` };
        } else {
          response = { ok: false, error: p.error || `Window ${action} failed.` };
        }
      } catch (err) {
        logError(`window ${action} error: ${err.message}`);
        response = { ok: false, error: `Window ${action} failed: ${err.message}` };
      }
    } else {
      response = { ok: false, error: "Clicker binary not available for window operation." };
    }
  }

  // 3. Mouse Clicks, Cursor Move, Drag, Typing & Keyboard Hotkeys
  else if (["mouseClick", "clickScreen", "doubleClick", "rightClick", "click"].includes(tool)) {
    response = nativeMouseClick(args);
  } else if (["moveMouse", "mouseMove", "moveCursor"].includes(tool)) {
    const clickerExe = getClickerExePath();
    const scaled = scaleCoordinates(args.x, args.y);
    const x = scaled.x;
    const y = scaled.y;
    logCommand(`MOVE_MOUSE: to (${x}, ${y}) [raw: ${args.x}, ${args.y}]`);
    if (clickerExe && !isNaN(x) && !isNaN(y)) {
      try {
        require("child_process").execFileSync(clickerExe, ["move", String(x), String(y)], { encoding: "utf8", timeout: 3000 });
        response = { ok: true, result: `Moved mouse cursor to (${x}, ${y}).`, x, y };
      } catch (err) {
        logError(`clicker move error: ${err.message}`);
        response = { ok: false, error: `Move mouse failed: ${err.message}` };
      }
    } else {
      response = { ok: false, error: "Invalid coordinates for mouse move." };
    }
  } else if (["mouseDrag", "drag"].includes(tool)) {
    const clickerExe = getClickerExePath();
    const startScaled = scaleCoordinates(args.startX ?? args.x1 ?? 0, args.startY ?? args.y1 ?? 0);
    const endScaled = scaleCoordinates(args.endX ?? args.x2 ?? 0, args.endY ?? args.y2 ?? 0);
    const sX = startScaled.x;
    const sY = startScaled.y;
    const eX = endScaled.x;
    const eY = endScaled.y;
    const btn = (args.button || "left").toLowerCase().trim();
    const dur = Number(args.duration || 200);
    logCommand(`MOUSE_DRAG: from (${sX}, ${sY}) to (${eX}, ${eY})`);
    if (clickerExe) {
      try {
        require("child_process").execFileSync(clickerExe, ["drag", String(sX), String(sY), String(eX), String(eY), btn, String(dur)], { encoding: "utf8", timeout: 4000 });
        response = { ok: true, result: `Dragged mouse from (${sX}, ${sY}) to (${eX}, ${eY}).`, sX, sY, eX, eY };
      } catch (err) {
        logError(`clicker drag error: ${err.message}`);
        response = { ok: false, error: `Drag failed: ${err.message}` };
      }
    } else {
      response = { ok: false, error: "Clicker binary not found for drag action." };
    }
  } else if (["mouseScroll", "scrollMouse", "browserScroll", "desktopBrowserScroll"].includes(tool)) {
    const amount = Number(args.amount || args.lines || 120);
    const dir = (args.direction || "down").toLowerCase();
    try {
      await fetch("http://127.0.0.1:3001/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scroll", direction: dir, amount })
      });
    } catch {}
    const clickerExe = getClickerExePath();
    if (clickerExe) {
      try {
        require("child_process").execFileSync(clickerExe, ["scroll", String(amount), dir], { timeout: 2000 });
      } catch {}
    }
    response = { ok: true, result: `Scrolled page ${dir} by ${amount} units.` };
  } else if (["typeText", "keyboardType", "desktopType", "type", "browserType", "desktopBrowserType"].includes(tool)) {
    const text = args.text || args.content || args.string || args.query || "";
    try {
      await fetch("http://127.0.0.1:3001/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "type", selector: args.selector, text })
      });
    } catch {}
    response = nativeTypeText(text);
  } else if (["pressKey", "hotkey", "sendShortcut", "press"].includes(tool)) {
    const combo = args.combo || args.key || args.shortcut || "enter";
    const clickerExe = getClickerExePath();
    if (clickerExe) {
      try {
        require("child_process").execFileSync(clickerExe, ["key", combo.replace(/"/g, '')], { timeout: 2000 });
        response = { ok: true, result: `Pressed key combination: ${combo}.` };
      } catch (err) {
        response = { ok: false, error: `Key press failed: ${err.message}` };
      }
    } else {
      response = { ok: false, error: "Clicker binary not available." };
    }
  }

  // 4. Audio & Volume Suite
  else if (tool === "volumeUp") {
    const clickerExe = getClickerExePath();
    if (clickerExe) {
      try {
        const out = require("child_process").execFileSync(clickerExe, ["volume", "up"], { encoding: "utf8", timeout: 3000 });
        const p = JSON.parse(out.trim());
        response = { ok: true, result: `Increased master volume to ${p.level}%.`, level: p.level };
      } catch {}
    }
    if (!response) {
      try {
        require("child_process").execSync(`powershell -NoProfile -Command "$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys([char]175)"`, { timeout: 2000 });
        response = { ok: true, result: "Increased master volume." };
      } catch (e) {
        response = { ok: false, error: `Volume up failed: ${e.message}` };
      }
    }
  } else if (tool === "volumeDown") {
    const clickerExe = getClickerExePath();
    if (clickerExe) {
      try {
        const out = require("child_process").execFileSync(clickerExe, ["volume", "down"], { encoding: "utf8", timeout: 3000 });
        const p = JSON.parse(out.trim());
        response = { ok: true, result: `Decreased master volume to ${p.level}%.`, level: p.level };
      } catch {}
    }
    if (!response) {
      try {
        require("child_process").execSync(`powershell -NoProfile -Command "$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys([char]174)"`, { timeout: 2000 });
        response = { ok: true, result: "Decreased master volume." };
      } catch (e) {
        response = { ok: false, error: `Volume down failed: ${e.message}` };
      }
    }
  } else if (tool === "setVolume") {
    const level = Math.max(0, Math.min(100, Number(args.level ?? args.volume ?? 50)));
    const clickerExe = getClickerExePath();
    if (clickerExe) {
      try {
        const out = require("child_process").execFileSync(clickerExe, ["volume", "set", String(level)], { encoding: "utf8", timeout: 3000 });
        const p = JSON.parse(out.trim());
        response = { ok: true, result: `Set master volume to ${p.level ?? level}%.`, level: p.level ?? level };
      } catch (e) {
        response = { ok: false, error: `Volume set failed: ${e.message}` };
      }
    } else {
      response = { ok: false, error: "Clicker binary not found." };
    }
  } else if (tool === "muteToggle") {
    const clickerExe = getClickerExePath();
    if (clickerExe) {
      try {
        const out = require("child_process").execFileSync(clickerExe, ["volume", "mute"], { encoding: "utf8", timeout: 3000 });
        const p = JSON.parse(out.trim());
        response = { ok: true, result: `Audio master ${p.muted ? 'muted' : 'unmuted'}.`, muted: p.muted };
      } catch {}
    }
    if (!response) {
      try {
        require("child_process").execSync(`powershell -NoProfile -Command "$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys([char]173)"`, { timeout: 2000 });
        response = { ok: true, result: "Toggled audio mute." };
      } catch (e) {
        response = { ok: false, error: `Mute toggle failed: ${e.message}` };
      }
    }
  }

  // 5. Display Brightness Suite
  else if (tool === "brightnessUp") {
    const clickerExe = getClickerExePath();
    if (clickerExe) {
      try {
        const out = require("child_process").execFileSync(clickerExe, ["brightness", "up"], { encoding: "utf8", timeout: 3000 });
        const p = JSON.parse(out.trim());
        response = { ok: true, result: `Increased display brightness to ${p.level}%.`, level: p.level };
      } catch (e) {
        response = { ok: false, error: `Brightness up failed: ${e.message}` };
      }
    } else {
      response = { ok: false, error: "Clicker binary not found." };
    }
  } else if (tool === "brightnessDown") {
    const clickerExe = getClickerExePath();
    if (clickerExe) {
      try {
        const out = require("child_process").execFileSync(clickerExe, ["brightness", "down"], { encoding: "utf8", timeout: 3000 });
        const p = JSON.parse(out.trim());
        response = { ok: true, result: `Decreased display brightness to ${p.level}%.`, level: p.level };
      } catch (e) {
        response = { ok: false, error: `Brightness down failed: ${e.message}` };
      }
    } else {
      response = { ok: false, error: "Clicker binary not found." };
    }
  } else if (tool === "setBrightness") {
    const level = Math.max(0, Math.min(100, Number(args.level ?? args.brightness ?? 75)));
    const clickerExe = getClickerExePath();
    if (clickerExe) {
      try {
        const out = require("child_process").execFileSync(clickerExe, ["brightness", "set", String(level)], { encoding: "utf8", timeout: 3000 });
        const p = JSON.parse(out.trim());
        response = { ok: true, result: `Set display brightness to ${p.level ?? level}%.`, level: p.level ?? level };
      } catch (e) {
        response = { ok: false, error: `Brightness set failed: ${e.message}` };
      }
    } else {
      response = { ok: false, error: "Clicker binary not found." };
    }
  }

  // 6. Clipboard Management
  else if (tool === "getClipboard") {
    const clickerExe = getClickerExePath();
    if (clickerExe) {
      try {
        const out = require("child_process").execFileSync(clickerExe, ["clipboard", "get"], { encoding: "utf8", timeout: 3000 });
        const p = JSON.parse(out.trim());
        response = { ok: true, text: p.text || "", result: `Clipboard content: "${(p.text || '').slice(0, 100)}"` };
      } catch {}
    }
    if (!response) {
      try {
        const out = require("child_process").execSync(`powershell -NoProfile -Command "Get-Clipboard"`, { encoding: "utf8", timeout: 2000 });
        response = { ok: true, text: out.trim(), result: `Clipboard content: "${out.trim().slice(0, 100)}"` };
      } catch {
        response = { ok: true, text: "", result: "Clipboard is empty." };
      }
    }
  } else if (tool === "copySelected") {
    const clickerExe = getClickerExePath();
    if (clickerExe) {
      try { require("child_process").execFileSync(clickerExe, ["key", "ctrl+c"], { timeout: 2000 }); } catch {}
    } else {
      try { require("child_process").execSync(`powershell -NoProfile -Command "$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys('^c')"`, { timeout: 2000 }); } catch {}
    }
    response = { ok: true, result: "Copied selected content to clipboard." };
  } else if (tool === "pasteClipboard") {
    if (args.text) {
      try {
        const b64 = Buffer.from(args.text, "utf8").toString("base64");
        const exePath = getClickerExePath();
        if (exePath) {
          require("child_process").execFileSync(exePath, ["clipboard", "set", "--b64", b64], { timeout: 2000 });
        }
      } catch {}
    }
    const clickerExe = getClickerExePath();
    if (clickerExe) {
      try { require("child_process").execFileSync(clickerExe, ["key", "ctrl+v"], { timeout: 2000 }); } catch {}
    }
    response = { ok: true, result: "Pasted clipboard content into active window." };
  } else if (tool === "clearClipboard") {
    const clickerExe = getClickerExePath();
    if (clickerExe) {
      try { require("child_process").execFileSync(clickerExe, ["clipboard", "clear"], { timeout: 2000 }); } catch {}
    }
    response = { ok: true, result: "Cleared clipboard." };
  }

  // 7. Gated Power Actions
  else if (tool === "requestPowerAction") {
    const act = (args.action || "shutdown").toLowerCase();
    const token = `PWR-${Math.floor(1000 + Math.random() * 9000)}`;
    activePowerTokens.set(token, { action: act, expires: Date.now() + 60000 });
    response = {
      ok: true,
      token,
      action: act,
      result: `Power action '${act}' requested. Confirmation token generated: ${token}. Confirm to proceed.`
    };
  } else if (tool === "executePowerAction") {
    const token = args.token || args.confirmationToken || args.execute_token || "";
    const act = (args.action || "").toLowerCase();
    if (!token || !activePowerTokens.has(token)) {
      response = { ok: false, error: "Invalid or expired power confirmation token." };
    } else {
      const record = activePowerTokens.get(token);
      activePowerTokens.delete(token);
      if (Date.now() > record.expires) {
        response = { ok: false, error: "Power confirmation token has expired." };
      } else {
        const actionToRun = act || record.action;
        if (actionToRun === "lock") {
          try { require("child_process").exec("rundll32.exe user32.dll,LockWorkStation"); } catch {}
          response = { ok: true, result: "Workstation locked successfully." };
        } else if (actionToRun === "sleep") {
          try { require("child_process").exec("powrprof.dll,SetSuspendState 0,1,0"); } catch {}
          response = { ok: true, result: "System entered sleep state." };
        } else if (actionToRun === "restart") {
          try { require("child_process").exec("shutdown.exe /r /t 0"); } catch {}
          response = { ok: true, result: "System restart initiated." };
        } else if (actionToRun === "shutdown") {
          try { require("child_process").exec("shutdown.exe /s /t 0"); } catch {}
          response = { ok: true, result: "System shutdown initiated." };
        } else {
          response = { ok: true, result: `Executed power action: ${actionToRun}` };
        }
      }
    }
  }

  // 8. System Information & Screenshots
  else if (tool === "systemInfo") {
    const os = require("os");
    response = {
      ok: true,
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      hostname: os.hostname(),
      uptime_seconds: Math.floor(os.uptime()),
      total_mem_gb: Math.round((os.totalmem() / (1024 * 1024 * 1024)) * 10) / 10,
      free_mem_gb: Math.round((os.freemem() / (1024 * 1024 * 1024)) * 10) / 10,
      cpus: os.cpus().length,
      cpu_model: os.cpus()[0]?.model || "Unknown",
      result: `System: ${os.platform()} ${os.release()} (${os.arch()}), Host: ${os.hostname()}, CPU: ${os.cpus()[0]?.model} (${os.cpus().length} cores), RAM: ${Math.round((os.freemem() / (1024 * 1024 * 1024)) * 10) / 10}GB free of ${Math.round((os.totalmem() / (1024 * 1024 * 1024)) * 10) / 10}GB.`
    };
  } else if (tool === "gpuInfo") {
    try {
      const out = require("child_process").execSync("wmic path win32_VideoController get name,AdapterRAM,DriverVersion /format:list", { encoding: "utf8", timeout: 4000 });
      response = { ok: true, output: out.trim(), result: `GPU Info: ${out.replace(/\r?\n+/g, ', ').trim()}` };
    } catch {
      response = { ok: true, result: "Standard DirectX/OpenGL display adapter detected." };
    }
  } else if (tool === "temperatureInfo") {
    try {
      const out = require("child_process").execSync("powershell -NoProfile -Command \"Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | Select-Object -ExpandProperty CurrentTemperature\"", { encoding: "utf8", timeout: 2000 });
      const raw = Number(out.trim());
      if (!isNaN(raw) && raw > 2732) {
        const degC = Math.round((raw / 10 - 273.15) * 10) / 10;
        response = { ok: true, temperature_c: degC, result: `CPU Thermal Zone Temperature: ${degC}°C` };
      }
    } catch {}
    if (!response) {
      response = { ok: true, supported: false, result: "Hardware temperature sensors are not exposed by the ACPI BIOS on this system." };
    }
  } else if (["takeScreenshot", "saveScreenshot", "analyzeScreenshot", "readScreen"].includes(tool)) {
    const clickerExe = getClickerExePath();
    const savePath = args.filePath || args.path || (tool === "saveScreenshot" ? path.join(DATA_DIR, "screenshots", `screenshot_${Date.now()}.png`) : null);
    if (clickerExe) {
      try {
        if (savePath) {
          const out = require("child_process").execFileSync(clickerExe, ["screenshot", savePath], { encoding: "utf8", timeout: 4000 });
          const p = JSON.parse(out.trim());
          response = { ok: true, path: savePath, result: `Screenshot saved successfully to ${savePath}.` };
        } else {
          const out = require("child_process").execFileSync(clickerExe, ["screenshot", "--base64"], { encoding: "utf8", timeout: 4000 });
          const p = JSON.parse(out.trim());
          response = { ok: true, data: p.data, format: "base64", result: "Screenshot captured successfully." };
        }
      } catch (e) {
        logError("Screenshot failed: " + e.message);
      }
    }
    if (!response) {
      response = { ok: false, error: "Native screenshot capture failed." };
    }
  } else if (["enableAutoStart", "disableAutoStart", "getAutoStartStatus"].includes(tool)) {
    const clickerExe = getClickerExePath();
    const sub = tool === "enableAutoStart" ? "enable" : tool === "disableAutoStart" ? "disable" : "status";
    if (clickerExe) {
      try {
        const exeTarget = process.execPath || path.resolve(process.cwd(), "MYRAA.exe");
        const out = require("child_process").execFileSync(clickerExe, ["autostart", sub, exeTarget], { encoding: "utf8", timeout: 3000 });
        const p = JSON.parse(out.trim());
        response = { ok: Boolean(p.success), ...p, result: `AutoStart ${sub} status: ${p.enabled ?? p.success}` };
      } catch (e) {
        logError("AutoStart action failed: " + e.message);
      }
    }
    if (!response) {
      response = { ok: false, error: `Failed to execute ${tool}.` };
    }
  } else if (tool === "desktopBrowserFillForm") {
    const fields = args.fields || args.formData || {};
    const clickerExe = getClickerExePath();
    if (!clickerExe) {
      response = { ok: false, error: "Clicker engine not found for form filling." };
    } else {
      let filled = 0;
      for (const [key, val] of Object.entries(fields)) {
        const typeRes = nativeTypeText(String(val));
        if (!typeRes.ok) {
          return { ok: false, error: `Failed typing form field "${key}": ${typeRes.error}` };
        }
        try { require("child_process").execFileSync(clickerExe, ["key", "tab"], { timeout: 1000 }); } catch {}
        filled++;
      }
      response = { ok: true, filled, result: `Filled ${filled} form fields into active browser window.` };
    }
  } else if (["desktopBrowserOpenTab", "browserOpenTab"].includes(tool)) {
    const clickerExe = getClickerExePath();
    if (!clickerExe) {
      response = { ok: false, error: "Clicker engine not found to open browser tab." };
    } else {
      try {
        require("child_process").execFileSync(clickerExe, ["key", "ctrl+t"], { timeout: 2000 });
        if (args.url) nativeOpenWebsite({ url: args.url });
        response = { ok: true, result: "Opened new browser tab." };
      } catch (err) {
        response = { ok: false, error: `Failed to open browser tab: ${err.message}` };
      }
    }
  } else if (["desktopBrowserCloseTab", "browserCloseTab"].includes(tool)) {
    const clickerExe = getClickerExePath();
    if (!clickerExe) {
      response = { ok: false, error: "Clicker engine not found to close browser tab." };
    } else {
      try {
        require("child_process").execFileSync(clickerExe, ["key", "ctrl+w"], { timeout: 2000 });
        response = { ok: true, result: "Closed active browser tab." };
      } catch (err) {
        response = { ok: false, error: `Failed to close browser tab: ${err.message}` };
      }
    }
  } else if (["desktopBrowserGoBack", "browserGoBack"].includes(tool)) {
    const clickerExe = getClickerExePath();
    if (!clickerExe) {
      response = { ok: false, error: "Clicker engine not found to navigate browser back." };
    } else {
      try {
        require("child_process").execFileSync(clickerExe, ["key", "alt+left"], { timeout: 2000 });
        response = { ok: true, result: "Navigated back in browser history." };
      } catch (err) {
        response = { ok: false, error: `Failed to go back: ${err.message}` };
      }
    }
  } else if (["desktopBrowserGoForward", "browserGoForward"].includes(tool)) {
    const clickerExe = getClickerExePath();
    if (!clickerExe) {
      response = { ok: false, error: "Clicker engine not found to navigate browser forward." };
    } else {
      try {
        require("child_process").execFileSync(clickerExe, ["key", "alt+right"], { timeout: 2000 });
        response = { ok: true, result: "Navigated forward in browser history." };
      } catch (err) {
        response = { ok: false, error: `Failed to go forward: ${err.message}` };
      }
    }
  } else if (tool === "browserTabAction") {
    const action = (args.action || "new").toLowerCase().trim();
    const clickerExe = getClickerExePath();
    if (!clickerExe) {
      response = { ok: false, error: "Clicker binary not found for browser tab action." };
    } else if (action === "new" || action === "open") {
      try { require("child_process").execFileSync(clickerExe, ["key", "ctrl+t"], { timeout: 2000 }); } catch {}
      if (args.url) nativeOpenWebsite({ url: args.url });
      response = { ok: true, result: "Opened new browser tab." };
    } else if (action === "close") {
      try { require("child_process").execFileSync(clickerExe, ["key", "ctrl+w"], { timeout: 2000 }); } catch {}
      response = { ok: true, result: "Closed active browser tab." };
    } else if (action === "next") {
      try { require("child_process").execFileSync(clickerExe, ["key", "ctrl+tab"], { timeout: 2000 }); } catch {}
      response = { ok: true, result: "Switched to next browser tab." };
    } else if (action === "prev" || action === "previous") {
      try { require("child_process").execFileSync(clickerExe, ["key", "ctrl+shift+tab"], { timeout: 2000 }); } catch {}
      response = { ok: true, result: "Switched to previous browser tab." };
    } else {
      response = { ok: false, error: `Unsupported tab action: ${action}` };
    }
    } else if (tool === "browserMediaControl") {
    const action = (args.action || "play_pause").toLowerCase().trim();
    const clickerExe = getClickerExePath();
    if (clickerExe) {
      if (["play", "pause", "play_pause", "toggle"].includes(action)) {
        try { require("child_process").execFileSync(clickerExe, ["key", "mediaplaypause"], { timeout: 2000 }); } catch {}
        response = { ok: true, result: "Toggled media playback (Play/Pause)." };
      } else if (["next", "skip"].includes(action)) {
        try { require("child_process").execFileSync(clickerExe, ["key", "medianext"], { timeout: 2000 }); } catch {}
        response = { ok: true, result: "Skipped to next media track." };
      } else if (["prev", "previous"].includes(action)) {
        try { require("child_process").execFileSync(clickerExe, ["key", "mediaprev"], { timeout: 2000 }); } catch {}
        response = { ok: true, result: "Returned to previous media track." };
      } else if (action === "stop") {
        try { require("child_process").execFileSync(clickerExe, ["key", "mediastop"], { timeout: 2000 }); } catch {}
        response = { ok: true, result: "Stopped media playback." };
      } else if (["mute", "unmute"].includes(action)) {
        try { require("child_process").execFileSync(clickerExe, ["volume", "mute"], { timeout: 2000 }); } catch {}
        response = { ok: true, result: "Toggled audio mute state." };
      } else if (action === "volume") {
        const val = Math.max(0, Math.min(100, Number(args.value ?? 50)));
        try { require("child_process").execFileSync(clickerExe, ["volume", "set", String(val)], { timeout: 2000 }); } catch {}
        response = { ok: true, result: `Set volume to ${val}%.` };
      } else if (["fullscreen", "exit_fullscreen"].includes(action)) {
        try { require("child_process").execFileSync(clickerExe, ["key", "f"], { timeout: 2000 }); } catch {}
        response = { ok: true, result: "Toggled browser video fullscreen." };
      } else {
        response = { ok: false, error: `Unknown media action: ${action}` };
      }
    } else {
      response = { ok: false, error: "Clicker binary not found for media control." };
    }
  }

  // 9. Browser Automation & Searches
  else if (["desktopBrowserClick", "browserClick"].includes(tool)) {
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
      if (bRes.ok) clickedPlaywright = true;
    } catch {}

    if (!clickedPlaywright && (args.x !== undefined || args.y !== undefined)) {
      response = nativeMouseClick(args);
    } else if (clickedPlaywright) {
      response = { ok: true, result: `Clicked: ${target || 'target element'}` };
    } else {
      response = { ok: false, error: "Browser click failed on element: " + (target || "unknown") };
    }
  } else if (["browserOpen", "desktopBrowserOpen", "openWebsite"].includes(tool)) {
    let url = args.url || (args.name ? `https://${args.name}.com` : "https://google.com");
    if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://" + url;
    try {
      await fetch("http://127.0.0.1:3001/api/navigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
    } catch {}
    nativeOpenWebsite({ url });
    response = { ok: true, result: `Opened ${url} in browser.` };
  } else if (["searchYouTube", "playYouTube"].includes(tool)) {
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
    response = { ok: true, result: `Searched and opened YouTube video for "${q}".` };
  } else if (["searchWeb", "searchGoogle", "browserSearch", "desktopBrowserSearch"].includes(tool)) {
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
    response = { ok: true, result: `Searched for "${q}".` };
  } else if (tool === "searchGitHub") {
    const q = args.query || "";
    const ghUrl = `https://github.com/search?q=${encodeURIComponent(q)}`;
    nativeOpenWebsite({ url: ghUrl });
    response = { ok: true, result: `Opened GitHub search for "${q}".` };
  }

  // 10. File Operations & Developer Tools
  else if (["createProjectFolder", "writeCodeFile", "createFile", "readFile", "listFiles", "createPythonFile", "deleteFile", "renameFile", "moveFile", "openFolder", "searchFiles"].includes(tool)) {
    response = nativeDeveloperProjectTool(tool, args);
  } else if (tool === "runPythonScript") {
    const rawPath = args.path || args.script || args.filePath || "";
    if (!rawPath) return { ok: false, error: "Script path parameter is required." };
    const scriptPath = resolveUserPath(rawPath);
    if (!fs.existsSync(scriptPath)) {
      return { ok: false, error: `Python script not found: ${scriptPath}` };
    }
    try {
      const output = require("child_process").execFileSync("python.exe", [scriptPath], { encoding: "utf8", timeout: 30000 });
      response = { ok: true, stdout: output.trim(), result: `Executed python script ${scriptPath}.` };
    } catch (err) {
      response = { ok: false, error: err.message, stderr: err.stderr?.toString() || "" };
    }
  } else if (["runTerminalCommand", "executeCommand"].includes(tool)) {
    const cmd = args.command || args.cmd || "";
    response = nativeRunTerminal(cmd);
  }

  // 11. Fallback: Pre-call ensureDesktopAgent and call Python Daemon
  if (!response) {
    await ensureDesktopAgent();
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
        if (data.ok) response = data;
      }
    } catch (e) {
      logError(`desktop agent execute error: ${e.message}`);
    }
  }

  if (!response) {
    response = { ok: false, error: `Action ${tool} failed: execution handler or desktop agent returned an error.` };
  }

  lastToolExec = { name: tool + argsKey, time: now, result: response };
  return response;
}
async function startServer() {
  const app = (0, import_express.default)();
  const PORT = 3e3;
  app.use(import_express.default.json());

  app.get("/api/auth/token", (req, res) => {
    res.json({ token: MYRAA_AUTH_TOKEN });
  });

  // Security: Allow requests from local UI and validate token for remote
  app.use((req, res, next) => {
    if (req.method === "GET" || req.method === "OPTIONS" || req.path === "/api/auth/token") {
      return next();
    }
    const ip = req.ip || req.socket.remoteAddress || "";
    const host = req.headers.host || "";
    const isLocalhost = ip.includes("127.0.0.1") || ip.includes("::1") || host.includes("localhost") || host.includes("127.0.0.1");
    const tokenHeader = req.headers["x-myraa-token"] || req.headers["authorization"]?.replace("Bearer ", "");
    if (isLocalhost || tokenHeader === MYRAA_AUTH_TOKEN) {
      return next();
    }
    return res.status(401).json({ ok: false, error: "Unauthorized: Missing or invalid x-myraa-token header." });
  });

  // Local agent health bridge on port 8765 to prevent frontend console connection refused warnings
  try {
    const http8765 = require("http");
    const s8765 = http8765.createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");
      if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", mode: "native" }));
    });
    s8765.listen(8765, "127.0.0.1", () => {
      console.log("[Legacy Port 8765 Bridge] Active on 127.0.0.1:8765");
    });
    s8765.on("error", () => {});
  } catch {}

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
  
    app.get("/api/settings/wake-word", async (req, res) => {
    try {
      const s = loadSettingsFile();
      res.json({ ok: true, wakeWordEnabled: Boolean(s.wakeWordEnabled), wakePhrase: s.wakePhrase || "hey myraa" });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/settings/wake-word", async (req, res) => {
    try {
      const { enabled, phrase } = req.body;
      const current = loadSettingsFile();
      const next = { ...current };
      if (enabled !== undefined) next.wakeWordEnabled = Boolean(enabled);
      if (phrase !== undefined) next.wakePhrase = String(phrase).trim();
      saveSettingsFile(next);
      logCommand(`WAKE_WORD_SETTINGS: enabled=${next.wakeWordEnabled} phrase="${next.wakePhrase}"`);
      res.json({ ok: true, wakeWordEnabled: next.wakeWordEnabled, wakePhrase: next.wakePhrase });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

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
      if (patch.apiKeys?.gemini && typeof patch.apiKeys.gemini === "string") {
        try {
          setGeminiApiKey(patch.apiKeys.gemini);
        } catch {}
      }
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
  
  app.post("/api/execute", async (req, res) => {
    try {
      const { tool, args } = req.body;
      if (!tool) return res.status(400).json({ ok: false, error: "Tool name is required." });
      const result = await callDesktopAgent(tool, args || {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/command", async (req, res) => {
    try {
      const { command } = req.body;
      if (!command) return res.status(400).json({ ok: false, error: "Command is required." });
      const result = nativeRunTerminal(command);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
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
  app.get("/api/proxy", (req, res) => {
    res.status(403).json({ error: "Proxy endpoint disabled for security." });
  });
  app.get("/api/web-proxy", (req, res) => {
    res.status(403).send("Web proxy endpoint disabled for security.");
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
    const urlObj = new URL(request.url || "", `http://${request.headers.host || "127.0.0.1"}`);
    if (urlObj.pathname === "/live") {
      const token = urlObj.searchParams.get("token") || request.headers["x-myraa-token"];
      if (!token || token !== MYRAA_AUTH_TOKEN) {
        console.warn(`[Security] Rejected unauthorized WebSocket upgrade to /live from ${request.socket.remoteAddress}`);
        socket.write("HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nUnauthorized: Missing or invalid token\r\n");
        socket.destroy();
        return;
      }
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
            if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.inlineData?.data) {
                  clientWs.send(JSON.stringify({ type: "audio", audio: part.inlineData.data }));
                }
                if (part.text) {
                  clientWs.send(JSON.stringify({ type: "transcription", role: "model", text: part.text }));
                  currentModelResponseText += part.text;
                }
              }
            }
            if (message.serverContent?.outputTranscription?.text) {
              clientWs.send(JSON.stringify({ type: "transcription", role: "model", text: message.serverContent.outputTranscription.text }));
              currentModelResponseText += message.serverContent.outputTranscription.text;
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
            if (message.serverContent?.userTurn?.parts) {
              for (const part of message.serverContent.userTurn.parts) {
                if (part.text) {
                  clientWs.send(JSON.stringify({ type: "transcription", role: "user", text: part.text }));
                  dialogueHistory.push({ role: "user", text: part.text });
                }
              }
            }
            if (message.serverContent?.inputTranscription?.text) {
              clientWs.send(JSON.stringify({ type: "transcription", role: "user", text: message.serverContent.inputTranscription.text }));
              dialogueHistory.push({ role: "user", text: message.serverContent.inputTranscription.text });
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
                      logError(`[TOOL_ERROR] ${fc.name}: ${err.message}`);
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { ok: false, error: `Tool ${fc.name} error: ${err.message}` } },
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
            if (event.code !== 1000 && event.code !== 1005) {
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
        }
      });
      clientWs.send(JSON.stringify({ type: "status", status: "connected" }));
      setTimeout(() => {
        try {
          session.sendClientContent({
            turns: [{
              role: "user",
              parts: [{ text: "Hello Myraa! You are now online. Please say hello and warmly greet Aarav out loud right now!" }]
            }],
            turnComplete: true
          });
        } catch (greetErr) {
          console.warn("Initial greeting turn notice:", greetErr.message);
        }
      }, 250);
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
          } else if ((msg.type === "text" || msg.type === "text_input" || msg.type === "message") && (typeof msg.text === "string" || typeof msg.message === "string")) {
            const text = (msg.text || msg.message || "").trim();
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
    const candidateDirs = [
    __dirname,
    import_path2.default.join(__dirname, "dist"),
    import_path2.default.join(process.cwd(), "dist"),
    process.cwd()
  ];
  let distPath = candidateDirs.find(d => import_fs.default.existsSync(import_path2.default.join(d, "index.html"))) || __dirname;

  // Serve static assets WITHOUT auto-index so "/" always goes through token injection
  app.use(import_express.default.static(distPath, { index: false }));
  if (import_fs.default.existsSync(import_path2.default.join(distPath, "assets"))) {
    app.use("/assets", import_express.default.static(import_path2.default.join(distPath, "assets")));
  }
  if (import_fs.default.existsSync(import_path2.default.join(process.cwd(), "assets"))) {
    app.use("/assets", import_express.default.static(import_path2.default.join(process.cwd(), "assets")));
  }

    app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/live") || req.path.startsWith("/assets/")) {
      return next();
    }
    const indexPath = import_path2.default.join(distPath, "index.html");
    if (import_fs.default.existsSync(indexPath)) {
      let html = import_fs.default.readFileSync(indexPath, "utf8");
      const injectScript = `<script>window.__MYRAA_TOKEN__="${MYRAA_AUTH_TOKEN}";</script>`;
      if (!html.includes("__MYRAA_TOKEN__")) {
        html = html.replace("<head>", "<head>" + injectScript);
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } else {
      next();
    }
  });
  server.listen(PORT, "127.0.0.1", () => {
    logStartup(`MYRAA V2 server started on http://localhost:${PORT}`);
    console.log(`[Server] Running on http://localhost:${PORT}`);
    // Desktop agent is verified on demand before calls
    ensureLocalAgent().catch(() => {});
  });
}
startServer().catch((error) => {
  console.error("Failed to start server startup sequence:", error);
});
//# sourceMappingURL=server.cjs.map
