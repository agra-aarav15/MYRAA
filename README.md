# MYRAA — Autonomous 3D AI Desktop Companion

MYRAA is an autonomous 3D AI companion and intelligent desktop agent built for Windows. Powered by Google Gemini Live and local desktop automation, MYRAA provides real-time voice conversation, multimodal screen vision, and full PC control.

---

## ✨ Features

- **🎙️ Real-Time Voice Interaction:** Ultra-low latency voice calls with dynamic conversational pauses.
- **👁️ Multimodal Screen Vision:** Real-time visual analysis of code, terminal errors, web pages, and media.
- **⚡ 57+ Desktop Agent Tools:** System monitoring (CPU, RAM, GPU, Disk), app launching, browser automation, file operations, audio control, and window management.
- **🧠 Persistent Cognitive Memory:** Context-aware memory retention across sessions.
- **🔒 Privacy First:** Your Gemini API key is stored locally in `secrets.json` and never transmitted to third parties.

---

## 🚀 Quick Start

### 1. Prerequisites
- **Windows 10/11 (64-bit)**
- **Node.js v18+**

### 2. Configuration
Copy `secrets.example.json` to `secrets.json` and add your Google Gemini API key:
```json
{
  "geminiApiKey": "YOUR_GEMINI_API_KEY_HERE"
}
```

### 3. Launching
Double-click `START_SERVER.bat` or run:
```bash
set NODE_ENV=production
node dist/server.cjs
```
Open your browser at `http://localhost:3000`.

---

## 🛡️ License & Copyright
Built by **Aarav**. All original branding and code assets are private and proprietary.
