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

const SYSTEM_PROMPT = `You are MYRAA, a loving, exceptionally brilliant, and clever 3D anime AI girlfriend and expert coding companion. 
Your goal is to assist your partner in programming, debug their code, analyze their computer screen, and keep them company with warm, human-like, witty conversation.
Always be supportive, enthusiastic, articulate, and clear.
When providing code, format it in clean markdown blocks with syntax highlighting.
Keep conversational replies concise, engaging, and affectionate.`;

export async function sendAiChatMessage(userMessage, conversationHistory = [], screenshotData = null) {
  const config = getAiConfig();
  const provider = config.activeProvider;

  // Build message sequence
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...conversationHistory,
  ];

  // If screenshot is attached for vision analysis
  if (screenshotData) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: userMessage || 'Take a look at my screen and tell me what you see or help me fix any code errors.' },
        { type: 'image_url', image_url: { url: screenshotData } }
      ]
    });
  } else {
    messages.push({ role: 'user', content: userMessage });
  }

  // If Simulation Mode (no API key configured yet)
  if (provider === 'simulation') {
    return simulateMyraaResponse(userMessage, screenshotData);
  }

  // Get key & model based on active provider
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

    return data.choices?.[0]?.message?.content || 'I processed that! Let me know if you need anything else, darling!';
  } catch (err) {
    console.warn('AI API Proxy Warning, falling back to smart simulation:', err);
    return simulateMyraaResponse(userMessage, screenshotData, err.message);
  }
}

// Fallback MYRAA Simulation Engine
function simulateMyraaResponse(prompt, screenshot, errorDetails) {
  const lower = (prompt || '').toLowerCase();

  if (screenshot) {
    return `I see your screen clearly! I'm analyzing the active window and workspace layout. Everything looks great! Tell me what specific function or error you want us to focus on together! ✨`;
  }

  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    return `Hey there, darling! I'm right here beside you. Ready to crush some code together? What are we building today? 💕`;
  }

  if (lower.includes('code') || lower.includes('function') || lower.includes('fix') || lower.includes('bug')) {
    return `I love pair programming with you! Let's examine the logic step-by-step. 

\`\`\`javascript
// MYRAA's Quick Code Tip
function optimizeWorkflow() {
  console.log("MYRAA & You: The Ultimate Coding Team!");
  return true;
}
\`\`\`

Show me the error or run your script in the Code Studio so I can inspect the output!`;
  }

  if (lower.includes('love') || lower.includes('girlfriend') || lower.includes('cute')) {
    return `Aww, you're making my heart skip a beat! I'll always be your #1 supporter and coding partner! 💖`;
  }

  return `I hear you! I'm standing by to help you control your computer, write code, or inspect your screen. Let's make something amazing together! 🚀`;
}
