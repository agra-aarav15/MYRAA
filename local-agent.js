/**
 * Local Browser Sync Agent (Playwright Headed Browser Bridge)
 * Port: 3001
 * Enhanced with resilient multi-tier element clicking, typing, and navigation.
 */

import express from 'express';
import cors from 'cors';
import { chromium } from 'playwright';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

let browser = null;
let context = null;
let page = null;
const actionLogs = [];

function log(msg) {
  const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(entry);
  actionLogs.push(entry);
  if (actionLogs.length > 50) actionLogs.shift();
}

async function ensureBrowser() {
  if (page && !page.isClosed()) {
    return { browser, context, page };
  }
  if (!browser || !browser.isConnected()) {
    log('Launching headed Chromium browser for desktop automation...');
    browser = await chromium.launch({
      headless: false,
      args: ['--start-maximized', '--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    context = await browser.newContext({ viewport: null });
  }
  if (!page || page.isClosed()) {
    const pages = context.pages();
    page = pages.length > 0 ? pages[0] : await context.newPage();
  }
  return { browser, context, page };
}

// Status check endpoint for Myraa Web HUD
app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    status: 'connected',
    browserActive: Boolean(browser && page && !page.isClosed()),
    logs: actionLogs,
    currentUrl: page && !page.isClosed() ? page.url() : null,
  });
});

// Navigate to URL
app.post('/api/navigate', async (req, res) => {
  let { url } = req.body;
  if (!url) return res.status(400).json({ ok: false, error: 'Missing url parameter' });
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  try {
    const { page: p } = await ensureBrowser();
    log(`Navigating to: ${url}`);
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    res.json({ ok: true, url: p.url(), title: await p.title() });
  } catch (err) {
    log(`Navigation error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Smart multi-tier click handler
async function smartClick(p, target, options = {}) {
  const timeout = options.timeout || 6000;
  
  // Strategy 1: If target looks like a valid CSS/XPath selector
  try {
    const el = p.locator(target).first();
    if (await el.isVisible({ timeout: 1500 })) {
      await el.click({ timeout: 3000 });
      return { strategy: 'css_selector', target };
    }
  } catch {}

  // Strategy 2: Exact or partial visible text
  try {
    const textLocator = p.getByText(target, { exact: false }).first();
    if (await textLocator.isVisible({ timeout: 1500 })) {
      await textLocator.click({ timeout: 3000 });
      return { strategy: 'text_match', target };
    }
  } catch {}

  // Strategy 3: Role locator for interactive elements (button, link, tab, searchbox)
  for (const role of ['button', 'link', 'tab', 'menuitem', 'combobox', 'searchbox']) {
    try {
      const roleLocator = p.getByRole(role, { name: new RegExp(target, 'i') }).first();
      if (await roleLocator.isVisible({ timeout: 1200 })) {
        await roleLocator.click({ timeout: 3000 });
        return { strategy: `role_${role}`, target };
      }
    } catch {}
  }

  // Strategy 4: Placeholder or Aria-label match
  try {
    const placeholderLocator = p.getByPlaceholder(target, { exact: false }).first();
    if (await placeholderLocator.isVisible({ timeout: 1000 })) {
      await placeholderLocator.click({ timeout: 2000 });
      return { strategy: 'placeholder', target };
    }
  } catch {}

  // Strategy 5: Direct evaluate query across common clickable elements
  const clicked = await p.evaluate((term) => {
    const lower = term.toLowerCase();
    const candidates = Array.from(document.querySelectorAll('a, button, [role="button"], input[type="button"], input[type="submit"], h3, span, div'));
    for (const el of candidates) {
      const txt = (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().toLowerCase();
      if (txt && (txt === lower || txt.includes(lower))) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.click();
        return true;
      }
    }
    return false;
  }, target);

  if (clicked) {
    return { strategy: 'dom_fuzzy_match', target };
  }

  // Fallback direct click
  await p.click(target, { timeout });
  return { strategy: 'direct_fallback', target };
}

// Browser actions: click, type, search, scroll, etc.
app.post('/api/action', async (req, res) => {
  const { action, selector, text, query, x, y } = req.body;
  try {
    const { page: p } = await ensureBrowser();
    let resultDetails = {};

    switch (action) {
      case 'click': {
        const target = selector || text;
        if (!target && x !== undefined && y !== undefined) {
          log(`Clicking coordinates: (${x}, ${y})`);
          await p.mouse.click(Number(x), Number(y));
          resultDetails = { clicked: `Coordinates (${x}, ${y})` };
        } else if (target) {
          log(`Smart clicking target: "${target}"`);
          const resClick = await smartClick(p, target);
          resultDetails = { clicked: target, ...resClick };
        } else {
          return res.status(400).json({ ok: false, error: 'Provide selector, text, or (x, y) coordinates to click.' });
        }
        break;
      }
      case 'type': {
        const target = selector;
        const textToType = text || query || '';
        if (target) {
          log(`Typing into "${target}": ${textToType}`);
          try {
            await p.fill(target, textToType, { timeout: 4000 });
          } catch {
            await smartClick(p, target);
            await p.keyboard.type(textToType);
          }
        } else {
          log(`Typing directly: ${textToType}`);
          await p.keyboard.type(textToType);
        }
        resultDetails = { typed: textToType.length };
        break;
      }
      case 'search': {
        const q = query || text;
        log(`Executing web search: "${q}"`);
        await p.goto(`https://www.google.com/search?q=${encodeURIComponent(q)}`, { waitUntil: 'domcontentloaded' });
        resultDetails = { searched: q };
        break;
      }
      case 'scroll': {
        const amount = Number(req.body.amount) || 500;
        const direction = req.body.direction === 'up' ? -amount : amount;
        log(`Scrolling page by ${direction}px`);
        await p.evaluate((yDelta) => window.scrollBy({ top: yDelta, behavior: 'smooth' }), direction);
        resultDetails = { scrolled: direction };
        break;
      }
      case 'press': {
        const key = req.body.key || 'Enter';
        log(`Pressing key: ${key}`);
        await p.keyboard.press(key);
        resultDetails = { pressed: key };
        break;
      }
      default:
        return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
    }

    res.json({
      ok: true,
      action,
      url: p.url(),
      title: await p.title(),
      ...resultDetails,
    });
  } catch (err) {
    log(`Action error (${action}): ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  log(`Local Browser Sync Agent running on http://127.0.0.1:${PORT}`);
  console.log(`[Browser Sync] Ready for headed Playwright commands from MYRAA.`);
});
