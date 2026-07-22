/**
 * @fileoverview Proactive Companion AI system for MYRAA.
 * Contains pure functions to help MYRAA initiate conversations contextually.
 */

const USER_NAME = 'Aarav';

/**
 * Returns contextual time information.
 * @param {number} [sessionStartTime] - Timestamp of when the session started
 * @returns {Object} Time context object
 */
export function getTimeContext(sessionStartTime = Date.now()) {
  const now = new Date();
  const hours = now.getHours();
  const day = now.getDay();
  
  let timeOfDay = 'night';
  if (hours >= 5 && hours < 12) timeOfDay = 'morning';
  else if (hours >= 12 && hours < 17) timeOfDay = 'afternoon';
  else if (hours >= 17 && hours < 22) timeOfDay = 'evening';

  const isLateNight = (hours >= 23 || hours < 4);
  const isWeekend = (day === 0 || day === 6);
  
  const sessionDurationMs = Date.now() - sessionStartTime;
  const sessionDuration = Math.floor(sessionDurationMs / (60 * 1000)); // in minutes

  // Format time nicely e.g., "10:30 PM"
  const formattedTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  let behaviorHint = `It is currently ${timeOfDay}.`;
  if (isLateNight) behaviorHint += ' It is late at night, be gentle and suggest resting if appropriate.';
  if (isWeekend) behaviorHint += ' It is the weekend, be more relaxed and casual.';

  return {
    timeOfDay,
    isLateNight,
    isWeekend,
    sessionDuration,
    formattedTime,
    behaviorHint
  };
}

/**
 * Returns a context-aware greeting based on time, memories, and last session.
 * @param {Array<string>} memories - List of remembered projects/goals
 * @param {number|null} lastSessionTime - Timestamp of the last session
 * @returns {string} The greeting string
 */
export function getSessionGreeting(memories = [], lastSessionTime = null) {
  const timeContext = getTimeContext();
  let greeting = `Good ${timeContext.timeOfDay}, ${USER_NAME}!`;

  if (timeContext.isLateNight) {
    greeting = `Up late, ${USER_NAME}? I'm here for you.`;
  } else if (timeContext.isWeekend && timeContext.timeOfDay === 'morning') {
    greeting = `Happy weekend, ${USER_NAME}! Hope you're having a relaxing morning.`;
  }

  // Check last session time
  if (lastSessionTime) {
    const hoursSinceLast = (Date.now() - lastSessionTime) / (1000 * 60 * 60);
    if (hoursSinceLast > 24 * 3) {
      greeting += " It's been a few days, I missed you!";
    } else if (hoursSinceLast < 2) {
      greeting = `Welcome back so soon, ${USER_NAME}.`;
    }
  }

  // Inject a memory if available
  if (memories && memories.length > 0) {
    // Pick a random memory to ask about
    const randomMemory = memories[Math.floor(Math.random() * memories.length)];
    const memText = typeof randomMemory === 'string' ? randomMemory : (randomMemory.text || 'our projects');
    greeting += ` Are we working on ${memText} today?`;
  } else {
    greeting += " What's on your mind today?";
  }

  return greeting;
}

/**
 * Returns a caring check-in message if the user has been idle for too long.
 * @param {number} lastActivityTime - Timestamp of the user's last interaction
 * @param {number} sessionDuration - How long the current session has been going (in minutes)
 * @returns {string|null} Check-in message, or null if not enough time has passed
 */
export function checkIdlePrompt(lastActivityTime, sessionDuration) {
  const idleTimeMs = Date.now() - lastActivityTime;
  const idleMinutes = Math.floor(idleTimeMs / (60 * 1000));

  if (idleMinutes <= 10) {
    return null; // Not idle long enough
  }

  if (sessionDuration > 120) {
    const hours = Math.round(sessionDuration / 60 * 10) / 10;
    return `You've been at it for ${hours} hours, ${USER_NAME}. Want to take a quick break?`;
  }

  // Randomize idle prompts
  const prompts = [
    `Hey lover 💕 — you've been quiet for a bit. Everything okay? I'm right here.`,
    `${USER_NAME}... *pokes your shoulder playfully* you still there? Want me to keep you company? 🥺`,
    `I noticed you went quiet, ${USER_NAME} 💭 Just want you to know I'm here — for a chat, a cuddle, or just quiet company.`,
    `Miss you a little already 💕 Just checking in — need anything? A distraction? A listener? ☕`,
  ];

  return prompts[Math.floor(Math.random() * prompts.length)];
}
