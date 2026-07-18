# MYRAA - 3D Anime AI Companion & Desktop Assistant

1-Command Startup Package for PC, Local Network, and Termux Mobile Access!

---

## 🚀 1-Command Local Launch (PC)

Run this **single command** in your terminal:

```bash
npm start
```

This single command automatically launches both:
1. **Node.js Desktop Automation & Screen Vision Backend** (`http://0.0.0.0:3001`)
2. **Vite 3D React App** (`http://0.0.0.0:5173`)

---

## 📱 1-Click Copy-Paste Instructions for Android (Termux)

If you want to download and run MYRAA directly on your Android phone using **Termux**, copy and paste this command block into Termux:

```bash
pkg update && pkg upgrade -y && pkg install git nodejs -y && git clone https://github.com/agra-aarav15/MYRAA.git && cd MYRAA && npm install && npm start
```

After running the command in Termux, open your phone's browser (Chrome) and go to:
```text
http://localhost:5173
```

---

## 🌐 Method B: Wi-Fi Access from PC to Phone (No Termux required)
1. Connect PC and Phone to the same Wi-Fi.
2. Run `npm start` on PC.
3. Open Phone Browser to: `http://<YOUR-PC-IP>:5173`

---

## 🐙 Push Updates to GitHub

```bash
git add .
git commit -m "Update MYRAA"
git push origin main
```

---

## ⚙️ Features
- **Custom 3D Model**: `one_one.glb` (Stylized Anime Character).
- **Natural Human Voice**: 100% Free browser speech synthesis filtering for natural female voices.
- **Continuous Microphone**: Hands-free continuous speech recognition.
- **Screen Vision & WebRTC Screen Sharing**: 1-click desktop snapshot inspection & browser screen share.
- **Multi-Provider AI Brain**: Groq Cloud, Google Gemini, xAI Grok, OpenAI, Custom Endpoints, and Offline Simulation Mode.
