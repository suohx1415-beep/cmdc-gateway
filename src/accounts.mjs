import fs from 'node:fs';
import path from 'node:path';
import { cliAuthFile, gatewayStoreFile, readJsonSafe } from './config.mjs';

export const ROTATION_MODES = ['sequential', 'failover'];
export const DEFAULT_ROTATION_MODE = 'failover';
export const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;
/** Upper bound for "cool until the quota window resets" so a bogus resetAt can't park an account forever. */
export const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const STATE_FLUSH_MS = 1000;
const ACTIVE_FLUSH_MS = 1000;

const cooldowns = new Map();
const invalidAccounts = new Map();

const pendingStateFlushes = new Set();
const pendingActiveFlushes = new Set();
let stateFlushTimer = null;
let activeFlushTimer = null;

function storeFile(config) {
  return config.storeFile ?? gatewayStoreFile(config.apiEnv);
}

export function accountKey(credentials) {
  const userId = typeof credentials?.userId === 'string' ? credentials.userId.trim() : '';
  const userName = typeof credentials?.userName === 'string' ? credentials.userName.trim() : '';
  if (userId && userId !== 'manual-entry') return `user:${userId}`;
  if (userName) return `name:${userName.toLowerCase()}`;
  return `key:${(credentials?.apiKey ?? '').slice(-8)}`;
}

function normalizeAccount(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.apiKey !== 'string' || !raw.apiKey) return null;
  const userId = typeof raw.userId === 'string' ? raw.userId : '';
  const userName = typeof raw.userName === 'string' ? raw.userName : '';
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : accountKey({ userId, userName, apiKey: raw.apiKey }),
    apiKey: raw.apiKey,
    userId,
    userName,
    keyName: typeof raw.keyName === 'string' ? raw.keyName : '',
    authenticatedAt: typeof raw.authenticatedAt === 'string' ? raw.authenticatedAt : '',
    addedAt: typeof raw.addedAt === 'string' ? raw.addedAt : '',
  };
}

function emptyStore(config) {
  return {
    apiEnv: config.apiEnv,
    baseUrl: config.baseUrl,
    mode: DEFAULT_ROTATION_MODE,
    dashboard: 'all',
    activeId: null,
    accounts: [],
    states: {},
  };
}

export function readAccounts(config) {
  const data = readJsonSafe(storeFile(config));
  if (!data) return emptyStore(config);

  const store = emptyStore(config);
  store.mode = ROTATION_MODES.includes(data.mode) ? data.mode : DEFAULT_ROTATION_MODE;
  store.dashboard = typeof data.dashboard === 'string' && data.dashboard ? data.dashboard : 'all';
  store.activeId = typeof data.activeId === 'string' ? data.activeId : null;
  store.states = data.states && typeof data.states === 'object' && !Array.isArray(data.states) ? data.states : {};

  if (Array.isArray(data.accounts)) {
    store.accounts = data.accounts.map(normalizeAccount).filter(Boolean);
  } else if (typeof data.apiKey === 'string' && data.apiKey) {
    // migrate the single-account layout written by earlier versions
    const migrated = normalizeAccount(data);
    if (migrated) store.accounts = [migrated];
  }

  if (!store.activeId || !store.accounts.some((account) => account.id === store.activeId)) {
    store.activeId = store.accounts[0]?.id ?? null;
  }
  if (store.dashboard !== 'all' && !store.accounts.some((account) => account.id === store.dashboard)) {
    store.dashboard = 'all';
  }
  return store;
}

export function writeAccounts(config, store) {
  const file = storeFile(config);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
  return file;
}

/**
 * Cooldowns and invalid flags are runtime state that has to survive a restart, so they
 * are persisted next to the accounts instead of living only in module memory.
 */
function stateSnapshot() {
  const now = Date.now();
  const states = {};
  for (const [id, until] of cooldowns) {
    if (until > now) states[id] = { ...(states[id] ?? {}), cooldownUntil: until };
  }
  for (const [id, entry] of invalidAccounts) {
    states[id] = { ...(states[id] ?? {}), invalidAt: entry.at, invalidReason: entry.reason, invalidStatus: entry.status };
  }
  return states;
}

function hydrateRuntimeState(states) {
  cooldowns.clear();
  invalidAccounts.clear();
  if (!states || typeof states !== 'object' || Array.isArray(states)) return;
  const now = Date.now();
  for (const [id, entry] of Object.entries(states)) {
    if (!entry || typeof entry !== 'object') continue;
    const until = Number(entry.cooldownUntil);
    if (Number.isFinite(until) && until > now) cooldowns.set(id, until);
    if (typeof entry.invalidAt === 'string' && entry.invalidAt) {
      const status = Number(entry.invalidStatus);
      invalidAccounts.set(id, {
        at: entry.invalidAt,
        reason: typeof entry.invalidReason === 'string' ? entry.invalidReason : '',
        status: Number.isFinite(status) ? status : null,
      });
    }
  }
}

function persistState(config) {
  const store = config.storeData;
  if (!store) return null;
  store.states = stateSnapshot();
  return writeAccounts(config, store);
}

function persist(config) {
  const store = config.storeData;
  if (!store) return null;
  store.accounts = config.accounts;
  store.activeId = config.activeId;
  store.mode = config.rotationMode === 'off' ? DEFAULT_ROTATION_MODE : config.rotationMode;
  store.dashboard = config.dashboard ?? 'all';
  store.apiEnv = config.apiEnv;
  store.baseUrl = config.baseUrl;
  store.states = stateSnapshot();
  return writeAccounts(config, store);
}

function flushStates() {
  stateFlushTimer = null;
  const configs = [...pendingStateFlushes];
  pendingStateFlushes.clear();
  for (const config of configs) persistState(config);
}

function flushActive() {
  activeFlushTimer = null;
  const configs = [...pendingActiveFlushes];
  pendingActiveFlushes.clear();
  for (const config of configs) persist(config);
}

function scheduleStateFlush(config) {
  pendingStateFlushes.add(config);
  if (stateFlushTimer) return;
  stateFlushTimer = setTimeout(flushStates, STATE_FLUSH_MS);
  stateFlushTimer.unref?.();
}

function scheduleActiveFlush(config) {
  pendingActiveFlushes.add(config);
  if (activeFlushTimer) return;
  activeFlushTimer = setTimeout(flushActive, ACTIVE_FLUSH_MS);
  activeFlushTimer.unref?.();
}

/** Writes out anything still sitting in a debounce window (called on shutdown). */
export function flushPendingWrites() {
  if (stateFlushTimer) {
    clearTimeout(stateFlushTimer);
    flushStates();
  }
  if (activeFlushTimer) {
    clearTimeout(activeFlushTimer);
    flushActive();
  }
}

/**
 * An explicit --api-key / env key owns the runtime credential and is never written to
 * disk, so account mutations cannot take effect. Callers should refuse them up front.
 */
export function isReadonlyStore(config) {
  return Boolean(config?.apiKeyExplicit);
}

/** Loads the store onto the runtime config: accounts, active id, mode, and the active key. */
export function loadAccounts(config) {
  if (config.apiKeyExplicit) {
    // an explicit --api-key / env key wins and disables rotation
    cooldowns.clear();
    invalidAccounts.clear();
    config.accounts = [
      {
        id: 'explicit',
        apiKey: config.apiKey,
        userId: '',
        userName: '环境变量 / 命令行参数',
        keyName: 'explicit',
        authenticatedAt: '',
        addedAt: '',
        explicit: true,
      },
    ];
    config.activeId = 'explicit';
    config.rotationMode = 'off';
    config.dashboard = 'all';
    config.storeData = null;
    return config.accounts;
  }

  const store = readAccounts(config);
  if (store.accounts.length === 0 && config.useCliAuth) {
    const cli = readJsonSafe(cliAuthFile(config.apiEnv));
    if (typeof cli?.apiKey === 'string' && cli.apiKey) {
      const migrated = normalizeAccount({ ...cli, keyName: cli.keyName || 'cli' });
      if (migrated) {
        store.accounts = [migrated];
        store.activeId = migrated.id;
      }
    }
  }

  hydrateRuntimeState(store.states);
  config.storeData = store;
  config.accounts = store.accounts;
  config.activeId = store.activeId;
  config.rotationMode = store.mode;
  config.dashboard = store.dashboard;
  config.apiKey = store.accounts.find((account) => account.id === store.activeId)?.apiKey ?? '';
  config.apiKeySource = store.accounts.length ? 'gateway store' : 'none';
  return store.accounts;
}

function syncRuntime(config) {
  if (!config.accounts.some((account) => account.id === config.activeId)) {
    config.activeId = config.accounts[0]?.id ?? null;
  }
  const active = config.accounts.find((account) => account.id === config.activeId) ?? null;
  config.apiKey = active?.apiKey ?? '';
  config.apiKeySource = config.accounts.length ? 'gateway store' : 'none';
  return active;
}

/**
 * Adds or updates an account. Accounts that resolve to the same identity (userId, else
 * userName) are merged into one entry rather than duplicated.
 */
export function upsertAccount(config, credentials) {
  if (isReadonlyStore(config)) {
    throw new Error('账号管理在当前启动方式下不可用（使用了 --api-key 或环境变量 Key）');
  }
  const incoming = normalizeAccount(credentials);
  if (!incoming) throw new Error('invalid credentials');

  const existing = config.accounts.find(
    (account) =>
      account.id === incoming.id ||
      account.apiKey === incoming.apiKey ||
      (incoming.userId && account.userId === incoming.userId) ||
      (incoming.userName && account.userName.toLowerCase() === incoming.userName.toLowerCase()),
  );

  let merged;
  let created = false;
  if (existing) {
    merged = { ...existing, ...incoming, id: existing.id, addedAt: existing.addedAt || new Date().toISOString() };
    config.accounts = config.accounts.map((account) => (account.id === existing.id ? merged : account));
  } else {
    merged = { ...incoming, addedAt: new Date().toISOString() };
    config.accounts = [...config.accounts, merged];
    created = true;
  }

  // Only auto-activate when nothing is active: adding an account must not steal the
  // current slot, otherwise rotation would start from the newest account.
  if (!config.activeId || !config.accounts.some((account) => account.id === config.activeId)) {
    config.activeId = merged.id;
  }
  cooldowns.delete(merged.id);
  invalidAccounts.delete(merged.id);
  const file = persist(config);
  syncRuntime(config);
  return { account: merged, created, file };
}

export function removeAccount(config, id) {
  if (isReadonlyStore(config)) return { removed: false, readonly: true };
  const before = config.accounts.length;
  config.accounts = config.accounts.filter((account) => account.id !== id);
  if (config.accounts.length === before) return { removed: false };
  cooldowns.delete(id);
  invalidAccounts.delete(id);
  if (config.activeId === id) config.activeId = config.accounts[0]?.id ?? null;
  if (config.dashboard === id) config.dashboard = 'all';
  const file = persist(config);
  syncRuntime(config);
  return { removed: true, file };
}

export function setActiveAccount(config, id) {
  if (isReadonlyStore(config)) return { ok: false, readonly: true };
  if (!config.accounts.some((account) => account.id === id)) return { ok: false };
  config.activeId = id;
  cooldowns.delete(id);
  const file = persist(config);
  syncRuntime(config);
  return { ok: true, file };
}

export function setRotationMode(config, mode) {
  if (isReadonlyStore(config)) return { ok: false, readonly: true };
  if (!ROTATION_MODES.includes(mode)) return { ok: false };
  config.rotationMode = mode;
  const file = persist(config);
  return { ok: true, file };
}

export function setDashboardScope(config, scope) {
  if (isReadonlyStore(config)) return { ok: false, readonly: true };
  if (scope !== 'all' && !config.accounts.some((account) => account.id === scope)) return { ok: false };
  config.dashboard = scope;
  const file = persist(config);
  return { ok: true, file };
}

export function clearAccounts(config) {
  if (isReadonlyStore(config)) return { file: null, readonly: true };
  config.accounts = [];
  config.activeId = null;
  cooldowns.clear();
  invalidAccounts.clear();
  const file = persist(config);
  syncRuntime(config);
  return { file };
}

/** Accounts available to serve a request, preferred account first. */
export function orderedAccounts(config) {
  if (config.rotationMode === 'off' || config.accounts.length <= 1) return [...config.accounts];
  const activeIndex = config.accounts.findIndex((account) => account.id === config.activeId);
  if (activeIndex <= 0) return [...config.accounts];
  return [...config.accounts.slice(activeIndex), ...config.accounts.slice(0, activeIndex)];
}

export function isCooling(id) {
  const until = cooldowns.get(id);
  if (!until) return false;
  if (until <= Date.now()) {
    cooldowns.delete(id);
    return false;
  }
  return true;
}

export function noteRateLimited(config, id, cooldownMs = DEFAULT_COOLDOWN_MS) {
  const requested = Number(cooldownMs);
  const span = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_COOLDOWN_MS) : DEFAULT_COOLDOWN_MS;
  cooldowns.set(id, Date.now() + span);
  scheduleStateFlush(config);
}

/**
 * Parks an account whose quota is used up. `untilMs` is the quota window reset time when we
 * know it (sequential mode), otherwise the caller falls back to the default cooldown.
 */
export function noteQuotaExhausted(config, id, untilMs = null) {
  const now = Date.now();
  const target = Number(untilMs);
  const until = Number.isFinite(target) && target > now ? Math.min(target, now + MAX_COOLDOWN_MS) : now + DEFAULT_COOLDOWN_MS;
  cooldowns.set(id, until);
  scheduleStateFlush(config);
}

/** A 401/403 means the key itself is dead: keep the account out of rotation until re-verified. */
export function markInvalid(config, id, { reason = '', status = null } = {}) {
  const previous = invalidAccounts.get(id);
  invalidAccounts.set(id, { at: previous?.at ?? new Date().toISOString(), reason, status });
  scheduleStateFlush(config);
}

export function clearInvalid(config, id) {
  if (!invalidAccounts.delete(id)) return false;
  scheduleStateFlush(config);
  return true;
}

export function isInvalid(id) {
  return invalidAccounts.has(id);
}

export function invalidSnapshot() {
  const out = {};
  for (const [id, entry] of invalidAccounts) out[id] = { ...entry };
  return out;
}

export function clearCooldown(config, id) {
  if (!cooldowns.delete(id)) return false;
  scheduleStateFlush(config);
  return true;
}

export function noteSuccess(config, id) {
  const hadCooldown = cooldowns.delete(id);
  const wasInvalid = invalidAccounts.delete(id);
  if (hadCooldown || wasInvalid) scheduleStateFlush(config);
}

/**
 * Records the account that actually served a request. Called on the hot path, so the
 * credentials file is only written on a debounce instead of once per request.
 */
export function noteServedAccount(config, id) {
  if (config.rotationMode === 'off') return;
  if (config.activeId === id) return;
  const active = config.accounts.find((account) => account.id === id);
  if (!active) return;
  config.activeId = id;
  config.apiKey = active.apiKey;
  config.apiKeySource = config.accounts.length ? 'gateway store' : config.apiKeySource;
  scheduleActiveFlush(config);
}

export function cooldownSnapshot() {
  const now = Date.now();
  const out = {};
  for (const [id, until] of cooldowns) if (until > now) out[id] = until;
  return out;
}

export function publicAccounts(config) {
  const cooling = cooldownSnapshot();
  return config.accounts.map((account) => ({
    id: account.id,
    userName: account.userName || account.userId || 'unknown',
    userId: account.userId,
    keyName: account.keyName,
    maskedKey: account.apiKey.length > 10 ? `${account.apiKey.slice(0, 6)}...${account.apiKey.slice(-4)}` : '...',
    authenticatedAt: account.authenticatedAt,
    addedAt: account.addedAt,
    active: account.id === config.activeId,
    coolingUntil: cooling[account.id] ?? null,
    invalid: invalidAccounts.has(account.id),
    invalidAt: invalidAccounts.get(account.id)?.at ?? null,
    invalidReason: invalidAccounts.get(account.id)?.reason ?? null,
    explicit: Boolean(account.explicit),
  }));
}

export function accountSummary(config) {
  const accounts = publicAccounts(config);
  return {
    mode: config.rotationMode,
    dashboard: config.dashboard ?? 'all',
    activeId: config.activeId,
    count: config.accounts.length,
    multi: config.accounts.length > 1,
    coolingCount: accounts.filter((account) => account.coolingUntil).length,
    invalidCount: accounts.filter((account) => account.invalid).length,
    readonly: isReadonlyStore(config),
    accounts,
  };
}
