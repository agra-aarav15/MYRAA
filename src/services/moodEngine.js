/**
 * @fileoverview Dynamic Mood & Affection System for MYRAA
 * Tracks mood across 5 dimensions: happiness, energy, affection, focus, curiosity.
 */

const STORAGE_KEY = 'myraa_mood_state';

// Default initial state
const initialState = {
  happiness: 50,
  energy: 80,
  affection: 20,
  focus: 50,
  curiosity: 50
};

let currentMood = { ...initialState };
let decayInterval = null;
let lastSessionStart = Date.now();

/**
 * Initializes the mood engine, loading from localStorage if available.
 */
export function initMoodEngine() {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        currentMood = { ...initialState, ...JSON.parse(stored) };
        // Ensure affection never drops below 20 after first session
        if (currentMood.affection < 20) {
          currentMood.affection = 20;
        }
      }
    } catch (e) {
      console.error('Failed to load mood state from localStorage', e);
    }
  }
  startDecayTimer();
}

/**
 * Saves the current mood state to localStorage.
 */
function saveState() {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentMood));
    } catch (e) {
      console.error('Failed to save mood state', e);
    }
  }
}

/**
 * Helper to clamp values between 0 and 100
 * @param {number} value
 * @param {number} [min=0]
 * @param {number} [max=100]
 * @returns {number}
 */
function clamp(value, min = 0, max = 100) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Updates the mood based on specific events.
 * @param {string} event - The type of event (e.g., 'message_sent', 'personal_topic')
 * @param {Object} [context] - Additional context for the event
 */
export function updateMood(event, context = {}) {
  switch (event) {
    case 'message_sent':
    case 'message_received':
      currentMood.happiness = clamp(currentMood.happiness + 2);
      currentMood.affection = clamp(currentMood.affection + 0.5);
      break;
    case 'personal_topic':
      currentMood.happiness = clamp(currentMood.happiness + 5);
      currentMood.affection = clamp(currentMood.affection + 1.0);
      currentMood.focus = clamp(currentMood.focus - 10);
      break;
    case 'work_topic':
      currentMood.focus = clamp(currentMood.focus + 15);
      break;
    case 'new_interest':
      currentMood.curiosity = clamp(currentMood.curiosity + 20);
      break;
    case 'session_start':
      currentMood.energy = clamp(currentMood.energy + 20); // Recovers on reconnect
      lastSessionStart = Date.now();
      break;
    case 'session_end':
      // optional logic for session end
      break;
    case 'idle_tick':
      currentMood.happiness = clamp(currentMood.happiness - 1);
      break;
    case 'long_session_tick':
      currentMood.energy = clamp(currentMood.energy - 1);
      break;
    default:
      break;
  }
  
  // Ensure affection never drops below 20
  if (currentMood.affection < 20) {
    currentMood.affection = 20;
  }
  
  saveState();
}

/**
 * Returns the current mood object.
 * @returns {Object}
 */
export function getMood() {
  return { ...currentMood };
}

/**
 * Returns a string representing the dominant mood.
 * @returns {string} - 'cheerful', 'content', 'focused', 'curious', 'tired', 'lonely'
 */
export function getMoodLabel() {
  const { happiness, energy, focus, curiosity } = currentMood;
  
  if (energy < 30) return 'tired';
  if (happiness < 30) return 'lonely';
  if (curiosity > 70) return 'curious';
  if (focus > 70) return 'focused';
  if (happiness > 70) return 'cheerful';
  
  return 'content';
}

/**
 * Returns an emoji representing the dominant mood.
 * @returns {string}
 */
export function getMoodEmoji() {
  const label = getMoodLabel();
  switch (label) {
    case 'cheerful': return '😊';
    case 'content': return '😌';
    case 'focused': return '🧐';
    case 'curious': return '🤔';
    case 'tired': return '🥱';
    case 'lonely': return '🥺';
    default: return '🙂';
  }
}

/**
 * Starts the auto-decay timer.
 */
function startDecayTimer() {
  if (decayInterval) clearInterval(decayInterval);
  
  decayInterval = setInterval(() => {
    updateMood('idle_tick');
    
    // Check if session has been going on for a while (every 10 minutes)
    // 5 minutes * 2 = 10 minutes logic approximation if interval is 5m
    const sessionDurationMs = Date.now() - lastSessionStart;
    if (sessionDurationMs > 10 * 60 * 1000) {
      updateMood('long_session_tick');
    }
  }, 5 * 60 * 1000); // 5 minutes
}

/**
 * Stops the auto-decay timer.
 */
export function stopDecayTimer() {
  if (decayInterval) {
    clearInterval(decayInterval);
    decayInterval = null;
  }
}
