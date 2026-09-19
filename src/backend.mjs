import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  isCooling,
  isInvalid,
  markInvalid,
  noteQuotaExhausted,
  noteRateLimited,
  noteServedAccount,
  noteSuccess,
  orderedAccounts,
} from './accounts.mjs';
import { peekPlanContext } from './plan.mjs';

export const GENERATE_ROUTE = '/alpha/generate';

const USER_AGENT = 'cli';
const MAX_STRUCTURE_ENTRIES = 60;
const MAX_ACCOUNT_ATTEMPTS = 4;

export class GatewayError extends Error {
  constructor(message, { status = 500, type = 'gateway_error', retryable = false, responseBody, retryAfterMs } = {}) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
    this.type = type;
    this.retryable = retryable;
    if (responseBody !== undefined) this.responseBody = responseBody;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

export function wirePermissionMode(mode) {
  if (mode === 'bypass') return 'auto-accept';
  if (mode === 'auto-accept' || mode === 'plan') return mode;
  return 'standard';
}

function readStructure(cwd) {
  try {
    return fs
      .readdirSync(cwd, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules')
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .sort()
      .slice(0, MAX_STRUCTURE_ENTRIES);
  } catch {
    return [];
  }
}

export function buildServerConfig(cwd) {
  const isGitRepo = fs.existsSync(path.join(cwd, '.git'));
  return {
    workingDir: cwd,
    date: new Date().toISOString().split('T')[0],
    environment: process.platform,
    structure: readStructure(cwd),
    isGitRepo,
    currentBranch: '',
    mainBranch: '',
    gitStatus: '',
    recentCommits: [],
  };
}

function parseEmbeddedError(text) {
  const start = text.indexOf('{');
  if (start >= 0) {
    try {
      const parsed = JSON.parse(text.slice(start));
      if (typeof parsed?.error?.message === 'string') return parsed;
    } catch {
      /* fall through to the raw text */
    }
  }
  return null;
}

function readRetryAfterMs(response) {
  const header = response.headers?.get?.('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30 * 60 * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), 30 * 60 * 1000));
  return undefined;
}

async function toGatewayError(response) {
  let text = '';
  try {
    text = await response.text();
  } catch {
    /* ignore */
  }
  const embedded = parseEmbeddedError(text);
  const message = embedded?.error?.message ?? (text.trim() || `Command Code backend responded with ${response.status}`);
  return new GatewayError(message, {
    status: response.status,
    type: embedded?.error?.type ?? 'backend_error',
    retryable: response.status === 408 || response.status === 429 || response.status >= 500,
    responseBody: text || undefined,
    retryAfterMs: readRetryAfterMs(response),
  });
}

/** Errors that mean "this account can't serve this request, try the next one". */
export function isRotatableError(error) {
  if (!error) return false;
  if ([401, 402, 403, 429].includes(error.status)) return true;
  const message = String(error.message ?? '').toLowerCase();
  return message.includes('insufficient credit') || message.includes('quota exceeded') || message.includes('rate limit');
}

/** The key itself is rejected: retrying this account will keep failing until it is re-verified. */
export function isAuthError(error) {
  if (!error) return false;
  if (error.status === 401 || error.status === 403) return true;
  const message = String(error.message ?? '').toLowerCase();
  return (
    message.includes('invalid key') ||
    message.includes('invalid api key') ||
    message.includes('not authenticated') ||
    message.includes('unauthorized') ||
    message.includes('session expired')
  );
}

/** Out of credits rather than merely rate limited: park until the quota window resets. */
export function isQuotaExhausted(error) {
  if (!error) return false;
  if (error.status === 402) return true;
  const message = String(error.message ?? '').toLowerCase();
  return message.includes('insufficient credit') || message.includes('quota exceeded') || message.includes('credit');
}

export function candidateAccounts(config) {
  const all = orderedAccounts(config);
  if (all.length <= 1) return all;
  const ready = all.filter((account) => !isCooling(account.id) && !isInvalid(account.id));
  if (ready.length > 0) return ready;
  // never leave the gateway with nothing to try: prefer merely-cooling accounts over dead keys
  const notInvalid = all.filter((account) => !isInvalid(account.id));
  return notInvalid.length > 0 ? notInvalid : all;
}

/**
 * The soonest quota window reset of an account we already have data for. Only used in
 * `sequential` mode, and only from the cache: a request must never wait on billing just
 * to decide how long to park an account.
 */
function quotaResetAt(config, accountId) {
  if (config.rotationMode !== 'sequential') return null;
  const context = peekPlanContext(accountId);
  const windows = context?.windowLimits ?? {};
  const resets = [windows.fiveHour?.resetAt, windows.weekly?.resetAt]
    .map((value) => (typeof value === 'number' ? value : Date.parse(value)))
    .filter((value) => Number.isFinite(value));
  return resets.length ? Math.min(...resets) : null;
}

function penalizeAccount(config, account, error) {
  if (isAuthError(error)) {
    markInvalid(config, account.id, { reason: error.message ?? 'Key 被拒绝', status: error.status ?? null });
    return;
  }
  if (isQuotaExhausted(error)) {
    noteQuotaExhausted(config, account.id, quotaResetAt(config, account.id));
    return;
  }
  noteRateLimited(config, account.id, error.retryAfterMs ?? undefined);
}

export function createBackend(config) {
  const sessionId = crypto.randomUUID();
  const baseUrl = config.baseUrl.replace(/\/+$/, '');

  const staticHeaders = {
    'Content-Type': 'application/json',
    'User-Agent': USER_AGENT,
    'x-command-code-version': config.cliVersion,
    'x-cli-environment': config.apiEnv === 'prod' ? 'production' : config.apiEnv,
    'x-project-slug': config.projectSlug,
    'x-taste-learning': 'false',
    'x-session-id': sessionId,
  };

  function buildHeaders(account) {
    const apiKey = account?.apiKey ?? config.apiKey;
    return { ...staticHeaders, ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
  }

  /**
   * Opens the upstream NDJSON stream. If an account is rate limited or out of credits the
   * next candidate is tried, so the caller only writes response headers once a stream is live.
   */
  async function openStream(body, { signal } = {}) {
    const candidates = candidateAccounts(config);
    if (candidates.length === 0) {
      throw new GatewayError(
        `No Command Code account found. Open /panel to sign in, or set COMMAND_CODE_API_KEY. Looked in ${config.storeFile}.`,
        { status: 401, type: 'not_authenticated' },
      );
    }

    const attempts = candidates.slice(0, MAX_ACCOUNT_ATTEMPTS);
    const failures = [];
    let lastError = null;

    for (const account of attempts) {
      let response;
      try {
        response = await fetch(`${baseUrl}${GENERATE_ROUTE}`, {
          method: 'POST',
          headers: buildHeaders(account),
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        throw new GatewayError(`POST ${GENERATE_ROUTE} -> network error: ${error?.message ?? String(error)}`, {
          status: 0,
          type: 'network_error',
          retryable: true,
        });
      }

      if (response.ok) {
        if (!response.body) {
          throw new GatewayError(`POST ${GENERATE_ROUTE} -> empty stream`, { status: 502, type: 'empty_stream', retryable: true });
        }
        noteSuccess(config, account.id);
        // hot path: only remember the switch, the credentials file is written on a debounce
        noteServedAccount(config, account.id);
        return { stream: response.body, account };
      }

      const error = await toGatewayError(response);
      if (isRotatableError(error) && attempts.length > 1 && account !== attempts[attempts.length - 1]) {
        penalizeAccount(config, account, error);
        failures.push(`${account.userName || account.id}: ${error.status}`);
        lastError = error;
        continue;
      }

      // terminal for this account (including the single-account case): still record why,
      // so a dead key shows up in the panel instead of being retried forever
      if (isAuthError(error) || isQuotaExhausted(error) || error.status === 429) {
        penalizeAccount(config, account, error);
      }

      error.message = attempts.length > 1 && failures.length
        ? `${error.message} (已尝试 ${[...failures, `${account.userName || account.id}: ${error.status}`].join(', ')})`
        : error.message;
      throw error;
    }

    const detail = failures.length ? ` (${failures.join(', ')})` : '';
    throw new GatewayError(`所有账号都不可用${detail}: ${lastError?.message ?? 'unknown'}`, {
      status: lastError?.status ?? 429,
      type: 'all_accounts_exhausted',
      retryable: true,
    });
  }

  async function* parseEvents(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const parse = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return null;
      const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
      if (!payload) return null;
      try {
        return JSON.parse(payload);
      } catch {
        return null;
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index = buffer.indexOf('\n');
        while (index >= 0) {
          const event = parse(buffer.slice(0, index));
          buffer = buffer.slice(index + 1);
          if (event) yield event;
          index = buffer.indexOf('\n');
        }
      }
      const tail = parse(buffer);
      if (tail) yield tail;
    } finally {
      await reader.cancel().catch(() => {});
    }
  }

  async function* generate(body, { signal } = {}) {
    const { stream } = await openStream(body, { signal });
    yield* parseEvents(stream);
  }

  return { sessionId, baseUrl, buildHeaders, openStream, parseEvents, generate };
}
