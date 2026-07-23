# HANDOFF TO GEMINI — MYRAA COMPANION v1.2.0

You are taking over development of **MYRAA** — a 3D AI Girlfriend Companion and Autonomous Desktop/Mobile Agent built for **Aarav**.

- **Repository:** `E:\MYRAA` (Windows)
- **GitHub:** `https://github.com/agra-aarav15/MYRAA` (branch `myraa-v1.2.0-overhaul`, not yet merged to `main`)
- **Backup existing:** `E:\MYRAA_BACKUP_v1.0.0` (untouched, v1.0 release state)

---

## Current Status: v1.2.0 Overhaul — COMPLETE

All 14 demands from the user have been addressed. 13/14 are fully implemented in code. 1 (APK binary) requires a CI tag push because no Android SDK is available on this Windows machine.

### ✅ What Is Done

| Area | What Was Done |
|------|---------------|
| **Voice quality** | `pickPremiumFemaleVoice()` priority list (never default to child-like voice), pitch 0.95, Edge TTS `-2%` prosody, warm adult female default |
| **Voice latency** | True streaming via `new Audio(url)` GET endpoint — browser plays progressively. Gapless PCM scheduler in `liveVoiceEngine.js` with jitter buffer. Anti-aliased downsampling. |
| **Speaker button** | Ref-based state (`isAutoSpeakRef`) avoids stale closures. `stopPlayback()` kills ALL sources via Set (not just last one). Unmute in Live mode routes through Live engine. |
| **Memory** | AI-driven extraction via `/api/memory/extract` (Gemini call). Update/merge semantics via `wordSimilarity()`. Cross-pipeline sync (`syncMemoriesFromServer()` on startup). Live and text modes both extract. |
| **Desktop tools** | Fixed PowerShell UWP catch-chain (UWP apps go through `explorer.exe`). Expanded app map (spotify, discord, slack, terminal). Results surfaced to chat in all 3 paths (user text command, AI reply command, Live transcription). |
| **Avatar realism** | Real AnalyserNode-driven lip-sync (frequency bands → viseme weights). Saccadic eye jitter. Double-blinks + long stares. Emotion-triggered gesture library (hair tuck, thinking pose, wave, shy face-touch, nod). Speech-dampened breathing. |
| **Persona / Response quality** | Removed hardcoded Gemini key. Real provider fallback chain (Gemini → Groq → OpenRouter). Mood injection (`getMoodContextForPrompt()`). Few-shot variety library. Temperature 0.9. History truncated to last 20 turns. |
| **Web Agent** | Layer A: `/api/web/search` (DuckDuckGo, no key) + `/api/web/read` (fetch + Gemini summarize). **Autonomous pre-fetch**: when user asks current-info questions (detected by `needsWebInfo` regex), results inject into AI context. Layer B: `/api/web/agent` (Playwright, lazy import, not installed). |
| **Settings → API keys** | `GET/POST /api/settings/apikeys` — SettingsModal reads/writes keys to server-side `settings.json`. UI → Save writes to disk. |
| **EXE build** | Electron-builder works. `dist_electron/MYRAA-Companion-1.2.0-win-x64.exe` (202MB) and portable variant present. |
| **GitHub Releases** | `.github/workflows/release.yml` — builds EXE + APK on `git tag v*`, publishes to Releases. |
| **Settings path** | Packaged EXE stores `settings.json` in `%APPDATA%\MYRAA\` (writable). Dev mode uses `__dirname` (project root). |

### 🔴 Remaining Gaps

| Gap | Details |
|-----|---------|
| **APK binary** | Cannot build locally (no Android SDK). `git tag v1.2.0 && git push origin v1.2.0` triggers CI at GitHub Actions which runs `./gradlew assembleDebug`. |
| **Autonomous AI tool-calling** | MYRAA cannot decide to search the web mid-conversation via LLM tool-calling. The current "autonomous" search is a pre-send regex hook that fires on keywords. A proper tool-calling loop (AI emits `[tool:search]query[/tool]` → app executes → re-inject) would be more robust. |
| **Layer B (Playwright)** | Declared in package.json but not installed. `npm install playwright && npx playwright install chromium` needed. Code in `/api/web/agent` handles absence gracefully (501). |
| **In-app icon upgrades** | Favicon replaced. Idle prompts have emoji. But in-app Lucide icon swaps were deferred (subjective, user said "avoid frontend changes except the listed ones"). |
| **Mood decay triggers** | `personal_topic`/`work_topic`/`new_interest` mood events are wired but only fire on text mode, not Live transcription. |
| **Memory extraction throttled** | Only fires every 15s (`AI_EXTRACT_COOLDOWN_MS`) and requires a Gemini key. Without a key, falls back to 6-regex `autoExtractMemoriesFromChat()` which is narrow. |

---

## Architecture Overview

### Technology Stack
- **Frontend:** React 19 + Vite 8, TailwindCSS 4, Three.js + GLTFLoader, Lucide React
- **Backend:** Node.js + Express 5 (port 3001), msedge-tts, @google/genai, ws
- **Build:** Electron 43 + electron-builder 26 (EXE), Capacitor 8 (APK)
- **3D Model:** `public/model/source/kawaii_girl.glb` (8.2MB, 115 bones, facial morphs)
- **Voice:** Microsoft Edge Neural TTS + Gemini Live WebSocket (16kHz PCM in, 24kHz PCM out)

### File Map

| File | Purpose |
|------|---------|
| `src/App.jsx` | Main UI — state machine, TTS engine, microphone, chat, screen vision, mood, memory, tools |
| `src/components/AvatarCanvas.jsx` | Three.js 3D renderer — model loading, bones, morph targets, lip-sync, physics |
| `src/services/aiProvider.js` | AI proxy client — system prompt (`BASE_SYSTEM_PROMPT`), provider fallback chain, mood+memory injection |
| `src/services/liveVoiceEngine.js` | WebSocket + Web Audio API — gapless PCM playback, jitter buffer, analyser tap |
| `src/services/memoryStore.js` | localStorage + server persistence — AI extraction, merge semantics, `wordSimilarity()` |
| `src/services/desktopCommandEngine.js` | Regex command parser — app launch, web search, compound intents |
| `src/services/moodEngine.js` | 5-axis mood tracker — happiness, energy, affection, focus, curiosity |
| `src/services/proactiveEngine.js` | Time-aware greetings, idle check-ins, getSessionGreeting() |
| `server.js` | Express server — TTS, AI proxy, tools, memory, web search, settings, Gemini Live WS |
| `electron/main.js` | Electron shell — spawns server, loads Vite dev or dist |
| `package.json` | electron-builder config, scripts, dependencies |

### Key Data Flows

**Chat (text mode):**
1. User types message → `handleSendMessage()`
2. `executeDirectCommand()` checks for desktop commands → pushes confirmation to chat
3. `autoExtractMemoriesFromChat()` regex-based memory (fallback)
4. `needsWebInfo` check → pre-fetches `/api/web/search` if detected
5. `sendAiChatMessage()` → `POST /api/ai/proxy` → server resolves API key from `settings.json` → calls Gemini/Groq/OpenRouter
6. Response parsed for emotion tag → avatar expression set
7. `executeDirectCommand()` on AI reply (in case AI emitted a tool command)
8. `fallbackSpeakText()` plays response via Edge TTS or browser fallback
9. `extractMemoriesFromTranscript()` AI-driven memory extraction (15s cooldown)

**Chat (Live voice mode):**
1. Microphone → ScriptProcessor → 16kHz PCM → WebSocket → Gemini Live
2. Gemini → 24kHz PCM → WebSocket → `playAudioChunk()` → gapless scheduler → AnalyserNode → speakers
3. Transcriptions appear via `onTranscription` → pushed to messages
4. `executeDirectCommand().then()` captures tool results in both user and model transcriptions
5. `onTurnComplete` triggers `extractMemoriesFromTranscript()`

**Settings persistence:**
1. SettingsModal reads `getAiConfig()` (localStorage) for UI state
2. On open, also fetches `GET /api/settings/apikeys` to populate key fields
3. On Save: `saveAiConfig()` (localStorage) + `POST /api/settings/apikeys` (writes to `settings.json`)
4. Server's `loadSettingsSafe()` reads `settings.json` fresh per request
5. Packaged EXE: `%APPDATA%\MYRAA\settings.json`; Dev: `E:\MYRAA\settings.json`

### Developer Guidelines (must preserve)

1. **Girlfriend Persona** — AI responses MUST start with an emotion tag: `[emotion:happy]`, `[emotion:angry]`, `[emotion:shy]`, `[emotion:excited]`, `[emotion:thinking]`, `[emotion:sad]`. This drives the 3D avatar's face/body animations.
2. **Animation Safety** — All bone/morph writes must use LERP with dt bounds: `Math.min(speed * dt * 60, 1)`. Always guard `bonesRef.current`.
3. **Non-Blocking Async** — All backend/browser calls must have `.catch()` fallbacks. The 3D canvas must render at 60 FPS regardless of network/WS hiccups.
4. **Revertible Changes** — Work on branches. Commits should be atomic and focused.
5. **No C: Drive Files** — Everything in `E:\MYRAA`.

---

## Key Configuration

### `settings.json` (gitignored, never committed)
```json
{
  "apiKeys": {
    "gemini": "AIzaSy...",
    "groq": "gsk_...",
    "openrouter": "sk-or-..."
  },
  "ttsVoice": "en-US-AvaNeural",
  "ttsRate": "+0%",
  "ttsPitch": "-2%",
  "ttsVolume": "+0%",
  "voicePreset": "Aoede"
}
```

### Git Tag Workflow for Releases
```bash
git checkout main
git merge myraa-v1.2.0-overhaul
git push origin main
git tag v1.2.0
git push origin v1.2.0
# CI builds EXE + APK, publishes to GitHub Releases
```

### How to Run Locally
```bash
# Terminal 1
cd E:\MYRAA && node server.js

# Terminal 2
cd E:\MYRAA && npx vite --host 0.0.0.0 --port 5173
```

Open `http://localhost:5173`. Add API keys via Settings → AI ENGINE → Save.

---

## Git History (19 commits on `myraa-v1.2.0-overhaul`)

```
a2206b6 docs: comprehensive v1.2.0 README
8233dc6 fix(build): settings.json resolves to AppData in packaged EXE
2e8cb3e feat(settings): API keys now saveable from frontend UI
315585e feat(web): autonomous web search
9086e0b fix(speech): remove double command execution
2595397 fix(audit): TTS prosody + replyToolResults + Live confirmations
7bdcec6 fix(gaps): 4 honest fixups for previously overclaimed features
3e27d97 style(premium): cleaner favicon + warmer emoji-rich idle prompts
8f34cc9 feat(web-agent): autonomous web search/read + on-demand computer-use
f796be0 fix(tools): robust desktop tool execution
8a74cad feat(avatar): real audio-driven lip-sync + human micro-motion upgrades
18c78fb feat(persona): wire mood + memory into both Live and text-mode loops
6579731 feat(ai): provider fallback chain, mood injection, few-shot variety
1538d62 feat(memory): real self-evolving memory — AI extraction, merge, sync
32a84e8 feat(tts): server-side prosody support + safe settings/key loader
7b1b8d5 fix(voice): premium female voice, low-latency streaming, speaker button
ba2ad06 fix(voice): rewrite liveVoiceEngine playback
5428142 chore(v1.2.0): bump version 0.0.0 -> 1.2.0
```
