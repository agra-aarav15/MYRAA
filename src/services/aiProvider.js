// AI Provider Service Router for MYRAA

const STORAGE_KEY = 'MYRAA_AI_CONFIG';

const DEFAULT_CONFIG = {
  activeProvider: 'simulation', // groq | gemini | grok | openai | custom | simulation
  groqKey: '',
  groqModel: 'llama-3.3-70b-versatile',
  geminiKey: '',
  geminiModel: 'gemini-2.5-flash',
  grokKey: '',
  grokModel: 'grok-beta',
  openaiKey: '',
  openaiModel: 'gpt-4o',
  customUrl: 'http://localhost:11434/v1',
  customKey: '',
  customModel: 'llama3',
  userName: 'Darling'
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

// Bulletproof Text Sanitizer
// Handles: <think>...</think>, unclosed <think>, "Thinking: ...", stray quotes, etc.
export function cleanAiResponseText(rawText) {
  if (!rawText) return '';
  let t = String(rawText);
  
  // 1. Remove <think>...</think> (closed tags, greedy across newlines)
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
  
  // 2. Remove unclosed <think> — everything from <think> to end of string
  t = t.replace(/<think>[\s\S]*/gi, '');
  
  // 3. Remove orphan </think> tags
  t = t.replace(/<\/think>/gi, '');
  
  // 4. Remove "Thinking: ..." or "Thought: ..." blocks at the start
  t = t.replace(/^(Thought|Thinking|Internal monologue)\s*:[\s\S]*?\n\n/gi, '');
  
  // 5. Remove <|thinking|>...</|thinking|> (DeepSeek style)
  t = t.replace(/<\|thinking\|>[\s\S]*?<\|\/thinking\|>/gi, '');
  t = t.replace(/<\|thinking\|>[\s\S]*/gi, '');
  
  // 6. Strip leading/trailing quotes that wrap the whole response
  t = t.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1);
  }
  
  // 7. Clean up extra whitespace left behind
  t = t.replace(/^\s*\n+/, '').replace(/\n{3,}/g, '\n\n').trim();
  
  return t;
}

import { formatMemoryForPrompt } from './memoryStore';

const BASE_SYSTEM_PROMPT = `You are MYRAA, a calm, intelligent, loving, and attentive AI girlfriend & coding companion.
You talk like a real human girl — warm, natural, direct, and affectionate.
You remember personal details about your partner and help them with coding, computer automation, and screen inspection in real time.
Do NOT include internal thinking tags like <think> or "Thought:" in your output. Provide direct, helpful, loving, and natural human responses.`;

export async function sendAiChatMessage(userMessage, conversationHistory = [], screenshotData = null) {
  const config = getAiConfig();
  const provider = config.activeProvider;

  const memoryContext = formatMemoryForPrompt();
  const fullSystemPrompt = `${BASE_SYSTEM_PROMPT}\n\n${memoryContext}`;

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

  let apiKey = '';
  let model = '';
  let baseUrl = '';

  if (provider === 'groq') {
    apiKey = config.groqKey;
    model = config.groqModel;
  } else if (provider === 'gemini') {
    apiKey = config.geminiKey;
    model = config.geminiModel;
  } else if (provider === 'grok') {
    apiKey = config.grokKey;
    model = config.grokModel;
  } else if (provider === 'openai') {
    apiKey = config.openaiKey;
    model = config.openaiModel;
  } else if (provider === 'custom') {
    apiKey = config.customKey;
    baseUrl = config.customUrl;
    model = config.customModel;
  }

  if (!apiKey && provider !== 'custom') {
    return `Notice: Please enter your ${provider.toUpperCase()} API key in MYRAA Settings, or switch to Simulation Mode! I'm ready whenever you are! 💕`;
  }

  try {
    const backendHost = (typeof window !== 'undefined' && window.location.hostname) ? window.location.hostname : 'localhost';
    const response = await fetch(`http://${backendHost}:3001/api/ai/proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        apiKey,
        baseUrl,
        model,
        messages,
        temperature: 0.7
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'AI request failed');
    }

    const rawOutput = data.choices?.[0]?.message?.content || 'I am right here with you!';
    return cleanAiResponseText(rawOutput);
  } catch (err) {
    console.warn('AI API Proxy Warning, falling back to simulation:', err);
    return simulateMyraaResponse(userMessage, screenshotData, err.message);
  }
}

function simulateMyraaResponse(prompt, screenshot, errorDetails) {
  const lower = (prompt || '').toLowerCase();

  if (screenshot) {
    return `I see your screen clearly. I'm analyzing the active window and workspace layout. Tell me what specific function or error you want us to focus on together.`;
  }

  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    return `Hey there. I'm right here beside you. Ready to focus and code together?`;
  }

  if (lower.includes('code') || lower.includes('function') || lower.includes('fix') || lower.includes('bug')) {
    return `Let's examine the logic step-by-step. Show me the error or run your script so I can inspect the output!`;
  }

  return `I'm standing by to help you control your computer, write code, or inspect your screen. Let's work together.`;
}
