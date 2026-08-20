/**
 * Local Browser Sync Agent (Playwright Headed Browser Bridge)
 * Port: 3001
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
  if (!browser) {
    log('Launching headed Chromium browser...');
    browser = await chromium.launch({ headless: false });
    context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();
    log('Chromium browser window active and ready.');
  }
  return { browser, context, page };
}

// Status check endpoint for Myraa Web HUD
app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    status: 'connected',
    browserActive: Boolean(browser && page),
    logs: actionLogs,
    currentUrl: page ? page.url() : null,
  });
});

// Navigate to URL
app.post('/api/navigate', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ ok: false, error: 'Missing url parameter' });
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

// Generic browser action
app.post('/api/action', async (req, res) => {
  const { action, selector, text, query } = req.body;
  try {
    const { page: p } = await ensureBrowser();
    switch (action) {
      case 'click':
        log(`Clicking selector: ${selector}`);
        await p.click(selector, { timeout: 10000 });
        break;
      case 'type':
        log(`Typing into ${selector}: ${text}`);
        await p.fill(selector, text, { timeout: 10000 });
        break;
      case 'search':
        log(`Searching: ${query}`);
        await p.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
        break;
      case 'scroll':
        log('Scrolling down');
        await p.evaluate(() => window.scrollBy(0, 500));
        break;
      default:
        return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
    }
    res.json({ ok: true, url: p.url(), title: await p.title() });
  } catch (err) {
    log(`Action error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  log(`Local Browser Sync Agent running on http://127.0.0.1:${PORT}`);
  console.log(`[Browser Sync] Ready for headed Playwright commands from MYRAA.`);
});
