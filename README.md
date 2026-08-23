# 🌸 MYRAA — Autonomous 3D AI Desktop Companion & PC Control Engine

[![Release](https://img.shields.io/github/v/release/agra-aarav15/MYRAA?color=6366f1&style=for-the-badge)](https://github.com/agra-aarav15/MYRAA/releases/tag/v1.0.0)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Android%20%7C%20macOS%20%7C%20Linux-blue?style=for-the-badge)](https://github.com/agra-aarav15/MYRAA)
[![License](https://img.shields.io/badge/License-MIT-emerald?style=for-the-badge)](LICENSE)

**Created and designed by Aarav.**
*Released under the permissive open-source **MIT License**.*

---

## 📥 Downloads (Latest Release v1.0.0)

Direct release packages for Windows and Android are available on [GitHub Releases v1.0.0](https://github.com/agra-aarav15/MYRAA/releases/tag/v1.0.0):

| Distribution File | Platform | Description | Download Link |
| :--- | :--- | :--- | :--- |
| **`MYRAA-Setup-1.0.0.exe`** | Windows 10/11 | Full NSIS Windows Installer with Desktop Shortcut & Uninstaller | [⬇️ Download Setup EXE](https://github.com/agra-aarav15/MYRAA/releases/download/v1.0.0/MYRAA-Setup-1.0.0.exe) |
| **`MYRAA-Portable-1.0.0.exe`** | Windows 10/11 | Standalone Single-File Executable (Zero Installation Required) | [⬇️ Download Portable EXE](https://github.com/agra-aarav15/MYRAA/releases/download/v1.0.0/MYRAA-Portable-1.0.0.exe) |
| **`MYRAA-v1.0.0-Windows-Universal-Portable.zip`** | Windows 10/11 | Universal Portable Package (Unzip & Run `START_SERVER.bat`) | [⬇️ Download Portable ZIP](https://github.com/agra-aarav15/MYRAA/releases/download/v1.0.0/MYRAA-v1.0.0-Windows-Universal-Portable.zip) |
| **`MYRAA.apk`** | Android 8.0+ | Native Android Mobile Application Package | [⬇️ Download APK](https://github.com/agra-aarav15/MYRAA/releases/download/v1.0.0/MYRAA.apk) |

---

## 🌟 Overview

**MYRAA** is a personal 3D AI companion and autonomous PC control engine. Built on a distributed triple-daemon architecture, she bridges expressive 3D kinematics with autonomous computer control, native mouse and keyboard simulation, Playwright browser automation, and developer tool execution.

> **✨ A 3D companion who listens, remembers, speaks, and helps you code and control your computer.**

---

## ⚡ Key Features

### 🪟 Guaranteed Foreground Application Launcher
- Launches desktop applications (Notepad, Chrome, Calculator, VS Code, Paint, Spotify, Explorer, Terminal, Settings) with **guaranteed foreground presentation**.
- Uses Windows Shell elevation (`Start-Process -WindowStyle Normal`) paired with COM `WScript.Shell.AppActivate` to bring application windows directly in front of the active screen with keyboard focus and active Taskbar icons.

### 🖱️ Native Mouse & Keyboard Injection
- Multi-tier mouse control: click anywhere by screen coordinates `(x, y)`, fire left, right, middle, or double clicks, move the cursor smoothly, and scroll windows.
- Native keyboard typing and text pasting directly into active windows via Win32 `user32.dll` APIs and `SendKeys` integration.

### 🌐 Headed Playwright Browser Automation
- Headed browser automation bridge on port `3001` for DOM element clicking, search execution, web navigation, and video playback on YouTube, Google, GitHub, and more.

### 🎨 Obsidian Glassmorphism UI
- **Pitch-Black Studio Space:** Deep obsidian `#000000` background aesthetic.
- **Reflective Ground Mirror:** Realistic horizon reflection beneath the 3D VRM avatar.
- **Translucent Frosted Drawers:** 28px backdrop blur for Settings, Recalls, and Topic management.

### 🧠 Episodic Cognitive Memory
- Persistent memory store (`memories.json`) remembering user preferences, topics, past conversations, and personalized project context across sessions.

---

## 🚀 Quick Start Guide

### 🪟 Windows (Recommended)
1. **Option 1 (Installer):** Download and run [`MYRAA-Setup-1.0.0.exe`](https://github.com/agra-aarav15/MYRAA/releases/download/v1.0.0/MYRAA-Setup-1.0.0.exe).
2. **Option 2 (Standalone Portable):** Download [`MYRAA-Portable-1.0.0.exe`](https://github.com/agra-aarav15/MYRAA/releases/download/v1.0.0/MYRAA-Portable-1.0.0.exe) and double-click to launch immediately.
3. **Option 3 (Portable ZIP):** Download and extract [`MYRAA-v1.0.0-Windows-Universal-Portable.zip`](https://github.com/agra-aarav15/MYRAA/releases/download/v1.0.0/MYRAA-v1.0.0-Windows-Universal-Portable.zip), then double-click `START_SERVER.bat`.

---

### 📱 Android & Mobile Phones
1. Download and install [`MYRAA.apk`](https://github.com/agra-aarav15/MYRAA/releases/download/v1.0.0/MYRAA.apk) on your Android device.
2. Alternatively, open `http://<YOUR_PC_IP>:3000` in your mobile browser while connected to the same Wi-Fi network.

---

### 🍎 macOS & 🐧 Linux
1. Clone the repository:
   ```bash
   git clone https://github.com/agra-aarav15/MYRAA.git
   cd MYRAA
   ```
2. Run the 1-click setup and start:
   ```bash
   chmod +x setup.sh start.sh
   ./setup.sh && ./start.sh
   ```

---

## 💻 58+ Built-in PC & Developer Tools

| Category | Tools & Capabilities |
| :--- | :--- |
| **PC Automation** | `openApplication`, `closeApplication`, `mouseClick`, `doubleClick`, `rightClick`, `mouseMove`, `mouseScroll`, `typeText`, `pasteClipboard` |
| **Developer Tools** | `runTerminalCommand`, `createProjectFolder`, `writeCodeFile`, `readFile`, `listFiles`, `createPythonFile`, `runPythonScript` |
| **IDE Integration** | Launch and focus Visual Studio Code, Cursor, Antigravity IDE, Terminal, Command Prompt, PowerShell |
| **Browser & Media** | Playwright browser clicking, typing, page scrolling, YouTube video search & playback, Google search |
| **System Control** | Volume adjustment, screen brightness, window minimize/maximize/restore, clipboard management |
| **Cognitive Memory** | Persistent episodic memory store (`memories.json`) with auto-consolidation and query tools |

---

## 🎙️ Sample Voice & Chat Prompts

- *"Hey Myraa, open Notepad and write a project checklist."*
- *"Hey Myraa, open Chrome and search for latest Formula 1 race results."*
- *"Hey Myraa, open Calculator and compute 45 * 128."*
- *"Hey Myraa, play lofi hip hop on YouTube."*
- *"Hey Myraa, create a new folder called demo-app with an index.html file."*
- *"Hey Myraa, what were we discussing yesterday?"*

---

## 🔄 CI/CD Automation

All Windows distribution executables and Android APK packages are automatically built and tested using GitHub Actions via [`.github/workflows/build-release.yml`](.github/workflows/build-release.yml).

---

## 📜 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.  
Copyright (c) 2026 **Aarav**. All rights reserved.