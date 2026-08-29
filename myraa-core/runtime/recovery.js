// Myraa Task Resume & Self-Correction — MASTER BUILD PROMPT §14, §15, §57
// Implements: durable execution resume (LOAD → RECONSTRUCT → VERIFY → RESUME SAFELY),
// self-correction loop (ACTION → FAILURE → CLASSIFY → RESEARCH/ANALYZE → ALTERNATIVE → RETRY → VERIFY),
// configurable maxRetries/maxTime/maxTokens/maxRecursion (§15), failure classification per §57,
// Detection/Classification/RecoveryStrategy/Fallback/Notification/StatePreservation (§57).

import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Failure Classification §57
// Every important failure should have: Detection, Classification, Recovery, Fallback, Notification, StatePreservation.
// ---------------------------------------------------------------------------
export const FailureCategory = Object.freeze({
  API_UNAVAILABLE: 'api_unavailable',
  MODEL_UNAVAILABLE: 'model_unavailable',
  INTERNET_UNAVAILABLE: 'internet_unavailable',
  TOOL_FAILURE: 'tool_failure',
  BROWSER_CRASH: 'browser_crash',
  APPLICATION_CRASH: 'application_crash',
  PC_RESTART: 'pc_restart',
  AGENT_FAILURE: 'agent_failure',
  DATABASE_FAILURE: 'database_failure',
  AUTHENTICATION_FAILURE: 'authentication_failure',
  GITHUB_FAILURE: 'github_failure',
  BUILD_FAILURE: 'build_failure',
  PERMISSION_DENIED: 'permission_denied',
  RESOURCE_EXHAUSTION: 'resource_exhaustion',
  TIMEOUT: 'timeout',
  BUDGET_EXCEEDED: 'budget_exceeded',
  CANCELLED: 'cancelled',
  UNKNOWN: 'unknown',
  TRANSIENT: 'transient',
});

// Map category -> recovery strategy defaults
const CATEGORY_STRATEGIES = Object.freeze({
  [FailureCategory.API_UNAVAILABLE]: { action: 'retry', backoffMs: 5000, fallback: 'switch_local', retryable: true, research: true },
  [FailureCategory.MODEL_UNAVAILABLE]: { action: 'fallback_model', backoffMs: 2000, fallback: 'switch_local', retryable: true, research: false },
  [FailureCategory.INTERNET_UNAVAILABLE]: { action: 'switch_local', backoffMs: 10000, fallback: 'queue', retryable: true, research: false },
  [FailureCategory.TOOL_FAILURE]: { action: 'alternative_strategy', backoffMs: 1000, fallback: 'retry', retryable: true, research: true },
  [FailureCategory.BROWSER_CRASH]: { action: 'retry', backoffMs: 2000, fallback: 'alternative_strategy', retryable: true, research: true },
  [FailureCategory.APPLICATION_CRASH]: { action: 'retry', backoffMs: 3000, fallback: 'reconstruct', retryable: true, research: true },
  [FailureCategory.PC_RESTART]: { action: 'resume_from_checkpoint', backoffMs: 1000, fallback: 'restart', retryable: true, research: false },
  [FailureCategory.AGENT_FAILURE]: { action: 'retry', backoffMs: 2000, fallback: 'alternative_strategy', retryable: true, research: true },
  [FailureCategory.DATABASE_FAILURE]: { action: 'retry', backoffMs: 3000, fallback: 'reconstruct', retryable: true, research: true },
  [FailureCategory.AUTHENTICATION_FAILURE]: { action: 'abort', backoffMs: 0, fallback: 'notify', retryable: false, research: false },
  [FailureCategory.GITHUB_FAILURE]: { action: 'retry', backoffMs: 5000, fallback: 'alternative_strategy', retryable: true, research: true },
  [FailureCategory.BUILD_FAILURE]: { action: 'alternative_strategy', backoffMs: 1000, fallback: 'research', retryable: true, research: true },
  [FailureCategory.PERMISSION_DENIED]: { action: 'abort', backoffMs: 0, fallback: 'notify', retryable: false, research: false },
  [FailureCategory.RESOURCE_EXHAUSTION]: { action: 'throttle', backoffMs: 10000, fallback: 'defer', retryable: true, research: true },
  [FailureCategory.TIMEOUT]: { action: 'retry', backoffMs: 3000, fallback: 'throttle', retryable: true, research: false },
  [FailureCategory.BUDGET_EXCEEDED]: { action: 'abort', backoffMs: 0, fallback: 'notify', retryable: false, research: false },
  [FailureCategory.CANCELLED]: { action: 'abort', backoffMs: 0, fallback: 'none', retryable: false, research: false },
  [FailureCategory.UNKNOWN]: { action: 'retry', backoffMs: 2000, fallback: 'research', retryable: true, research: true },
  [FailureCategory.TRANSIENT]: { action: 'retry', backoffMs: 1000, fallback: 'retry', retryable: true, research: false },
});

function nowIso() { return new Date().toISOString(); }
function genId() { return Math.random().toString(36).slice(2, 9) + '-' + Date.now().toString(36); }

// ---------------------------------------------------------------------------
// Classifier — Detect & Classify per §57
// ---------------------------------------------------------------------------
export function classifyFailure(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  const stack = String(error?.stack || '').toLowerCase();
  const combined = `${msg} ${stack}`.slice(0, 2000);

  const tests = [
    { cat: FailureCategory.API_UNAVAILABLE, rx: /api.*unavailable|api.*timeout|fetch.*failed|econnrefused.*api|api.*error.*5\d\d|service.*unavailable/i },
    { cat: FailureCategory.MODEL_UNAVAILABLE, rx: /model.*unavailable|model.*failed|overloaded|rate limit|429|quota.*exceeded|model.*not found/i },
    { cat: FailureCategory.INTERNET_UNAVAILABLE, rx: /internet|network.*unavailable|offline|enotfound|econnreset|dns.*fail|no internet|network.*error/i },
    { cat: FailureCategory.RESOURCE_EXHAUSTION, rx: /resource.*exhaust|memory.*exhaust|cpu.*high|disk.*full|oom|out of memory|no space left/i },
    { cat: FailureCategory.TOOL_FAILURE, rx: /tool.*fail|execution.*fail|handler.*fail|tool.*error|unknown tool/i },
    { cat: FailureCategory.BROWSER_CRASH, rx: /browser.*crash|browser.*closed|playwright.*error|puppeteer.*error|browser.*disconnected/i },
    { cat: FailureCategory.APPLICATION_CRASH, rx: /application.*crash|app.*crash|electron.*crash|window.*crash|segfault/i },
    { cat: FailureCategory.PC_RESTART, rx: /pc.*restart|system.*restart|reboot|shutdown.*restart|machine.*restart/i },
    { cat: FailureCategory.AGENT_FAILURE, rx: /agent.*failed|agent.*error|agent.*crash|delegation.*fail/i },
    { cat: FailureCategory.DATABASE_FAILURE, rx: /database|sqlite|leveldb|storage.*failed|disk.*error|db.*fail|level.*down/i },
    { cat: FailureCategory.AUTHENTICATION_FAILURE, rx: /auth.*fail|unauthorized|401|403|token.*invalid|credential.*fail|login.*fail|forbidden/i },
    { cat: FailureCategory.GITHUB_FAILURE, rx: /github.*fail|gh.*fail|git.*push.*fail|repository.*not found|remote.*fail/i },
    { cat: FailureCategory.BUILD_FAILURE, rx: /build.*fail|compile.*fail|aapt2|gradle.*fail|tsc.*error|vite.*error|webpack.*fail/i },
    { cat: FailureCategory.PERMISSION_DENIED, rx: /permission.*denied|blocked.*policy|needs.*confirm|access.*denied|forbidden.*policy/i },
    { cat: FailureCategory.TIMEOUT, rx: /timeout|timed out|deadline.*exceeded/i },
    { cat: FailureCategory.BUDGET_EXCEEDED, rx: /budget.*exceed|max.*retries.*exceed|cost.*exceed|token.*budget/i },
    { cat: FailureCategory.CANCELLED, rx: /cancelled|canceled|aborted|abort/i },
  ];

  for (const { cat, rx } of tests) {
    if (rx.test(combined)) return cat;
  }
  // heuristic: transient network 5xx
  if (/5\d\d/.test(combined) && /fetch|request|http/i.test(combined)) return FailureCategory.TRANSIENT;
  return FailureCategory.UNKNOWN;
}

export function getRecoveryStrategy(category, attempt = 0) {
  const base = CATEGORY_STRATEGIES[category] || CATEGORY_STRATEGIES[FailureCategory.UNKNOWN];
  const exponentialBackoff = base.backoffMs ? Math.min(base.backoffMs * Math.pow(2, attempt), 30000) : 0;
  return {
    category,
    action: base.action,
    fallback: base.fallback,
    retryable: base.retryable,
    research: base.research,
    backoffMs: exponentialBackoff,
    attempt,
  };
}

// ---------------------------------------------------------------------------
// RecoveryEngine — §14 Task Resume + §15 Self-Correction + §57 Failure Modes
// ---------------------------------------------------------------------------
export class RecoveryEngine {
  /**
   * @param {object} opts
   * @param {object} opts.longRunningManager - LongRunningManager instance
   * @param {object} opts.eventBus - optional eventBus
   * @param {object} opts.logger
   * @param {object} opts.limits - { maxRetries, maxTimeSec, maxTokens, maxCost, maxRecursionDepth }
   */
  constructor({ longRunningManager = null, eventBus = null, logger = console, limits = {} } = {}) {
    this.manager = longRunningManager;
    this.eventBus = eventBus;
    this.logger = logger;
    this.limits = {
      maxRetries: limits.maxRetries ?? 3,
      maxTimeSec: limits.maxTimeSec ?? 10800,
      maxTokens: limits.maxTokens ?? 80000,
      maxCost: limits.maxCost ?? 10,
      maxRecursionDepth: limits.maxRecursionDepth ?? 10,
      ...limits,
    };
    this._globalBus = null;
    try { import('../eventBus.js').then(m => { this._globalBus = m; }).catch(() => {}); } catch {}
  }

  _emit(event, payload) {
    const data = { ts: nowIso(), event, ...payload };
    try { this.eventBus?.emit?.(event, data); } catch {}
    try { this._globalBus?.emit?.(event, data); } catch {}
    try { import('../eventBus.js').then(m => { try { m.emit(event, payload); } catch {} }).catch(() => {}); } catch {}
  }

  // ------------------------- §14 Task Resume -------------------------
  /**
   * Load task state from persistence — §14 LOAD TASK STATE
   */
  loadTaskState(taskId) {
    if (!this.manager) return { ok: false, error: 'No manager' };
    const res = this.manager.getTask(taskId);
    if (!res.ok) return res;
    return { ok: true, task: res.task };
  }

  /**
   * Reconstruct environment — §14 RECONSTRUCT ENVIRONMENT
   * Verifies cwd, required files, device availability, etc.
   */
  async reconstructEnvironment(task) {
    const issues = [];
    // Check mission still valid
    if (!task.mission) issues.push('missing mission');
    // Check device — if pc/server etc.
    // For filesystem tasks, verify checkpoints state files exist
    if (task.checkpoints && task.checkpoints.length) {
      const last = task.checkpoints[task.checkpoints.length - 1];
      if (last && last.state && typeof last.state === 'object' && last.state.cwd) {
        try {
          if (!fs.existsSync(String(last.state.cwd))) issues.push(`cwd not found: ${last.state.cwd}`);
        } catch (e) { issues.push(`cwd check failed: ${e.message}`); }
      }
      // Check if task's working dir files exist
      if (last && last.state && last.state.files) {
        for (const f of [].concat(last.state.files).slice(0, 5)) {
          try { if (f && typeof f === 'string' && !fs.existsSync(f)) issues.push(`file not found: ${f}`); } catch {}
        }
      }
    }
    // Check task not already terminal
    if (['done','failed','cancelled','timeout','budget_exceeded'].includes(String(task.status))) {
      issues.push(`task already terminal: ${task.status}`);
    }
    if (issues.length) {
      return { ok: false, issues, reconstructed: false, reason: issues.join('; ') };
    }
    return { ok: true, reconstructed: true, issues: [] };
  }

  /**
   * Verify last checkpoint — §14 VERIFY LAST CHECKPOINT
   */
  verifyLastCheckpoint(taskId) {
    if (!this.manager) return { ok: false, error: 'No manager' };
    return this.manager.verifyLastCheckpoint(taskId);
  }

  /**
   * Resume safely — §14 RESUME SAFELY
   * Do not restart from zero unless necessary (durable execution).
   */
  async resumeSafely(taskId, executor) {
    if (!this.manager) return { ok: false, error: 'No manager' };
    const taskRes = this.manager.getTask(taskId);
    if (!taskRes.ok) return taskRes;
    const task = taskRes.task;
    this.logger.info?.(`[Recovery] resumeSafely ${taskId} status=${task.status}`);

    // 1) LOAD already done
    // 2) RECONSTRUCT
    const recon = await this.reconstructEnvironment(task);
    if (!recon.ok) {
      // If reconstruction fails and no checkpoint, we must fail safely
      const verify = this.verifyLastCheckpoint(taskId);
      if (!verify.ok || !verify.valid) {
        const err = `Reconstruct failed and no valid checkpoint: ${recon.reason}`;
        this._emit('recovery', { taskId, stage: 'reconstruct_failed', error: err, verify });
        return { ok: false, error: err, stage: 'reconstruct', verify, recon };
      }
      // else we can still attempt resume from checkpoint even if env imperfect
      this.logger.warn?.(`[Recovery] reconstruct warnings for ${taskId}: ${recon.reason} — continuing from checkpoint`);
    }

    // 3) VERIFY
    const verify = this.verifyLastCheckpoint(taskId);
    if (!verify.ok) {
      // No checkpoints — need to restart from zero but only if necessary
      // Check if task never started (pending) -> safe to restart
      if (task.status === 'pending' || !task.startedAt) {
        this.logger.info?.(`[Recovery] ${taskId} no checkpoint but pending — restarting from zero`);
        return this.manager.resume(taskId, executor);
      }
      return { ok: false, error: 'No checkpoints and task already started — cannot safely resume', stage: 'verify', verify };
    }
    if (!verify.valid) {
      this.logger.warn?.(`[Recovery] checkpoint invalid for ${taskId}: ${verify.reason} — restarting from zero with caution`);
      // Still allow resume but note it will restart
    }

    // 4) RESUME
    // Use manager.resume which handles status transitions and checkpoint awareness
    try {
      const res = await this.manager.resume(taskId, executor);
      this._emit('recovery', { taskId, stage: 'resumed', fromCheckpoint: verify.valid, checkpoint: verify.checkpoint });
      return res;
    } catch (e) {
      const err = e.message || String(e);
      this._emit('recovery', { taskId, stage: 'resume_failed', error: err });
      return { ok: false, error: err, stage: 'resume' };
    }
  }

  /**
   * Full recover flow for all interrupted tasks on restart — §14 APP RESTART
   */
  async recoverAll(executorFactory) {
    if (!this.manager) return { ok: false, error: 'No manager' };
    return this.manager.recover(executorFactory);
  }

  // ------------------------- §15 Self-Correction -------------------------
  /**
   * Classify failure — wrapper around classifyFailure with task context
   */
  classify(error, task = null) {
    const cat = classifyFailure(error);
    const strategy = getRecoveryStrategy(cat, task?.usage?.retries || 0);
    return { category: cat, strategy, error: String(error?.message || error).slice(0, 500) };
  }

  /**
   * Research / Analyze step — stub for integration with Research Agent.
   * In production, this would invoke searchWeb/research docs.
   */
  async researchAnalyze(error, category, task) {
    // Simulate analysis: return alternative strategy hints
    const hints = {
      [FailureCategory.BUILD_FAILURE]: 'Try cleaning build cache, reinstall dependencies, check missing files',
      [FailureCategory.TOOL_FAILURE]: 'Try alternative tool or fallback per §8 (Native→Accessibility→Browser→Visual→mouse)',
      [FailureCategory.API_UNAVAILABLE]: 'Switch to local model or retry with backoff',
      [FailureCategory.GITHUB_FAILURE]: 'Verify remote, check auth token, verify branch exists',
      [FailureCategory.PERMISSION_DENIED]: 'Request confirmation via policy engine §34',
      [FailureCategory.RESOURCE_EXHAUSTION]: 'Reduce concurrency, defer heavy tasks per §45',
    };
    const hint = hints[category] || 'Retry with exponential backoff and verify result';
    this.logger.info?.(`[Recovery] researchAnalyze ${category}: ${hint} for "${String(error).slice(0,100)}"`);
    this._emit('recovery', { taskId: task?.id, stage: 'research', category, hint, error: String(error).slice(0,200) });
    // Emit audit-like trace
    return { ok: true, category, hint, error: String(error).slice(0,500) };
  }

  /**
   * Determine alternative strategy — based on category and attempt
   */
  getAlternativeStrategy(category, attempt, task) {
    const base = getRecoveryStrategy(category, attempt);
    // Augment with task-specific alternatives
    let alternative = base.action;
    let details = '';
    switch (category) {
      case FailureCategory.TOOL_FAILURE:
        alternative = attempt === 0 ? 'retry_same_tool' : attempt === 1 ? 'fallback_tool' : 'alternative_strategy';
        details = attempt === 0 ? 'Retry same tool' : 'Use fallback tool per §8';
        break;
      case FailureCategory.BUILD_FAILURE:
        alternative = attempt === 0 ? 'clean_and_retry' : attempt === 1 ? 'reinstall_deps' : 'alternative_build';
        details = 'Try clean build, then reinstall, then alternative';
        break;
      case FailureCategory.API_UNAVAILABLE:
      case FailureCategory.MODEL_UNAVAILABLE:
        alternative = attempt === 0 ? 'retry' : 'switch_local';
        details = 'Retry cloud, then switch to local model per §25';
        break;
      case FailureCategory.INTERNET_UNAVAILABLE:
        alternative = 'switch_local';
        details = 'Switch to local capabilities per §25 local-first';
        break;
      case FailureCategory.RESOURCE_EXHAUSTION:
        alternative = 'throttle';
        details = 'Reduce concurrency, defer per §45';
        break;
      case FailureCategory.BROWSER_CRASH:
        alternative = attempt === 0 ? 'restart_browser' : 'alternative_strategy';
        details = 'Restart browser session';
        break;
      default:
        alternative = base.action;
        details = `Strategy: ${base.action}, fallback: ${base.fallback}`;
    }
    return { ...base, alternative, details, attempt };
  }

  /**
   * Check if limits exceeded — §15 When limits are exceeded: Safely stop and report.
   */
  checkLimits(task) {
    const u = task.usage || {};
    const budget = task.budget || this.limits;
    const elapsedSec = task.startedAt ? (Date.now() - new Date(task.startedAt).getTime()) / 1000 : 0;
    let exceeded = null;
    let detail = null;
    if (u.retries >= (task.budget?.maxRetries ?? this.limits.maxRetries)) { exceeded = 'maxRetries'; detail = `${u.retries} >= ${task.budget?.maxRetries ?? this.limits.maxRetries}`; }
    else if (elapsedSec > (task.budget?.maxTimeSec ?? this.limits.maxTimeSec)) { exceeded = 'maxTimeSec'; detail = `${Math.floor(elapsedSec)}s > ${task.budget?.maxTimeSec ?? this.limits.maxTimeSec}s`; }
    else if ((u.tokens || 0) > (task.budget?.maxTokens ?? this.limits.maxTokens)) { exceeded = 'maxTokens'; detail = `${u.tokens} > ${task.budget?.maxTokens ?? this.limits.maxTokens}`; }
    else if ((u.cost || 0) > (task.budget?.maxCost ?? this.limits.maxCost)) { exceeded = 'maxCost'; detail = `${u.cost} > ${task.budget?.maxCost ?? this.limits.maxCost}`; }
    else if ((u.recursionDepth || 0) > (task.budget?.maxRecursionDepth ?? this.limits.maxRecursionDepth)) { exceeded = 'maxRecursionDepth'; detail = `${u.recursionDepth} > ${task.budget?.maxRecursionDepth ?? this.limits.maxRecursionDepth}`; }

    if (exceeded) {
      return { exceeded: true, field: exceeded, detail, elapsedSec };
    }
    return { exceeded: false, elapsedSec };
  }

  /**
   * Safely stop and report — when limits exceeded per §15
   */
  async safelyStop(taskId, reason) {
    if (!this.manager) return { ok: false, error: 'No manager' };
    const tRes = this.manager.getTask(taskId);
    if (!tRes.ok) return tRes;
    const task = this.manager._getMutable(taskId);
    if (!task) return { ok: false, error: `Task not found: ${taskId}` };
    const prev = task.status;
    // Preserve state via checkpoint before stopping
    this.manager.checkpoint(taskId, { safelyStopped: true, reason, usage: { ...task.usage } }, { message: `safely stopped: ${reason}` });
    task.status = 'failed';
    task.error = `Safely stopped: ${reason}`;
    task.completedAt = nowIso();
    task.updatedAt = nowIso();
    if (!task.history) task.history = [];
    task.history.push({ ts: nowIso(), from: prev, to: task.status, reason });
    this.manager.save();
    this._emit('task:failed', { taskId, error: task.error, reason: 'safely_stopped', detail: reason });
    this._emit('recovery', { taskId, stage: 'safely_stopped', reason });
    this.logger.warn?.(`[Recovery] safelyStop ${taskId}: ${reason}`);
    return { ok: true, taskId, reason, status: task.status };
  }

  /**
   * Self-correction loop — §15
   * ACTION → FAILURE → CLASSIFY → RESEARCH/ANALYZE → ALTERNATIVE STRATEGY → RETRY → VERIFY
   * @param {string} taskId
   * @param {Error|string} error - failure from ACTION
   * @param {function} retryFn - async (strategy, attempt) => result ; should throw on failure
   * @param {object} opts - { maxRetries }
   */
  async selfCorrect(taskId, error, retryFn, opts = {}) {
    if (!this.manager) return { ok: false, error: 'No manager' };
    const taskRes = this.manager.getTask(taskId);
    if (!taskRes.ok) return taskRes;
    const task = this.manager._getMutable(taskId);
    const originalError = String(error?.message || error);
    this.logger.info?.(`[Recovery] selfCorrect ${taskId}: ${originalError.slice(0,150)}`);

    // 1) CLASSIFY
    const cat = classifyFailure(error);
    const strategy = getRecoveryStrategy(cat, task.usage.retries);
    this._emit('recovery', { taskId, stage: 'classified', category: cat, strategy, error: originalError.slice(0,200) });

    // 2) Check limits before retry — §15 configurable limits
    const limitsCheck = this.checkLimits(task);
    if (limitsCheck.exceeded) {
      this.logger.warn?.(`[Recovery] limits exceeded for ${taskId}: ${limitsCheck.field} ${limitsCheck.detail}`);
      return this.safelyStop(taskId, `Limits exceeded: ${limitsCheck.field} ${limitsCheck.detail}`);
    }
    // Also check manager budget
    const budgetCheck = this.manager.checkBudget(taskId);
    if (budgetCheck.exceeded) {
      return this.safelyStop(taskId, `Budget exceeded: ${budgetCheck.field} ${budgetCheck.detail}`);
    }
    // Check non-retryable
    if (!strategy.retryable) {
      this.logger.warn?.(`[Recovery] non-retryable ${cat} for ${taskId} — aborting`);
      this._emit('recovery', { taskId, stage: 'non_retryable', category: cat });
      return { ok: false, error: originalError, category: cat, retryable: false, reason: 'non-retryable' };
    }

    // 3) RESEARCH / ANALYZE
    const analysis = await this.researchAnalyze(error, cat, task);

    // 4) ALTERNATIVE STRATEGY
    const alt = this.getAlternativeStrategy(cat, task.usage.retries, task);
    this.logger.info?.(`[Recovery] alternative for ${taskId}: ${alt.alternative} (${alt.details}) attempt ${task.usage.retries}`);
    this._emit('recovery', { taskId, stage: 'alternative', alternative: alt.alternative, details: alt.details, category: cat, attempt: task.usage.retries });

    // 5) RETRY — with backoff
    const maxRetries = opts.maxRetries ?? task.budget.maxRetries ?? this.limits.maxRetries;
    if (task.usage.retries >= maxRetries) {
      return this.safelyStop(taskId, `Max retries ${maxRetries} exceeded`);
    }
    const backoffMs = alt.backoffMs || strategy.backoffMs || 1000;
    if (backoffMs > 0) {
      this.logger.info?.(`[Recovery] backing off ${backoffMs}ms before retry ${task.usage.retries + 1}/${maxRetries} for ${taskId}`);
      await new Promise(r => setTimeout(r, backoffMs));
    }

    // Increment retry count and checkpoint
    task.usage.retries += 1;
    task.failures = task.failures || [];
    task.failures.push({ ts: nowIso(), error: originalError.slice(0,500), category: cat, attempt: task.usage.retries });
    this.manager.checkpoint(taskId, { selfCorrect: true, attempt: task.usage.retries, category: cat, alternative: alt.alternative, error: originalError.slice(0,300) }, { message: `self-correct retry ${task.usage.retries}/${maxRetries}: ${cat}` });
    this.manager.save();
    this._emit('task:retrying', { taskId, attempt: task.usage.retries, category: cat, alternative: alt.alternative });

    // Execute retry function with strategy
    try {
      const result = await retryFn(alt, task.usage.retries);
      // 6) VERIFY
      const verifyOk = result?.ok !== false;
      if (verifyOk) {
        this.logger.info?.(`[Recovery] retry succeeded for ${taskId} attempt ${task.usage.retries}`);
        this._emit('recovery', { taskId, stage: 'retry_succeeded', attempt: task.usage.retries, category: cat });
        return { ok: true, result, category: cat, attempt: task.usage.retries, alternative: alt.alternative };
      } else {
        // Retry returned failure — recurse if retries left
        const err2 = result?.error || 'retry returned ok:false';
        this.logger.warn?.(`[Recovery] retry returned failure for ${taskId}: ${err2.slice(0,200)}`);
        if (task.usage.retries < maxRetries) {
          return this.selfCorrect(taskId, err2, retryFn, opts);
        } else {
          return this.safelyStop(taskId, `Retries exhausted after ${task.usage.retries} attempts: ${err2.slice(0,200)}`);
        }
      }
    } catch (e2) {
      const err2 = e2.message || String(e2);
      this.logger.warn?.(`[Recovery] retry threw for ${taskId}: ${err2.slice(0,200)}`);
      if (task.usage.retries < maxRetries) {
        return this.selfCorrect(taskId, err2, retryFn, opts);
      } else {
        return this.safelyStop(taskId, `Retries exhausted after ${task.usage.retries} attempts: ${err2.slice(0,200)}`);
      }
    }
  }

  /**
   * Handle failure with full §57 pipeline: Detection, Classification, RecoveryStrategy, Fallback, Notification, StatePreservation
   */
  async handleFailure(taskId, error, context = {}) {
    if (!this.manager) return { ok: false, error: 'No manager' };
    const taskRes = this.manager.getTask(taskId);
    if (!taskRes.ok) return taskRes;
    const cat = classifyFailure(error);
    const strategy = getRecoveryStrategy(cat, taskRes.task.usage.retries);
    const fallback = strategy.fallback;

    // State preservation: checkpoint failure
    this.manager.checkpoint(taskId, { failure: String(error).slice(0,500), category: cat, context, ts: nowIso() }, { message: `failure checkpoint: ${cat}` });

    // Notification
    this._emit('recovery', { taskId, stage: 'failure_detected', category: cat, error: String(error).slice(0,200), strategy, fallback });
    this._emit('error', { taskId, error: String(error).slice(0,300), category: cat });

    // Determine if should fallback
    let fallbackAction = null;
    if (!strategy.retryable) {
      fallbackAction = 'notify_and_abort';
    } else if (fallback === 'switch_local') {
      fallbackAction = 'switch to local model per §25';
    } else if (fallback === 'queue') {
      fallbackAction = 'queue for later per §25';
    }

    return {
      ok: true,
      taskId,
      category: cat,
      strategy,
      fallback,
      fallbackAction,
      error: String(error).slice(0,500),
      detection: 'classified',
      classification: cat,
      recoveryStrategy: strategy.action,
      statePreserved: true,
    };
  }

  // ------------------------- stats -------------------------
  getStats() {
    return {
      ok: true,
      limits: { ...this.limits },
      categories: Object.values(FailureCategory),
      strategies: Object.keys(CATEGORY_STRATEGIES).length,
    };
  }
}

// Default singleton (lazy manager injection)
export const recoveryEngine = new RecoveryEngine();

export default RecoveryEngine;
