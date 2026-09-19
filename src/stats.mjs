import fs from 'node:fs';
import path from 'node:path';
import { GATEWAY_STORE_DIR } from './config.mjs';
import { loadCatalog } from './models.mjs';

// prod keeps the original file name so existing history is not orphaned; staging/local get
// their own file instead of silently mixing metrics from different backends
const DEFAULT_STATS_FILE = path.join(GATEWAY_STORE_DIR, 'stats.json');
const MAX_RECORDS = 2000;
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const FLUSH_DELAY_MS = 2000;
const TARGET_BUCKETS = 32;
const MAX_RECENT = 25;

let statsFile = DEFAULT_STATS_FILE;
let records = null;
let flushTimer = null;

/** Points metrics at the file for this apiEnv. Must run before the first read/write. */
export function useStatsEnvironment(apiEnv) {
  const next = apiEnv && apiEnv !== 'prod' ? path.join(GATEWAY_STORE_DIR, `stats.${apiEnv}.json`) : DEFAULT_STATS_FILE;
  if (next === statsFile) return statsFile;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (records) flush(); // don't drop records still sitting in the debounce window
  statsFile = next;
  records = null; // re-read lazily from the new file
  return statsFile;
}

function load() {
  if (records) return records;
  try {
    const data = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
    records = Array.isArray(data?.requests) ? data.requests.filter((entry) => typeof entry?.t === 'number') : [];
  } catch {
    records = [];
  }
  return records;
}

function flush() {
  flushTimer = null;
  if (!records) return;
  try {
    fs.mkdirSync(GATEWAY_STORE_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(statsFile, JSON.stringify({ updatedAt: Date.now(), requests: records }), {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch {
    /* metrics are best-effort, never break a request */
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
  flushTimer.unref?.();
}

export function modelPrice(modelId) {
  const model = loadCatalog().models.find((entry) => entry.id === modelId);
  const cost = model?.cost;
  if (!cost || Object.keys(cost).length === 0) return null;
  return cost;
}

export function estimateCost(modelId, usage) {
  const cost = modelPrice(modelId);
  if (!cost) return null;
  const per = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  const prompt = per(usage.promptTokens);
  const cached = Math.min(per(usage.cachedTokens), prompt);
  const fresh = Math.max(0, prompt - cached);
  return (
    (per(cost.input) * fresh + per(cost.cacheRead) * cached + per(cost.cacheWrite) * per(usage.cacheWriteTokens) + per(cost.output) * per(usage.completionTokens)) /
    1_000_000
  );
}

export function recordRequest(entry) {
  const list = load();
  const cost = entry.cost ?? estimateCost(entry.model, entry);
  list.push({
    t: entry.t ?? Date.now(),
    model: entry.model ?? 'unknown',
    accountId: entry.accountId ?? null,
    accountName: entry.accountName ?? null,
    protocol: entry.protocol ?? 'openai',
    stream: Boolean(entry.stream),
    ok: entry.ok !== false,
    ttftMs: typeof entry.ttftMs === 'number' ? entry.ttftMs : null,
    durationMs: typeof entry.durationMs === 'number' ? entry.durationMs : null,
    promptTokens: entry.promptTokens ?? 0,
    cachedTokens: entry.cachedTokens ?? 0,
    cacheWriteTokens: entry.cacheWriteTokens ?? 0,
    completionTokens: entry.completionTokens ?? 0,
    // outputTokens already includes reasoning; these split it so the panel can show the share
    reasoningTokens: entry.reasoningTokens ?? 0,
    textTokens: entry.textTokens ?? 0,
    reasoningChars: entry.reasoningChars ?? 0,
    cost: typeof cost === 'number' ? Math.round(cost * 1e8) / 1e8 : null,
    ...(entry.error ? { error: String(entry.error).slice(0, 200) } : {}),
  });

  const cutoff = Date.now() - KEEP_MS;
  while (list.length > MAX_RECORDS && list.length > 0 && list[0].t < cutoff) list.shift();
  if (list.length > MAX_RECORDS) list.splice(0, list.length - MAX_RECORDS);

  scheduleFlush();
  return list[list.length - 1];
}

function mean(values) {
  const usable = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (usable.length === 0) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function bucketPlan(sinceMs, hours) {
  const span = Math.max(60_000, hours * 3_600_000);
  const raw = span / TARGET_BUCKETS;
  const step = Math.max(60_000, Math.ceil(raw / 60_000) * 60_000);
  return { step, start: Math.floor(sinceMs / step) * step };
}

export function statsSnapshot({ hours = 24, accountId = 'all' } = {}) {
  const list = load();
  const now = Date.now();
  const since = now - hours * 3_600_000;
  const scope = !accountId || accountId === 'all' ? null : accountId;
  const windowAll = list.filter((entry) => entry.t >= since);
  const window = scope ? windowAll.filter((entry) => entry.accountId === scope) : windowAll;

  const ok = window.filter((entry) => entry.ok);
  const promptTokens = window.reduce((sum, e) => sum + (e.promptTokens || 0), 0);
  const cachedTokens = window.reduce((sum, e) => sum + (e.cachedTokens || 0), 0);
  const completionTokens = window.reduce((sum, e) => sum + (e.completionTokens || 0), 0);
  const cacheWriteTokens = window.reduce((sum, e) => sum + (e.cacheWriteTokens || 0), 0);
  const reasoningTokens = window.reduce((sum, e) => sum + (e.reasoningTokens || 0), 0);
  const textTokens = window.reduce((sum, e) => sum + (e.textTokens || 0), 0);
  const reasoningChars = window.reduce((sum, e) => sum + (e.reasoningChars || 0), 0);
  // only requests that reported a split can vouch for the share; the rest are "unknown"
  const reasoningKnown = window.filter((entry) => typeof entry.reasoningTokens === 'number');
  const reasoningOutputTokens = reasoningKnown.reduce((sum, e) => sum + (e.completionTokens || 0), 0);
  const cost = window.reduce((sum, e) => sum + (e.cost || 0), 0);
  const withTtft = window.filter((entry) => typeof entry.ttftMs === 'number');

  const { step, start } = bucketPlan(since, hours);
  const buckets = new Map();
  for (const entry of window) {
    const key = Math.floor(entry.t / step) * step;
    const bucket = buckets.get(key) ?? { t: key, requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    bucket.requests += 1;
    bucket.promptTokens += entry.promptTokens || 0;
    bucket.completionTokens += entry.completionTokens || 0;
    bucket.cost += entry.cost || 0;
    buckets.set(key, bucket);
  }
  const series = [];
  for (let t = start; t <= now; t += step) {
    series.push(buckets.get(t) ?? { t, requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 });
  }
  for (const bucket of buckets.values()) {
    if (bucket.t < start) series[0] = { ...series[0], requests: series[0].requests + bucket.requests };
  }

  const byModel = new Map();
  for (const entry of window) {
    const key = entry.model;
    const row = byModel.get(key) ?? {
      model: key,
      requests: 0,
      failed: 0,
      promptTokens: 0,
      cachedTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      // output tokens of only those requests that actually reported a reasoning split:
      // legacy records have no `reasoningTokens`, and counting them as "0 reasoning"
      // would claim a measurement we never made
      reasoningOutputTokens: 0,
      cost: 0,
      ttfts: [],
      price: modelPrice(key),
    };
    row.requests += 1;
    if (!entry.ok) row.failed += 1;
    row.promptTokens += entry.promptTokens || 0;
    row.cachedTokens += entry.cachedTokens || 0;
    row.completionTokens += entry.completionTokens || 0;
    row.reasoningTokens += entry.reasoningTokens || 0;
    if (typeof entry.reasoningTokens === 'number') row.reasoningOutputTokens += entry.completionTokens || 0;
    row.cost += entry.cost || 0;
    if (typeof entry.ttftMs === 'number') row.ttfts.push(entry.ttftMs);
    byModel.set(key, row);
  }
  const models = [...byModel.values()]
    .map((row) => ({
      model: row.model,
      requests: row.requests,
      failed: row.failed,
      promptTokens: row.promptTokens,
      cachedTokens: row.cachedTokens,
      completionTokens: row.completionTokens,
      reasoningTokens: row.reasoningTokens,
      reasoningShare: row.reasoningOutputTokens ? row.reasoningTokens / row.reasoningOutputTokens : null,
      cacheHitRate: row.promptTokens ? row.cachedTokens / row.promptTokens : null,
      avgTtftMs: mean(row.ttfts),
      cost: row.cost,
      price: row.price,
    }))
    .sort((a, b) => b.requests - a.requests);

  const accountRows = new Map();
  for (const entry of windowAll) {
    const key = entry.accountId ?? 'unknown';
    const row = accountRows.get(key) ?? {
      accountId: key,
      accountName: entry.accountName ?? key,
      requests: 0,
      failed: 0,
      promptTokens: 0,
      cachedTokens: 0,
      completionTokens: 0,
      cost: 0,
      ttfts: [],
    };
    row.requests += 1;
    if (!entry.ok) row.failed += 1;
    row.promptTokens += entry.promptTokens || 0;
    row.cachedTokens += entry.cachedTokens || 0;
    row.completionTokens += entry.completionTokens || 0;
    row.cost += entry.cost || 0;
    if (typeof entry.ttftMs === 'number') row.ttfts.push(entry.ttftMs);
    if (entry.accountName) row.accountName = entry.accountName;
    accountRows.set(key, row);
  }

  return {
    windowHours: hours,
    accountId: scope ?? 'all',
    since,
    generatedAt: now,
    totals: {
      requests: window.length,
      ok: ok.length,
      failed: window.length - ok.length,
      promptTokens,
      cachedTokens,
      cacheWriteTokens,
      completionTokens,
      reasoningTokens,
      textTokens,
      reasoningChars,
      reasoningShare: reasoningOutputTokens ? reasoningTokens / reasoningOutputTokens : null,
      reasoningSamples: reasoningKnown.length,
      totalTokens: promptTokens + completionTokens,
      cost,
      cacheHitRate: promptTokens ? cachedTokens / promptTokens : null,
      avgTtftMs: mean(withTtft.map((entry) => entry.ttftMs)),
      avgDurationMs: mean(ok.map((entry) => entry.durationMs)),
      measuredTtft: withTtft.length,
    },
    series,
    bucketMs: step,
    models,
    accounts: [...accountRows.values()]
      .map((row) => ({
        accountId: row.accountId,
        accountName: row.accountName,
        requests: row.requests,
        failed: row.failed,
        promptTokens: row.promptTokens,
        cachedTokens: row.cachedTokens,
        completionTokens: row.completionTokens,
        cacheHitRate: row.promptTokens ? row.cachedTokens / row.promptTokens : null,
        avgTtftMs: mean(row.ttfts),
        cost: row.cost,
        scoped: row.accountId === scope,
      }))
      .sort((a, b) => b.requests - a.requests),
    recent: window.slice(-MAX_RECENT).reverse(),
    retained: list.length,
  };
}
