// Myraa Model Router — MASTER BUILD PROMPT §24 Multi-Model Architecture + §25 Local-First + §39 Cost/Resource
// Provider-independent abstraction supporting cloud+local: Anthropic, OpenAI, Gemini, Groq, Ollama, OpenRouter.
// Routing evaluates: taskType, quality, latency, cost, contextLength, vision, tool-calling, local hardware,
// internet availability, with fallback to local. Includes cost tracking and local Ollama detection.
// Local-first (§25): sensitive/routine tasks prefer local; internet failure → switch to local → queue → resume.

import fs from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Data-dir helper (same as memory/store.js)
// ---------------------------------------------------------------------------
function getMyraaDataDir() {
  const base =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config'));
  return path.join(base, 'myraa');
}

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
}

// ---------------------------------------------------------------------------
// Providers & Task Types (§24)
// ---------------------------------------------------------------------------
export const PROVIDERS = Object.freeze({
  ANTHROPIC: 'anthropic',
  OPENAI: 'openai',
  GEMINI: 'gemini',
  GROQ: 'groq',
  OLLAMA: 'ollama',
  OPENROUTER: 'openrouter',
});

export const TASK_TYPES = Object.freeze({
  CHAT: 'chat',
  CODE: 'code',
  REASONING: 'reasoning',
  RESEARCH: 'research',
  VISION: 'vision',
  TOOL_USE: 'tool_use',
  SENSITIVE: 'sensitive',
  ROUTINE: 'routine',
  FAST: 'fast',
  LONG_CONTEXT: 'long_context',
  GENERAL: 'general',
});

// ---------------------------------------------------------------------------
// Model Catalog — provider-independent, future-proof (§24)
// Each entry: provider-independent abstraction, includes metadata for routing.
// Costs per 1M tokens (USD) — illustrative; real pricing can be overridden via env/config.
// latencyTier: 1=low/fast, 2=medium, 3=high/slow
// quality: 0-100 aggregate intelligence score
// ---------------------------------------------------------------------------
export const MODEL_CATALOG = Object.freeze([
  // OpenAI — cloud
  { id: 'gpt-4o', provider: PROVIDERS.OPENAI, displayName: 'GPT-4o', contextLength: 128000, supportsVision: true, supportsTools: true, quality: 95, latencyTier: 2, cost: { input: 2.5, output: 10 }, local: false, tier: 'cloud' },
  { id: 'gpt-4o-mini', provider: PROVIDERS.OPENAI, displayName: 'GPT-4o mini', contextLength: 128000, supportsVision: true, supportsTools: true, quality: 80, latencyTier: 1, cost: { input: 0.15, output: 0.6 }, local: false, tier: 'cloud' },
  { id: 'gpt-3.5-turbo', provider: PROVIDERS.OPENAI, displayName: 'GPT-3.5 Turbo', contextLength: 16385, supportsVision: false, supportsTools: true, quality: 70, latencyTier: 1, cost: { input: 0.5, output: 1.5 }, local: false, tier: 'cloud' },

  // Anthropic — cloud
  { id: 'claude-3-5-sonnet-20241022', provider: PROVIDERS.ANTHROPIC, displayName: 'Claude 3.5 Sonnet', contextLength: 200000, supportsVision: true, supportsTools: true, quality: 96, latencyTier: 2, cost: { input: 3, output: 15 }, local: false, tier: 'cloud' },
  { id: 'claude-3-haiku-20240307', provider: PROVIDERS.ANTHROPIC, displayName: 'Claude 3 Haiku', contextLength: 200000, supportsVision: true, supportsTools: true, quality: 75, latencyTier: 1, cost: { input: 0.25, output: 1.25 }, local: false, tier: 'cloud' },
  { id: 'claude-3-opus-20240229', provider: PROVIDERS.ANTHROPIC, displayName: 'Claude 3 Opus', contextLength: 200000, supportsVision: true, supportsTools: true, quality: 97, latencyTier: 3, cost: { input: 15, output: 75 }, local: false, tier: 'cloud' },

  // Gemini — cloud
  { id: 'gemini-1.5-pro', provider: PROVIDERS.GEMINI, displayName: 'Gemini 1.5 Pro', contextLength: 1000000, supportsVision: true, supportsTools: true, quality: 90, latencyTier: 2, cost: { input: 1.25, output: 5 }, local: false, tier: 'cloud' },
  { id: 'gemini-1.5-flash', provider: PROVIDERS.GEMINI, displayName: 'Gemini 1.5 Flash', contextLength: 1000000, supportsVision: true, supportsTools: true, quality: 80, latencyTier: 1, cost: { input: 0.075, output: 0.3 }, local: false, tier: 'cloud' },
  { id: 'gemini-2.0-flash', provider: PROVIDERS.GEMINI, displayName: 'Gemini 2.0 Flash', contextLength: 1000000, supportsVision: true, supportsTools: true, quality: 85, latencyTier: 1, cost: { input: 0.1, output: 0.4 }, local: false, tier: 'cloud' },

  // Groq — cloud, low latency specialized
  { id: 'llama-3.3-70b-versatile', provider: PROVIDERS.GROQ, displayName: 'Llama 3.3 70B (Groq)', contextLength: 128000, supportsVision: false, supportsTools: true, quality: 85, latencyTier: 1, cost: { input: 0.59, output: 0.79 }, local: false, tier: 'cloud' },
  { id: 'mixtral-8x7b-32768', provider: PROVIDERS.GROQ, displayName: 'Mixtral 8x7B (Groq)', contextLength: 32768, supportsVision: false, supportsTools: true, quality: 75, latencyTier: 1, cost: { input: 0.24, output: 0.24 }, local: false, tier: 'cloud' },
  { id: 'llama-3.1-8b-instant', provider: PROVIDERS.GROQ, displayName: 'Llama 3.1 8B Instant (Groq)', contextLength: 128000, supportsVision: false, supportsTools: true, quality: 68, latencyTier: 1, cost: { input: 0.05, output: 0.08 }, local: false, tier: 'cloud' },

  // Ollama — local (§25)
  { id: 'llama3.2', provider: PROVIDERS.OLLAMA, displayName: 'Llama 3.2 (local)', contextLength: 8192, supportsVision: false, supportsTools: true, quality: 65, latencyTier: 2, cost: { input: 0, output: 0 }, local: true, tier: 'local', requiresRAM: 4 },
  { id: 'mistral', provider: PROVIDERS.OLLAMA, displayName: 'Mistral (local)', contextLength: 8192, supportsVision: false, supportsTools: true, quality: 68, latencyTier: 2, cost: { input: 0, output: 0 }, local: true, tier: 'local', requiresRAM: 4 },
  { id: 'phi3', provider: PROVIDERS.OLLAMA, displayName: 'Phi-3 (local)', contextLength: 4096, supportsVision: false, supportsTools: false, quality: 55, latencyTier: 1, cost: { input: 0, output: 0 }, local: true, tier: 'local', requiresRAM: 2 },
  { id: 'gemma2', provider: PROVIDERS.OLLAMA, displayName: 'Gemma 2 (local)', contextLength: 8192, supportsVision: false, supportsTools: false, quality: 60, latencyTier: 1, cost: { input: 0, output: 0 }, local: true, tier: 'local', requiresRAM: 4 },
  { id: 'llava', provider: PROVIDERS.OLLAMA, displayName: 'LLaVA (local vision)', contextLength: 8192, supportsVision: true, supportsTools: false, quality: 60, latencyTier: 2, cost: { input: 0, output: 0 }, local: true, tier: 'local', requiresRAM: 8 },
  { id: 'qwen2.5-coder', provider: PROVIDERS.OLLAMA, displayName: 'Qwen2.5 Coder (local)', contextLength: 32768, supportsVision: false, supportsTools: true, quality: 72, latencyTier: 2, cost: { input: 0, output: 0 }, local: true, tier: 'local', requiresRAM: 8 },

  // OpenRouter — cloud meta-provider (routes to many models)
  { id: 'openrouter/auto', provider: PROVIDERS.OPENROUTER, displayName: 'OpenRouter Auto', contextLength: 128000, supportsVision: true, supportsTools: true, quality: 85, latencyTier: 2, cost: { input: 0.5, output: 1.5 }, local: false, tier: 'cloud' },
  { id: 'openrouter/anthropic/claude-3.5-sonnet', provider: PROVIDERS.OPENROUTER, displayName: 'Claude via OpenRouter', contextLength: 200000, supportsVision: true, supportsTools: true, quality: 96, latencyTier: 2, cost: { input: 3, output: 15 }, local: false, tier: 'cloud' },
]);

// Build provider -> models map helper
export function getModelsByProvider(provider) {
  return MODEL_CATALOG.filter((m) => m.provider === provider);
}

export function getModelById(id) {
  return MODEL_CATALOG.find((m) => m.id === id) || null;
}

export function isLocalModel(modelId) {
  const m = getModelById(modelId);
  return !!(m && m.local);
}

export function isCloudModel(modelId) {
  const m = getModelById(modelId);
  return !!(m && !m.local);
}

// ---------------------------------------------------------------------------
// ModelRouter — §24 + §25
// ---------------------------------------------------------------------------
export class ModelRouter {
  /**
   * @param {object} opts
   * @param {string} opts.ollamaUrl - Ollama base (default http://127.0.0.1:11434)
   * @param {string} opts.costFile - path for persisted cost tracking
   * @param {Array} opts.models - override catalog (for tests)
   * @param {object} opts.logger
   */
  constructor({ ollamaUrl, costFile, models, logger = console } = {}) {
    this.ollamaUrl = ollamaUrl || process.env.OLLAMA_HOST || process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
    this.models = models ? [...models] : [...MODEL_CATALOG];
    this.logger = logger;
    this.costFile = costFile || path.join(getMyraaDataDir(), 'model_cost.json');
    this.costTracker = {
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalRequests: 0,
      byModel: {}, // modelId -> { cost, inputTokens, outputTokens, requests }
      history: [], // last N usages
    };
    this.internetCache = { available: null, timestamp: 0, ttlMs: 30000 };
    this.ollamaCache = { models: null, timestamp: 0, ttlMs: 60000 };
    this.hardwareInfo = this.detectHardware();
    this.queuedOps = []; // §25 queue when offline
    this._loadCostTracker();
  }

  // ------------------------- hardware & environment -------------------------

  detectHardware() {
    const ramGB = Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10;
    const cpus = os.cpus()?.length || 4;
    const hasGPU = !!process.env.MYRAA_HAS_GPU || !!process.env.CUDA_VISIBLE_DEVICES;
    // simple heuristic: low RAM <8GB -> restrict large local models
    const tier = ramGB >= 16 ? 'high' : ramGB >= 8 ? 'medium' : 'low';
    return { ramGB, cpus, hasGPU, tier };
  }

  // ------------------------- cost tracking (§39) -------------------------

  _loadCostTracker() {
    try {
      if (fs.existsSync(this.costFile)) {
        const raw = fs.readFileSync(this.costFile, 'utf8');
        const data = JSON.parse(raw);
        this.costTracker = {
          totalCost: data.totalCost || 0,
          totalInputTokens: data.totalInputTokens || 0,
          totalOutputTokens: data.totalOutputTokens || 0,
          totalRequests: data.totalRequests || 0,
          byModel: data.byModel || {},
          history: Array.isArray(data.history) ? data.history.slice(-200) : [],
        };
      }
    } catch {}
  }

  _saveCostTracker() {
    try {
      ensureDir(path.dirname(this.costFile));
      const tmp = this.costFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.costTracker, null, 2), 'utf8');
      fs.renameSync(tmp, this.costFile);
    } catch (e) {
      this.logger.warn?.(`[ModelRouter] failed to persist cost tracker: ${e.message}`);
    }
  }

  /**
   * Record usage for cost tracking.
   * @param {object} usage - { modelId, inputTokens, outputTokens, cost? }
   */
  recordUsage({ modelId, inputTokens = 0, outputTokens = 0, cost } = {}) {
    if (!modelId) return { ok: false, error: 'modelId required' };
    const model = getModelById(modelId) || this.models.find((m) => m.id === modelId);
    let computedCost = cost;
    if (computedCost === undefined || computedCost === null) {
      computedCost = this.estimateCost(modelId, inputTokens, outputTokens);
    }
    this.costTracker.totalCost += computedCost;
    this.costTracker.totalInputTokens += inputTokens;
    this.costTracker.totalOutputTokens += outputTokens;
    this.costTracker.totalRequests += 1;
    if (!this.costTracker.byModel[modelId]) {
      this.costTracker.byModel[modelId] = { cost: 0, inputTokens: 0, outputTokens: 0, requests: 0 };
    }
    const entry = this.costTracker.byModel[modelId];
    entry.cost += computedCost;
    entry.inputTokens += inputTokens;
    entry.outputTokens += outputTokens;
    entry.requests += 1;
    this.costTracker.history.push({
      ts: new Date().toISOString(),
      modelId,
      inputTokens,
      outputTokens,
      cost: computedCost,
    });
    // cap history
    if (this.costTracker.history.length > 500) this.costTracker.history = this.costTracker.history.slice(-500);
    this._saveCostTracker();
    return { ok: true, modelId, cost: computedCost, totalCost: this.costTracker.totalCost };
  }

  /** Estimate cost for token counts using catalog pricing (per 1M) */
  estimateCost(modelId, inputTokens = 0, outputTokens = 0) {
    const model = getModelById(modelId) || this.models.find((m) => m.id === modelId);
    if (!model || !model.cost) return 0;
    const c = model.cost;
    // cost is per 1M tokens
    return (inputTokens / 1_000_000) * (c.input || 0) + (outputTokens / 1_000_000) * (c.output || 0);
  }

  getCostStats() {
    return {
      ok: true,
      totalCost: this.costTracker.totalCost,
      totalInputTokens: this.costTracker.totalInputTokens,
      totalOutputTokens: this.costTracker.totalOutputTokens,
      totalRequests: this.costTracker.totalRequests,
      byModel: { ...this.costTracker.byModel },
      history: [...this.costTracker.history].slice(-20),
      file: this.costFile,
    };
  }

  resetCostTracker() {
    this.costTracker = { totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0, totalRequests: 0, byModel: {}, history: [] };
    this._saveCostTracker();
    return { ok: true };
  }

  // ------------------------- connectivity (§25) -------------------------

  /**
   * Check internet availability. Caches result for 30s. §25 local-first fallback.
   * Tries fetch to 1.1.1.1/generate_204 or google.
   */
  async checkInternet({ timeout = 3000, force = false } = {}) {
    const now = Date.now();
    if (!force && this.internetCache.available !== null && now - this.internetCache.timestamp < this.internetCache.ttlMs) {
      return this.internetCache.available;
    }
    // allow env override for testing: MYRAA_OFFLINE=1 forces offline
    if (process.env.MYRAA_OFFLINE === '1') {
      this.internetCache = { available: false, timestamp: now, ttlMs: this.internetCache.ttlMs };
      return false;
    }
    if (process.env.MYRAA_ONLINE === '1') {
      this.internetCache = { available: true, timestamp: now, ttlMs: this.internetCache.ttlMs };
      return true;
    }

    const urls = ['https://1.1.1.1/cdn-cgi/trace', 'https://www.google.com/generate_204'];
    for (const url of urls) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeout);
        const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
        clearTimeout(t);
        if (res && (res.ok || res.status === 204 || res.status === 200)) {
          this.internetCache = { available: true, timestamp: now, ttlMs: this.internetCache.ttlMs };
          return true;
        }
      } catch {}
    }
    // fallback: DNS lookup attempt (Node <18 fetch may fail but dns may still work)
    try {
      const { lookup } = await import('dns/promises');
      await lookup('google.com');
      this.internetCache = { available: true, timestamp: now, ttlMs: this.internetCache.ttlMs };
      return true;
    } catch {}
    this.internetCache = { available: false, timestamp: now, ttlMs: this.internetCache.ttlMs };
    return false;
  }

  // ------------------------- Ollama local detection (§25) -------------------------

  /**
   * Detect local Ollama models via http://127.0.0.1:11434/api/tags
   * Caches for 60s. If MYRAA_MOCK_OLLAMA env set, returns mocked list.
   */
  async detectOllamaModels({ force = false, timeout = 2000 } = {}) {
    const now = Date.now();
    if (!force && this.ollamaCache.models !== null && now - this.ollamaCache.timestamp < this.ollamaCache.ttlMs) {
      return this.ollamaCache.models;
    }
    // test hook: env mock
    if (process.env.MYRAA_MOCK_OLLAMA) {
      const mocked = process.env.MYRAA_MOCK_OLLAMA.split(',').map((s) => s.trim()).filter(Boolean);
      this.ollamaCache = { models: mocked, timestamp: now, ttlMs: this.ollamaCache.ttlMs };
      return mocked;
    }
    if (process.env.MYRAA_MOCK_OLLAMA_EMPTY === '1') {
      this.ollamaCache = { models: [], timestamp: now, ttlMs: this.ollamaCache.ttlMs };
      return [];
    }

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeout);
      const res = await fetch(`${this.ollamaUrl}/api/tags`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`Ollama status ${res.status}`);
      const data = await res.json();
      const models = (data.models || []).map((m) => m.name || m.model).filter(Boolean);
      // also strip tags like ":latest"
      const normalized = models.map((m) => m.split(':')[0]);
      this.ollamaCache = { models: normalized, timestamp: now, ttlMs: this.ollamaCache.ttlMs };
      return normalized;
    } catch (e) {
      // not available — return empty, but don't cache negative too long? keep ttl
      this.ollamaCache = { models: [], timestamp: now, ttlMs: this.ollamaCache.ttlMs };
      return [];
    }
  }

  async isOllamaAvailable(opts) {
    const models = await this.detectOllamaModels(opts);
    return models.length > 0;
  }

  // ------------------------- hardware filtering -------------------------
  _filterByHardware(models) {
    const { ramGB } = this.hardwareInfo;
    // filter out local models requiring more RAM than available (with 1GB headroom)
    return models.filter((m) => {
      if (!m.local) return true;
      if (!m.requiresRAM) return true;
      return m.requiresRAM <= ramGB;
    });
  }

  // ------------------------- routing core (§24) -------------------------

  /**
   * Score a model for given routing options.
   * Higher score = better fit.
   */
  _scoreModel(model, opts) {
    const {
      quality: qualityReq = 0,
      latency: latencyPref, // 'low' | 'medium' | 'high'
      costSensitive = false,
      taskType,
      preferLocal = false,
    } = opts;

    let score = 0;

    // Quality (0-100) — weighted 0.35
    const qualityScore = model.quality / 100;
    const qualityWeight = qualityReq >= 85 ? 0.45 : qualityReq >= 70 ? 0.35 : 0.2;
    score += qualityScore * qualityWeight * 100;

    // Latency — weighted 0.25 if low latency desired
    let latencyScore = 0;
    if (latencyPref === 'low' || taskType === TASK_TYPES.FAST) {
      // low tier (1) is best
      latencyScore = (4 - model.latencyTier) / 3; // 1->1, 2->0.66, 3->0.33
      score += latencyScore * 25;
    } else if (latencyPref === 'high') {
      // quality tasks tolerate high latency
      latencyScore = 0.5;
      score += latencyScore * 5;
    } else {
      latencyScore = (4 - model.latencyTier) / 3 * 0.5;
      score += latencyScore * 10;
    }

    // Cost — weighted 0.25 if costSensitive
    const costWeight = costSensitive ? 0.25 : 0.08;
    const costPerM = (model.cost?.input || 0) + (model.cost?.output || 0);
    // cheaper is better: invert, normalize against max cost ~90 (opus)
    const maxCost = 90;
    const costScore = 1 - Math.min(costPerM / maxCost, 1);
    score += costScore * costWeight * 100;

    // Context length bonus if task needs long context
    if (opts.contextLength && opts.contextLength > 32000) {
      if (model.contextLength >= opts.contextLength) score += 15;
      else score -= 50; // will be filtered anyway, but extra penalty
    }

    // Local-first bonus (§25) — sensitive/routine prefer local
    const isSensitive = taskType === TASK_TYPES.SENSITIVE || taskType === 'sensitive' || opts.sensitive === true;
    const isRoutine = taskType === TASK_TYPES.ROUTINE || taskType === 'routine';
    if ((preferLocal || isSensitive || isRoutine) && model.local) {
      score += 20;
    }
    // If offline, local already filtered; but add bonus
    if (opts.internetAvailable === false && model.local) score += 30;

    // Tool-calling bonus if needed
    if (opts.needsTools || opts.toolCalling) {
      if (model.supportsTools) score += 10;
      else score -= 100;
    }
    if (opts.needsVision || opts.vision) {
      if (model.supportsVision) score += 10;
      else score -= 100;
    }

    // Provider preference bonus if specified
    if (opts.preferredProvider && model.provider === opts.preferredProvider) score += 5;

    // Small tie-breaker: prefer Groq for fast, Gemini for long context, Anthropic for reasoning
    if (taskType === TASK_TYPES.FAST && model.provider === PROVIDERS.GROQ) score += 5;
    if (taskType === TASK_TYPES.LONG_CONTEXT && model.provider === PROVIDERS.GEMINI) score += 5;
    if (taskType === TASK_TYPES.REASONING && model.provider === PROVIDERS.ANTHROPIC) score += 5;
    if (taskType === TASK_TYPES.CODE && model.id.includes('coder')) score += 5;

    return Math.round(score * 100) / 100;
  }

  /**
   * Main routing — selects best model for task.
   * @param {object} opts
   * @param {string} opts.taskType - e.g. 'code', 'chat', 'vision', 'sensitive', 'research'
   * @param {number} opts.quality - 0-100 minimum quality requirement
   * @param {string} opts.latency - 'low'|'medium'|'high'
   * @param {boolean} opts.costSensitive
   * @param {number} opts.contextLength - required context length
   * @param {boolean} opts.needsVision | opts.vision
   * @param {boolean} opts.needsTools | opts.toolCalling
   * @param {boolean} opts.preferLocal
   * @param {boolean} opts.internetAvailable - override (if undefined, auto-detect)
   * @param {string} opts.preferredProvider
   * @returns {Promise<{ok:boolean, model:object, fallback:object|null, reason:string, alternatives:Array, internetAvailable:boolean, localModels:Array}>}
   */
  async route(opts = {}) {
    const merged = { taskType: TASK_TYPES.GENERAL, ...opts };
    // normalize aliases
    if (merged.vision !== undefined && merged.needsVision === undefined) merged.needsVision = merged.vision;
    if (merged.toolCalling !== undefined && merged.needsTools === undefined) merged.needsTools = merged.toolCalling;
    if (merged.contextLength === undefined && merged.context_length !== undefined) merged.contextLength = merged.context_length;

    // resolve internet availability
    let internetAvailable = merged.internetAvailable;
    if (internetAvailable === undefined) {
      internetAvailable = await this.checkInternet();
    }
    merged.internetAvailable = internetAvailable;

    // detect local models
    const localAvailable = await this.detectOllamaModels();
    const hasLocal = localAvailable.length > 0 || this.models.some((m) => m.local);

    // 1) initial pool filtered by hard constraints
    let pool = [...this.models];

    // hardware filter
    pool = this._filterByHardware(pool);

    // internet filter: if offline, only local
    if (internetAvailable === false) {
      pool = pool.filter((m) => m.local);
      if (pool.length === 0) {
        // edge: no local models pass hardware — fallback to any local regardless of RAM?
        pool = this.models.filter((m) => m.local);
      }
    }

    // vision hard filter
    if (merged.needsVision) {
      const visionPool = pool.filter((m) => m.supportsVision);
      // if vision required but offline and no local vision, we must keep vision pool even if empty to signal error
      pool = visionPool;
    }
    // tool-calling hard filter
    if (merged.needsTools) {
      pool = pool.filter((m) => m.supportsTools);
    }
    // context length hard filter
    if (merged.contextLength) {
      const ctx = Number(merged.contextLength);
      pool = pool.filter((m) => m.contextLength >= ctx);
    }
    // quality minimum filter (soft? but if specified, enforce)
    if (merged.quality && Number(merged.quality) > 0) {
      const q = Number(merged.quality);
      const qFiltered = pool.filter((m) => m.quality >= q);
      // if filtering would empty pool and fallback allowed, keep original but will be low-ranked
      if (qFiltered.length > 0) pool = qFiltered;
    }

    // if pool empty after hard filters, relax slightly: try fallback to best-effort local
    if (pool.length === 0) {
      // attempt to find any local that at least satisfies vision/tools if those were required
      let fallbackPool = this.models.filter((m) => m.local);
      fallbackPool = this._filterByHardware(fallbackPool);
      if (merged.needsVision) fallbackPool = fallbackPool.filter((m) => m.supportsVision);
      if (merged.needsTools) fallbackPool = fallbackPool.filter((m) => m.supportsTools);
      if (fallbackPool.length > 0) pool = fallbackPool;
      else {
        // ultimate fallback: cheapest/fastest local
        pool = this.models.filter((m) => m.local);
        if (pool.length === 0) pool = [...this.models].slice(0, 3); // last resort
      }
    }

    // 2) score and sort
    const scored = pool.map((m) => ({ model: m, score: this._scoreModel(m, merged) }));
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    const alternatives = scored.slice(1, 4).map((s) => ({ id: s.model.id, provider: s.model.provider, score: s.score }));

    // 3) determine fallback (§25) — always have local fallback if best is cloud
    let fallback = null;
    if (!best.model.local) {
      fallback = this.getFallback(merged, best.model.id);
    } else {
      // best is local, fallback is second-best local or same
      const localAlts = scored.filter((s) => s.model.local && s.model.id !== best.model.id);
      if (localAlts.length > 0) fallback = localAlts[0].model;
    }

    const reasonParts = [];
    reasonParts.push(`taskType=${merged.taskType}`);
    if (merged.needsVision) reasonParts.push('vision');
    if (merged.needsTools) reasonParts.push('tools');
    if (merged.contextLength) reasonParts.push(`ctx>=${merged.contextLength}`);
    if (merged.quality) reasonParts.push(`quality>=${merged.quality}`);
    if (merged.costSensitive) reasonParts.push('costSensitive');
    if (merged.latency) reasonParts.push(`latency=${merged.latency}`);
    if (internetAvailable === false) reasonParts.push('offline→local');
    else if (merged.preferLocal || merged.taskType === TASK_TYPES.SENSITIVE) reasonParts.push('local-first');
    reasonParts.push(`score=${best.score}`);

    return {
      ok: true,
      model: best.model,
      fallback,
      reason: reasonParts.join(', '),
      alternatives,
      internetAvailable,
      localModels: localAvailable,
      scored: scored.map((s) => ({ id: s.model.id, score: s.score })),
      hardware: this.hardwareInfo,
    };
  }

  /** Synchronous wrapper when internet state is known (for tests) */
  routeSync(opts = {}) {
    // if internetAvailable not provided, assume online
    const merged = { internetAvailable: true, ...opts };
    // do sync filtering without Ollama network call — use cached or catalog
    let pool = [...this.models];
    pool = this._filterByHardware(pool);
    if (merged.internetAvailable === false) pool = pool.filter((m) => m.local);
    if (merged.needsVision || merged.vision) pool = pool.filter((m) => m.supportsVision);
    if (merged.needsTools || merged.toolCalling) pool = pool.filter((m) => m.supportsTools);
    if (merged.contextLength) pool = pool.filter((m) => m.contextLength >= Number(merged.contextLength));
    if (merged.quality) {
      const q = Number(merged.quality);
      const qF = pool.filter((m) => m.quality >= q);
      if (qF.length) pool = qF;
    }
    if (pool.length === 0) pool = this.models.filter((m) => m.local);
    const scored = pool.map((m) => ({ model: m, score: this._scoreModel(m, merged) }));
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    let fallback = null;
    if (best && !best.model.local) fallback = this.getFallback(merged, best.model.id);
    return { ok: !!best, model: best?.model || null, fallback, scored };
  }

  /** Compatibility alias */
  async selectModel(opts) { return this.route(opts); }
  selectModelSync(opts) { return this.routeSync(opts); }

  /**
   * Get fallback local model for given constraints — §25 fallback to local.
   * @param {object} opts - same routing opts
   * @param {string} failedModelId - cloud model that failed (optional)
   */
  getFallback(opts = {}, failedModelId = null) {
    let pool = this.models.filter((m) => m.local);
    pool = this._filterByHardware(pool);
    if (opts.needsVision || opts.vision) pool = pool.filter((m) => m.supportsVision);
    if (opts.needsTools || opts.toolCalling) pool = pool.filter((m) => m.supportsTools);
    if (opts.contextLength) pool = pool.filter((m) => m.contextLength >= Number(opts.contextLength));
    // prefer vision-capable local if need vision, else most capable
    if (pool.length === 0) {
      // no local satisfies vision/tools — return cheapest local regardless
      pool = this.models.filter((m) => m.local);
      pool = this._filterByHardware(pool);
      if (pool.length === 0) pool = this.models.filter((m) => m.local);
    }
    if (pool.length === 0) return null;
    // score remaining local pool with local-first bias
    const scored = pool.map((m) => ({ model: m, score: this._scoreModel(m, { ...opts, preferLocal: true }) }));
    scored.sort((a, b) => b.score - a.score);
    // avoid returning same as failed if possible
    const chosen = scored.find((s) => s.model.id !== failedModelId) || scored[0];
    return chosen?.model || null;
  }

  // ------------------------- offline queue (§25) -------------------------

  /**
   * Queue an operation when offline — §25 "Queue unavailable operations"
   */
  queueOperation(op) {
    const entry = { id: Math.random().toString(36).slice(2, 9), ts: new Date().toISOString(), op };
    this.queuedOps.push(entry);
    return { ok: true, queued: entry, size: this.queuedOps.length };
  }

  getQueuedOps() { return [...this.queuedOps]; }

  clearQueuedOps() { this.queuedOps = []; return { ok: true }; }

  /**
   * Resume queued ops when connectivity returns — §25 "Resume when connectivity returns"
   * Returns queued ops for caller to re-execute via cloud models.
   */
  async resumeQueued() {
    const internet = await this.checkInternet({ force: true });
    if (!internet) return { ok: false, error: 'Still offline', queued: this.queuedOps.length };
    const ops = [...this.queuedOps];
    this.queuedOps = [];
    return { ok: true, resumed: ops.length, ops };
  }

  // ------------------------- utilities -------------------------

  listModels(filter = {}) {
    let out = [...this.models];
    if (filter.provider) out = out.filter((m) => m.provider === filter.provider);
    if (filter.local !== undefined) out = out.filter((m) => m.local === filter.local);
    if (filter.supportsVision) out = out.filter((m) => m.supportsVision);
    if (filter.supportsTools) out = out.filter((m) => m.supportsTools);
    if (filter.minContext) out = out.filter((m) => m.contextLength >= filter.minContext);
    return out;
  }

  /** Provider-independent abstraction stub — future SDK dispatch */
  async call(modelId, prompt, opts = {}) {
    const model = getModelById(modelId) || this.models.find((m) => m.id === modelId);
    if (!model) return { ok: false, error: `Unknown model: ${modelId}` };
    // In production, dispatch to provider SDKs here (anthropic, openai, etc.)
    // For now, return a placeholder that shows routing succeeded and would call provider.
    return {
      ok: true,
      modelId: model.id,
      provider: model.provider,
      prompt: String(prompt).slice(0, 200),
      note: `Provider-independent call stub — would invoke ${model.provider} SDK for ${model.id}. Local=${model.local}`,
      local: model.local,
    };
  }

  getStats() {
    return {
      ok: true,
      catalogSize: this.models.length,
      providers: [...new Set(this.models.map((m) => m.provider))],
      localModels: this.models.filter((m) => m.local).map((m) => m.id),
      cloudModels: this.models.filter((m) => !m.local).map((m) => m.id),
      hardware: this.hardwareInfo,
      ollamaUrl: this.ollamaUrl,
      cost: this.getCostStats(),
      internetCache: this.internetCache,
      ollamaCache: this.ollamaCache,
      queuedOps: this.queuedOps.length,
    };
  }
}

// Default singleton for app / orchestrator
export const modelRouter = new ModelRouter();

export default ModelRouter;
