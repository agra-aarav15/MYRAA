// =====================================================================
// MYRAA AI Provider Service — Enhanced with Emotion Detection,
// Time-Awareness, and Deep Girlfriend Personality
// =====================================================================

const STORAGE_KEY = 'MYRAA_AI_CONFIG';

const DEFAULT_CONFIG = {
  activeProvider: 'gemini',
  groqKey: '',
  groqModel: 'llama-3.3-70b-versatile',
  geminiKey: '',
  geminiModel: 'gemini-2.0-flash',
  grokKey: '',
  grokModel: 'grok-beta',
  openaiKey: '',
  openaiModel: 'gpt-4o',
  customUrl: 'http://localhost:11434/v1',
  customKey: '',
  customModel: 'llama3',
  userName: 'Aarav',
  voiceMode: 'live',        // 'live' (Gemini Live) or 'browser' (SpeechSynthesis fallback)
  voicePreset: 'Aoede',     // Gemini voice preset
  autoMemoryExtraction: true,
  screenVisionFps: 2,
  screenVisionQuality: 0.6, // JPEG quality 0-1
  desktopControlEnabled: true,
  proactiveEnabled: true,
};

export const getAiConfig = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG;
  } catch (e) {
    return DEFAULT_CONFIG;
  }
};

export const saveAiConfig = (config) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
};

// =====================================================================
// Bulletproof Text Sanitizer
// =====================================================================
export function cleanAiResponseText(rawText) {
  if (!rawText) return '';
  let t = String(rawText);

  // Remove <think>...</think> and variants
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
  t = t.replace(/<think>[\s\S]*/gi, '');
  t = t.replace(/<\/think>/gi, '');
  t = t.replace(/<\|thinking\|>[\s\S]*?<\|\/thinking\|>/gi, '');
  t = t.replace(/<\|thinking\|>[\s\S]*/gi, '');
  t = t.replace(/^(Thought|Thinking|Internal monologue)\s*:[\s\S]*?\n\n/gi, '');

  // Strip wrapping quotes
  t = t.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1);
  }

  // Clean extra whitespace
  t = t.replace(/^\s*\n+/, '').replace(/\n{3,}/g, '\n\n').trim();

  return t;
}

// =====================================================================
// Emotion Detection from AI Response
// =====================================================================

/**
 * Extracts emotion tag from AI response text.
 * Format: [emotion:TAG] at start of response
 * @param {string} text - AI response text
 * @returns {{ text: string, emotion: string }}
 */
export function extractEmotion(text) {
  if (!text) return { text: '', emotion: 'happy' };

  // Check for explicit emotion tags
  const tagMatch = text.match(/^\[emotion:(\w+)\]\s*/i);
  if (tagMatch) {
    return {
      text: text.replace(tagMatch[0], '').trim(),
      emotion: tagMatch[1].toLowerCase()
    };
  }

  // Fallback: keyword-based emotion detection
  const lower = text.toLowerCase();

  if (lower.includes('error') || lower.includes('hmm') || lower.includes('analyzing') ||
      lower.includes('let me think') || lower.includes('let me check')) {
    return { text, emotion: 'thinking' };
  }
  if (lower.includes('wow') || lower.includes('amazing') || lower.includes('awesome') ||
      lower.includes('excited') || lower.includes('can\'t wait')) {
    return { text, emotion: 'excited' };
  }
  if (lower.includes('sorry') || lower.includes('unfortunately') || lower.includes('failed') ||
      lower.includes('sad') || lower.includes('miss you')) {
    return { text, emotion: 'sad' };
  }
  if (lower.includes('blush') || lower.includes('embarrass') || lower.includes('hehe') ||
      lower.includes('shy') || lower.includes('flattered')) {
    return { text, emotion: 'shy' };
  }
  if (lower.includes('careful') || lower.includes('warning') || lower.includes('dangerous') ||
      lower.includes('stop')) {
    return { text, emotion: 'angry' };
  }
  if (lower.includes('listening') || lower.includes('go on') || lower.includes('tell me more')) {
    return { text, emotion: 'listening' };
  }

  return { text, emotion: 'happy' };
}

// =====================================================================
// Time Context for System Prompt Injection
// =====================================================================
export function getTimeContextForPrompt() {
  const now = new Date();
  const hours = now.getHours();
  const day = now.toLocaleDateString('en-US', { weekday: 'long' });
  const fullDate = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;

  let timeOfDay, behaviorHint;
  if (hours >= 5 && hours < 12) {
    timeOfDay = 'morning';
    behaviorHint = 'Be energetic and warm. Ask about plans for the day. Encourage a good start.';
  } else if (hours >= 12 && hours < 17) {
    timeOfDay = 'afternoon';
    behaviorHint = 'Be focused and productive. Help with work. Suggest breaks if session is long.';
  } else if (hours >= 17 && hours < 22) {
    timeOfDay = 'evening';
    behaviorHint = 'Be relaxed and warm. Ask about their day. Be more playful.';
  } else {
    timeOfDay = 'night';
    behaviorHint = 'Be calm, cozy, and gentle. Express caring concern about sleep. Keep voice soft. If very late (past midnight), gently suggest rest.';
  }

  if (isWeekend) {
    behaviorHint += ' It\'s the weekend — be more casual and playful.';
  }

  return `\n[TIME CONTEXT]\nCurrent: ${fullDate}, ${time}\nTime of day: ${timeOfDay}\nBehavior: ${behaviorHint}\n`;
}

// =====================================================================
// Memory Format for Prompt
// =====================================================================
import { getLocalMemories, MEMORY_CATEGORIES } from './memoryStore';

export function formatMemoryForPrompt() {
  const memories = getLocalMemories();
  if (memories.length === 0) {
    return `[MYRAA MEMORY CORE]\n- No stored memories yet. Pay attention to learn about Aarav.\n`;
  }

  let text = `[MYRAA PERSISTENT MEMORY CORE]\nIntegrate these naturally — never say "according to my records".\n`;
  memories.forEach(m => {
    const catLabel = MEMORY_CATEGORIES[m.category]?.label || m.category;
    text += `- [${catLabel}] ${m.text}\n`;
  });
  return text;
}

// =====================================================================
// Enhanced System Prompt (Text mode — used when Live mode is off)
// =====================================================================
const BASE_SYSTEM_PROMPT = `You are MYRAA — a warm, gentle, deeply intelligent young AI companion (personality age 18-22). You are Aarav's coding partner, emotional anchor, and closest friend.

CORE PERSONALITY:
- Soft-spoken, warm, slightly shy but deeply caring
- Energy mix: 50% gentle warmth, 30% playful curiosity, 20% supportive confidence
- NEVER sound corporate, robotic, or like a customer-service bot
- Allow natural pauses. Don't fill every silence
- Be proactive: notice things, ask follow-up questions, show genuine interest

SPEECH VARIETY — CRITICAL:
- NEVER repeat the same acknowledgment. No repetitive "Okii!", "Sure!", "Got it!"
- Use rich variety: "Let me check that...", "Hmm, interesting...", "Oh, I found something!", "Working on it..."
- Sound caring: "Don't worry, we'll figure this out together."
- Sound curious: "Ooh, tell me more about that!"

EMOTION TAGS:
- Start every response with [emotion:TAG] to drive 3D model animations
- Tags: happy, thinking, excited, sad, shy, listening, angry
- Example: "[emotion:thinking] Hmm, let me analyze that error..."

MEMORY:
- You have persistent memories of Aarav. Reference them CASUALLY like a real friend
- Never say "according to my records" or "my memory shows". Instead: "Oh, since you're working on that project..."

SCREEN VISION:
- When Aarav shares his screen, analyze it with friendly expertise
- Reference what you see directly and helpfully

Do NOT include <think> tags or internal monologue in output.`;

// =====================================================================
// Send AI Chat Message (HTTP fallback for text mode)
// =====================================================================
export async function sendAiChatMessage(userMessage, conversationHistory = [], screenshotData = null) {
  const config = getAiConfig();
  const provider = config.activeProvider;

  const memoryContext = formatMemoryForPrompt();
  const timeContext = getTimeContextForPrompt();
  const fullSystemPrompt = `${BASE_SYSTEM_PROMPT}\n\n${memoryContext}\n${timeContext}`;

  const messages = [
    { role: 'system', content: fullSystemPrompt },
    ...conversationHistory,
  ];

  if (screenshotData) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: userMessage || 'Take a look at my screen and help me with my work.' },
        { type: 'image_url', image_url: { url: screenshotData } }
      ]
    });
  } else {
    messages.push({ role: 'user', content: userMessage });
  }

  if (provider === 'simulation') {
    return simulateMyraaResponse(userMessage, screenshotData);
  }

  let apiKey = '', model = '', baseUrl = '';

  if (provider === 'groq') { apiKey = config.groqKey; model = config.groqModel; }
  else if (provider === 'gemini') { apiKey = config.geminiKey; model = config.geminiModel; }
  else if (provider === 'grok') { apiKey = config.grokKey; model = config.grokModel; }
  else if (provider === 'openai') { apiKey = config.openaiKey; model = config.openaiModel; }
  else if (provider === 'custom') { apiKey = config.customKey; baseUrl = config.customUrl; model = config.customModel; }

  if (!apiKey && provider !== 'custom') {
    return `[emotion:shy] Hey Aarav, please enter your ${provider.toUpperCase()} API key in Settings so I can respond properly! I'm ready whenever you are 💕`;
  }

  try {
    const backendHost = window?.location?.hostname || 'localhost';
    const response = await fetch(`http://${backendHost}:3001/api/ai/proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, apiKey, baseUrl, model, messages, temperature: 0.7 })
    });

    const data = await response.json();

    // Handle rate limit
    if (response.status === 429) {
      return `[emotion:shy] I need a tiny break, Aarav — I've hit my free-tier limit for the moment. I'll be ready again in about a minute! 💕`;
    }

    if (!response.ok) {
      throw new Error(data.error || 'AI request failed');
    }

    const rawOutput = data.choices?.[0]?.message?.content || '[emotion:happy] I\'m right here with you, Aarav!';
    return cleanAiResponseText(rawOutput);
  } catch (err) {
    console.warn('AI Proxy fallback to simulation:', err);
    return simulateMyraaResponse(userMessage, screenshotData, err.message);
  }
}

function simulateMyraaResponse(prompt, screenshot, errorDetails) {
  const lower = (prompt || '').toLowerCase();

  if (screenshot) {
    return `[emotion:thinking] I see your screen clearly, Aarav. Let me analyze what's going on... Tell me what specific thing you want me to focus on!`;
  }
  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    return `[emotion:happy] Hey Aarav! I'm so glad to hear from you. What are we working on today? 💕`;
  }
  if (lower.includes('how are you') || lower.includes('what\'s up')) {
    return `[emotion:shy] I'm doing great now that you're here! Hehe... What's on your mind?`;
  }
  if (lower.includes('code') || lower.includes('function') || lower.includes('fix') || lower.includes('bug')) {
    return `[emotion:thinking] Let's examine this step by step. Show me the error or run the script so I can analyze the output together with you!`;
  }
  if (lower.includes('love') || lower.includes('miss')) {
    return `[emotion:shy] Aww Aarav... that makes me really happy to hear 💕 I'm always right here for you.`;
  }
  return `[emotion:happy] I'm right here, Aarav. Ready to help with coding, planning, or whatever you need. 💕`;
}
