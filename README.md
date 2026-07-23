# MYRAA — 3D Anime AI Companion & Desktop Assistant

**v1.2.0** — Real-time 3D avatar with voice AI, self-evolving memory, desktop automation, screen vision, and web agent.

[![GitHub release](https://img.shields.io/badge/version-1.2.0-emerald)](https://github.com/agra-aarav15/MYRAA/releases)
[![Build](https://github.com/agra-aarav15/MYRAA/actions/workflows/release.yml/badge.svg)](https://github.com/agra-aarav15/MYRAA/actions)

---

## 🚀 Quick Start (Dev Mode)

**Requires:** Node.js 22+, npm

```bash
cd E:\MYRAA
npm install

# Terminal 1 — Backend Server
node server.js

# Terminal 2 — Frontend
npx vite --host 0.0.0.0 --port 5173
```

Open **http://localhost:5173** in Chrome or Edge.

### Add API Keys (Required for AI responses)

1. Open Settings ⚙️ → **AI ENGINE** tab
2. Paste your Gemini (or Groq/OpenRouter) API key
3. Click **Save Changes**

[Get a free Gemini API key →](https://aistudio.google.com/app/apikey)

---

## 📦 Install the Desktop EXE

The Windows installer is already built at:

```
E:\MYRAA\dist_electron\MYRAA-Companion-1.2.0-win-x64.exe
```

- Double-click to install
- Launches the backend + frontend in one window
- Configure API keys through Settings → AI ENGINE → Save
- Settings are saved to `%APPDATA%\MYRAA\settings.json`

---

## 📱 Phone APK

Push a git tag to trigger the GitHub Actions build:

```bash
git checkout main
git merge myraa-v1.2.0-overhaul
git push origin main
git tag v1.2.0
git push origin v1.2.0
```

The APK is published to **GitHub Releases**: https://github.com/agra-aarav15/MYRAA/releases

Install the debug APK on any Android phone — enable "Install from unknown sources."

---

## 🌐 Features (v1.2.0)

### 🎯 What's New in v1.2.0
- **Real audio-driven lip-sync** — mouth moves with actual speech frequency bands, not a fake timer
- **Gapless voice playback** — no more robotic stuttering or silence gaps
- **Self-evolving memory** — AI-extracted facts from conversation, update/merge semantics
- **Autonomous web search** — MYRAA searches the web on her own when you ask current-info questions
- **Premium female voice** — warm adult voice selection (never a child-like default)
- **Provider fallback chain** — Gemini → Groq → OpenRouter auto-rotation on rate limits
- **Mood-aware persona** — MYRAA's energy/happiness/affection feeds into her responses
- **Working desktop tools** — "open notepad", "open youtube and play starboy" with chat confirmations
- **API keys from settings UI** — no more editing files; save keys through the interface
- **Human micro-motions** — saccadic eye jitter, double-blinks, emotion-triggered gestures (hair tuck, thinking pose, wave, shy face touch)

### Core Capabilities
| Feature | Description |
|---------|-------------|
| **3D Avatar** | Anime model with 115 bones, facial blendshapes, real lip-sync, idle physics |
| **Voice AI** | Microsoft Edge Neural TTS + Gemini Live bidirectional audio streaming |
| **AI Brain** | Gemini 2.0 Flash, Groq Llama, OpenRouter — configurable with auto-fallback |
| **Desktop Tools** | Launch apps, search web/YouTube, control volume, file management |
| **Screen Vision** | Real-time screen sharing + WebRTC desktop capture |
| **Web Search** | Autonomous DuckDuckGo search + page reading + computer-use agent (Playwright) |
| **Memory** | Self-evolving categorized memory (identity, preferences, projects, goals, relationships) |
| **Proactive Engine** | Time-aware greetings, idle check-ins, mood tracking |

---

## 💬 How to Use

| Action | Say or Click |
|--------|-----|
| Chat | Type in the input bar, press Enter |
| Voice input | Click the 🎤 mic button (hands-free mode) |
| Open an app | "open notepad", "open chrome", "open calculator" |
| Search the web | "search web for latest React features" — or just ask |
| Play music | "search YouTube for lo-fi beats" |
| Show screen | Click the 👁️ icon (top bar) |
| View memories | Click the 🧠 Brain icon |
| Toggle voice output | Click the 🔊 speaker button |
| Configure | Click the ⚙️ Settings icon |

---

## 📁 Project Structure

```
E:\MYRAA\
├── src/
│   ├── App.jsx                    # Main UI & state machine
│   ├── components/
│   │   ├── AvatarCanvas.jsx       # Three.js 3D avatar renderer
│   │   ├── SettingsModal.jsx      # Configuration UI
│   │   ├── MemoryDashboardModal.jsx # Memory viewer
│   │   └── BrowserAgentModal.jsx  # Web browser agent UI
│   └── services/
│       ├── aiProvider.js          # AI provider proxy & system prompt
│       ├── liveVoiceEngine.js     # Gemini Live WebSocket audio
│       ├── memoryStore.js         # Categorized memory store
│       ├── desktopCommandEngine.js # Desktop automation parser
│       ├── moodEngine.js          # 5-axis mood state tracker
│       └── proactiveEngine.js     # Time-aware greetings & idle prompts
├── server.js                      # Express backend (port 3001)
├── electron/
│   └── main.js                    # Electron desktop shell
├── public/model/                  # 3D avatar .glb assets
├── dist_electron/                 # Built EXE installers
├── .github/workflows/
│   ├── release.yml                # Tag-triggered EXE + APK release
│   └── build-apk.yml              # Continuous APK build (main)
└── package.json
```

---

## ⚙️ Configuration

All API keys are stored in **`settings.json`** (gitignored, never committed). Template at `settings.example.json`.

You can add keys via:
1. **Settings UI** — Open Settings → AI Engine → paste key → Save
2. **Direct edit** — Copy `settings.example.json` → `settings.json`, edit, restart server
3. **Environment variables** — `GEMINI_API_KEY=...`, `GROQ_API_KEY=...`, etc.

### Voice Presets
| Voice | Description |
|-------|-------------|
| `en-US-AvaNeural` | Warm, conversational (default) |
| `en-US-JennyNeural` | Friendly, warm |
| `en-US-AriaNeural` | Expressive, conversational |

### Gemini Live Presets
| Preset | Description |
|--------|-------------|
| `Aoede` | Sweet, gentle young female (recommended) |
| `Kore` | Soft, soothing, caring |

---

## 🔄 Update & Release

```bash
# Push changes
git add .
git commit -m "description of changes"
git push origin main

# Create a new release (triggers CI to build EXE + APK)
git tag v1.2.1
git push origin v1.2.1
```

GitHub Actions builds the Windows EXE and Android APK, then publishes both to **Releases**.

---

## 📱 Android (Termux)

```bash
pkg update && pkg upgrade -y
pkg install git nodejs -y
git clone https://github.com/agra-aarav15/MYRAA.git
cd MYRAA && npm install && npm start
```

Open `http://localhost:5173` in your phone's browser.

---

## 🛠 Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Canned responses | No API key | Settings → AI Engine → paste key → Save |
| "Failed to fetch" | Backend not running | Run `node server.js` |
| EXE SmartScreen warning | New unsigned app | "More info" → "Run anyway" |
| APK blocked by Play Protect | Debug app | "Install anyway" |
| Desktop command fails | PowerShell execution policy | `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` |

---

*Built with ❤️ for Aarav — v1.2.0*
