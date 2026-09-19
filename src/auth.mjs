import crypto from 'node:crypto';
import { GatewayError } from './backend.mjs';
import { clearAccounts, removeAccount, upsertAccount } from './accounts.mjs';

const STUDIO_BASE_URLS = {
  prod: 'https://commandcode.ai',
  staging: 'https://staging.commandcode.ai',
  local: 'http://localhost:3000',
};
const ALLOWED_CALLBACK_ORIGINS = ['http://localhost:3000', 'https://staging.commandcode.ai', 'https://commandcode.ai'];
const WHOAMI_ROUTE = '/alpha/whoami';
const LOGIN_TTL_MS = 10 * 60 * 1000;

const pendingLogins = new Set();
const pendingLanding = new Map();

function prune() {
  const cutoff = Date.now() - LOGIN_TTL_MS;
  for (const [state, entry] of pendingLanding) {
    if (entry.createdAt < cutoff) pendingLanding.delete(state);
  }
}

export function maskKey(apiKey) {
  if (!apiKey) return null;
  if (apiKey.length <= 10) return `${apiKey.slice(0, 3)}...`;
  return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`;
}

export async function fetchIdentity(config, apiKey) {
  let response;
  try {
    response = await fetch(`${config.baseUrl}${WHOAMI_ROUTE}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    });
  } catch (error) {
    return { valid: false, error: 'network_error', cause: error };
  }
  if (response.status === 401) return { valid: false, error: 'invalid_key', status: 401 };
  if (!response.ok) return { valid: false, error: 'server_error', status: response.status };
  try {
    return { valid: true, whoami: await response.json() };
  } catch {
    return { valid: false, error: 'server_error', status: response.status };
  }
}

const KEY_ERRORS = {
  invalid_key: 'API Key 无效或已被吊销（401）',
  server_error: '后端拒绝了该 Key，请稍后重试',
  network_error: '无法连接 Command Code 后端，请检查网络或 baseUrl',
};
export { KEY_ERRORS };

export async function loginWithApiKey(config, apiKey) {
  const key = String(apiKey ?? '').trim();
  if (!key) throw new GatewayError('请输入 API Key', { status: 400, type: 'invalid_request_error' });

  const result = await fetchIdentity(config, key);
  if (!result.valid) {
    throw new GatewayError(KEY_ERRORS[result.error] ?? '登录失败', {
      status: result.status === 401 ? 401 : 502,
      type: result.error,
    });
  }

  const user = result.whoami?.user ?? {};
  const stored = upsertAccount(config, {
    apiKey: key,
    userId: user.id ?? 'manual-entry',
    userName: user.userName || user.name || 'API Key',
    keyName: 'cli-manual-entry',
    authenticatedAt: new Date().toISOString(),
  });
  return { credentials: stored.account, whoami: result.whoami, file: stored.file, created: stored.created };
}

export function removeAccountById(config, id) {
  return removeAccount(config, id);
}

export function logout(config) {
  const file = clearAccounts(config);
  return { file };
}

export function startBrowserLogin(config) {
  prune();
  const state = crypto.randomBytes(32).toString('base64url');
  pendingLogins.add(state);
  const callback = `${config.callbackBase}/callback`;
  const studio = STUDIO_BASE_URLS[config.apiEnv] ?? STUDIO_BASE_URLS.prod;
  const url = `${studio}/studio/auth/cli?callback=${encodeURIComponent(callback)}&state=${encodeURIComponent(state)}&mode=redirect`;
  return { state, url, callback, expiresInMs: LOGIN_TTL_MS };
}

function paramReader(params) {
  return (key) => {
    const value = typeof params?.get === 'function' ? params.get(key) : params?.[key];
    return typeof value === 'string' ? value : undefined;
  };
}

export function completeBrowserLogin(config, params) {
  const get = paramReader(params);
  const state = get('state');

  const error = get('error');
  if (error) {
    return {
      ok: false,
      error: new GatewayError(get('error_description') || (error === 'access_denied' ? '授权被拒绝' : error), {
        status: error === 'access_denied' ? 403 : 400,
        type: error,
      }),
    };
  }

  if (!state || !pendingLogins.has(state)) {
    return { ok: false, error: new GatewayError('state 参数无效或已过期，请回到面板重新发起登录', { status: 403, type: 'invalid_state' }) };
  }
  pendingLogins.delete(state);

  const apiKey = get('apiKey');
  if (!apiKey) {
    return { ok: false, error: new GatewayError('回调里没有 apiKey 参数', { status: 400, type: 'missing_api_key' }) };
  }

  const stored = upsertAccount(config, {
    apiKey,
    userId: get('userId') ?? '',
    userName: get('userName') ?? '',
    keyName: get('keyName') ?? '',
    authenticatedAt: new Date().toISOString(),
  });
  pendingLanding.set(state, { createdAt: Date.now(), userName: stored.account.userName });
  prune();
  return { ok: true, credentials: stored.account, file: stored.file, state, created: stored.created };
}

export function takeLanding(state) {
  const entry = pendingLanding.get(state);
  if (!entry) return null;
  pendingLanding.delete(state);
  return entry;
}

export function allowedCallbackOrigin(origin) {
  return origin && ALLOWED_CALLBACK_ORIGINS.includes(origin) ? origin : ALLOWED_CALLBACK_ORIGINS[0];
}

export function authStatus(config) {
  const active = config.accounts.find((account) => account.id === config.activeId) ?? null;
  return {
    storeFile: config.storeFile,
    hasKey: config.accounts.length > 0,
    count: config.accounts.length,
    multi: config.accounts.length > 1,
    source: config.apiKeySource,
    maskedKey: maskKey(active?.apiKey),
    userId: active?.userId || null,
    userName: active?.userName || null,
    keyName: active?.keyName || null,
    authenticatedAt: active?.authenticatedAt || null,
    useCliAuth: Boolean(config.useCliAuth),
    storeDir: config.storeDir ?? null,
  };
}
