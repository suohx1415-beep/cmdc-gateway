#!/usr/bin/env node
import crypto from 'node:crypto';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { buildServerConfig, createBackend, wirePermissionMode, GatewayError } from './backend.mjs';
import {
  accountSummary,
  clearCooldown,
  clearInvalid,
  flushPendingWrites,
  isReadonlyStore,
  loadAccounts,
  markInvalid,
  removeAccount,
  upsertAccount,
  setActiveAccount,
  setDashboardScope,
  setRotationMode,
} from './accounts.mjs';
import {
  allowedCallbackOrigin,
  authStatus,
  completeBrowserLogin,
  fetchIdentity,
  KEY_ERRORS,
  loginWithApiKey,
  logout,
  startBrowserLogin,
  takeLanding,
} from './auth.mjs';
import { isLoopbackAddress, loadConfig, toPublicConfig } from './config.mjs';
import { anthropicModelList, findModel, loadCatalog, openAIModel, openAIModelList } from './models.mjs';
import {
  buildModelView,
  getPlanContext,
  getPlanContexts,
  invalidatePlanContext,
  quotaSnapshot,
  quotaSnapshotForScope,
  quotaSummaries,
} from './plan.mjs';
import { recordRequest, statsSnapshot, useStatsEnvironment } from './stats.mjs';
import { listClients, publish, publishPer, subscribe } from './events.mjs';
import { fingerprintStatus, recordFingerprint } from './fingerprint.mjs';
import { translateChatRequest, OpenAIReply } from './openai.mjs';
import { translateMessagesRequest, AnthropicReply } from './anthropic.mjs';
import { panelHtml, callbackPage } from './panel.mjs';

const MAX_BODY_BYTES = 64 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...corsHeaders(),
    ...extraHeaders,
  });
  res.end(body);
}

function sendError(res, error, dialect = 'openai') {
  if (res.headersSent) return;
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
  const message = error?.message ?? 'Internal gateway error';
  const type = error?.type ?? 'gateway_error';
  if (dialect === 'anthropic') {
    sendJson(res, status, { type: 'error', error: { type, message } });
    return;
  }
  sendJson(res, status, { error: { message, type, code: error?.code ?? null, param: null } });
}

function requireMessages(body) {
  if (!Array.isArray(body.messages)) {
    throw new GatewayError('Missing required field: messages', { status: 400, type: 'invalid_request_error' });
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    ...corsHeaders(),
  });
  res.end(html);
}

function sendRedirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...corsHeaders() });
  res.end();
}

const CALLBACK_MAX_BYTES = 16 * 1024;

function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        reject(new GatewayError('Payload too large', { status: 413, type: 'payload_too_large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!settled) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (error) => {
      if (!settled) reject(error);
    });
  });
}

function callbackCors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', allowedCallbackOrigin(origin));
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
}

function callbackJson(res, origin, status, payload) {
  callbackCors(res, origin);
  res.writeHead(status);
  res.end(JSON.stringify(payload));
}

/**
 * Mirrors the CLI's auth callback server:
 *   OPTIONS /callback  -> CORS + Private Network Access preflight (Chrome blocks public->localhost otherwise)
 *   POST    /callback  -> JSON body (fetch) or urlencoded body (form navigation); credentials land here
 *   GET     /callback  -> 405, this page is only reached automatically
 *   GET     /callback/complete -> landing page after a successful form-mode login
 */
async function handleCallback(req, res, config, url) {
  const origin = req.headers.origin;

  if (req.method === 'OPTIONS') {
    callbackCors(res, origin);
    if (req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/callback/complete') {
    const landing = takeLanding(url.searchParams.get('state'));
    sendHtml(
      res,
      200,
      callbackPage({
        ok: true,
        title: '登录成功',
        message: landing?.userName
          ? `已登录为 ${escapeHtml(landing.userName)}，凭据已保存到本网关。可以关闭此页面。`
          : '授权已完成，凭据已保存到本网关。可以关闭此页面。',
      }),
    );
    return;
  }

  if (url.pathname !== '/callback') {
    callbackJson(res, origin, 404, { success: false, error: 'Not found' });
    return;
  }

  if (req.method === 'GET') {
    sendHtml(
      res,
      405,
      callbackPage({
        ok: false,
        title: '请在面板中登录',
        message: '此地址只在登录过程中被自动回调。请回到控制面板重新发起登录。',
      }),
    );
    return;
  }

  if (req.method !== 'POST') {
    callbackJson(res, origin, 405, { success: false, error: 'Method not allowed. Use POST.' });
    return;
  }

  const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json' && contentType !== 'application/x-www-form-urlencoded') {
    callbackJson(res, origin, 415, { success: false, error: 'Unsupported content type' });
    return;
  }

  const raw = await readRawBody(req, CALLBACK_MAX_BYTES);
  let params;
  if (contentType === 'application/x-www-form-urlencoded') {
    params = new URLSearchParams(raw);
  } else {
    try {
      params = JSON.parse(raw);
    } catch {
      callbackJson(res, origin, 400, { success: false, error: 'Invalid JSON' });
      return;
    }
  }

  const result = completeBrowserLogin(config, params);
  if (!result.ok) {
    callbackJson(res, origin, result.error.status ?? 400, { success: false, error: result.error.message });
    return;
  }

  logRequest(config, '/callback', `browser login ok (${escapeHtml(result.credentials.userName || 'unknown')})`);
  invalidatePlanContext();
  recordFingerprint(config).catch(() => {});
  getPlanContexts(config, { force: true })
    .then(() => {
      pushStatus(config);
      pushQuota(config);
    })
    .catch(() => {});

  if (contentType === 'application/x-www-form-urlencoded') {
    res.writeHead(303, {
      Location: `/callback/complete?state=${encodeURIComponent(result.state)}`,
      'Access-Control-Allow-Origin': allowedCallbackOrigin(origin),
      'Cache-Control': 'no-store',
      'Content-Length': '0',
    });
    res.end();
    return;
  }

  callbackJson(res, origin, 200, { success: true });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new GatewayError('Request body too large', { status: 413, type: 'payload_too_large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        reject(new GatewayError('Request body is empty', { status: 400, type: 'invalid_request_error' }));
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new GatewayError(`Invalid JSON body: ${error.message}`, { status: 400, type: 'invalid_request_error' }));
      }
    });
    req.on('error', reject);
  });
}

function sseHeaders() {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...corsHeaders(),
  };
}

function writeData(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeEvent(res, event) {
  res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
}

function writeStreamError(res, error) {
  const payload = {
    error: { message: error?.message ?? 'upstream error', type: error?.type ?? 'upstream_error', code: null },
  };
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function buildEnvelope(translated, config) {
  const threadId = typeof translated.threadId === 'string' && UUID_RE.test(translated.threadId) ? translated.threadId : undefined;
  return {
    config: buildServerConfig(config.cwd),
    memory: null,
    taste: null,
    skills: null,
    permissionMode: wirePermissionMode(config.permissionMode),
    mode: config.mode,
    ...(threadId ? { threadId } : {}),
    params: { ...translated.params, stream: true },
  };
}

/** Constant-time compare so the access key cannot be guessed byte-by-byte over the LAN. */
function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function authorize(req, config) {
  const fromLoopback = isLoopbackAddress(req.socket?.remoteAddress);
  // loopback is trusted unless the operator pinned an explicit key; anything arriving
  // over the network must always present it
  if (fromLoopback && !config.accessKeyExplicit) return;

  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
  const provided = (bearer ?? req.headers['x-api-key'] ?? '').trim();
  if (!config.accessKey || !safeEqual(provided, config.accessKey)) {
    throw new GatewayError('Invalid gateway access key', { status: 401, type: 'invalid_api_key' });
  }
}

function logRequest(config, route, detail) {
  if (!config.verbose) return;
  process.stdout.write(`[${new Date().toISOString()}] ${route} ${detail}\n`);
}

function trackRequest({ model, protocol, stream, startedAt, firstEventAt, usage, reasoningChars = 0, error, account }) {
  const entry = recordRequest({
    t: startedAt,
    model,
    accountId: account?.id ?? null,
    accountName: account?.userName || account?.id || null,
    protocol,
    stream,
    ok: !error,
    ttftMs: stream && firstEventAt ? firstEventAt - startedAt : null,
    durationMs: Date.now() - startedAt,
    promptTokens: usage?.inputTokens ?? 0,
    cachedTokens: usage?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
    completionTokens: usage?.outputTokens ?? 0,
    reasoningTokens: usage?.reasoningTokens ?? 0,
    textTokens: usage?.textTokens ?? 0,
    reasoningChars,
    ...(error ? { error: error?.message ?? String(error) } : {}),
  });
  // the live feed is per-connection: a client scoped to one account must not see the others
  publishPer('request', (client) =>
    client.account && client.account !== 'all' && client.account !== entry.accountId ? null : entry,
  );
  scheduleStatsPublish();
}

async function handleOpenAI(req, res, config) {
  const body = await readJsonBody(req);
  if (!body.model) throw new GatewayError('Missing required field: model', { status: 400, type: 'invalid_request_error' });
  requireMessages(body);

  const translated = translateChatRequest(body, config);
  logRequest(config, '/v1/chat/completions', `${translated.model} stream=${translated.stream} messages=${translated.params.messages.length} tools=${translated.params.tools.length}`);
  for (const warning of translated.warnings) logRequest(config, '/v1/chat/completions', `warn: ${warning}`);

  const reply = new OpenAIReply({ model: translated.model, includeUsage: translated.includeUsage });
  const controller = new AbortController();
  const onClose = () => controller.abort();
  req.on('close', onClose);

  const startedAt = Date.now();
  let firstEventAt = null;
  let recorded = false;
  let served = null;
  const finishStats = (error) => {
    if (recorded) return;
    recorded = true;
    trackRequest({
      model: translated.model,
      protocol: 'openai',
      stream: translated.stream,
      startedAt,
      firstEventAt,
      usage: reply.usage,
      error,
      account: served,
    });
  };

  try {
    const opened = await config.backend.openStream(buildEnvelope(translated, config), { signal: controller.signal });
    served = opened.account;
    const events = config.backend.parseEvents(opened.stream);

    if (!translated.stream) {
      for await (const event of events) {
        if (firstEventAt === null) firstEventAt = Date.now();
        reply.handle(event);
      }
      sendJson(res, 200, reply.completion());
      return;
    }

    res.writeHead(200, sseHeaders());
    const role = reply.roleChunk();
    if (role) writeData(res, role);
    for await (const event of events) {
      if (firstEventAt === null) firstEventAt = Date.now();
      for (const chunk of reply.handle(event)) writeData(res, chunk);
    }
    for (const chunk of reply.finalChunks()) writeData(res, chunk);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    finishStats(error);
    if (res.headersSent) {
      writeStreamError(res, error);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    throw error;
  } finally {
    req.off('close', onClose);
    finishStats();
  }
}

async function handleAnthropic(req, res, config) {
  const body = await readJsonBody(req);
  if (!body.model) throw new GatewayError('Missing required field: model', { status: 400, type: 'invalid_request_error' });
  requireMessages(body);

  const translated = translateMessagesRequest(body, config);
  logRequest(config, '/v1/messages', `${translated.model} stream=${translated.stream} messages=${translated.params.messages.length} tools=${translated.params.tools.length}`);
  for (const warning of translated.warnings) logRequest(config, '/v1/messages', `warn: ${warning}`);

  const reply = new AnthropicReply({ model: translated.model, messageId: translated.messageId });
  const controller = new AbortController();
  const onClose = () => controller.abort();
  req.on('close', onClose);

  const startedAt = Date.now();
  let firstEventAt = null;
  let recorded = false;
  let served = null;
  const finishStats = (error) => {
    if (recorded) return;
    recorded = true;
    trackRequest({
      model: translated.model,
      protocol: 'anthropic',
      stream: translated.stream,
      startedAt,
      firstEventAt,
      usage: reply.usage,
      reasoningChars: reply.reasoningChars(),
      error,
      account: served,
    });
  };

  try {
    const opened = await config.backend.openStream(buildEnvelope(translated, config), { signal: controller.signal });
    served = opened.account;
    const events = config.backend.parseEvents(opened.stream);

    if (!translated.stream) {
      for await (const event of events) {
        if (firstEventAt === null) firstEventAt = Date.now();
        reply.handle(event);
      }
      sendJson(res, 200, reply.message());
      return;
    }

    res.writeHead(200, sseHeaders());
    for (const event of reply.startEvents()) writeEvent(res, event);
    for await (const event of events) {
      if (firstEventAt === null) firstEventAt = Date.now();
      for (const out of reply.handle(event)) writeEvent(res, out);
    }
    for (const event of reply.endEvents()) writeEvent(res, event);
    res.end();
  } catch (error) {
    finishStats(error);
    if (res.headersSent) {
      writeEvent(res, { event: 'error', data: { type: 'error', error: { type: error?.type ?? 'api_error', message: error?.message ?? 'upstream error' } } });
      res.end();
      return;
    }
    throw error;
  } finally {
    req.off('close', onClose);
    finishStats();
  }
}

function isAnthropicRequest(req, url) {
  if (url.searchParams.get('format') === 'anthropic') return true;
  if (url.searchParams.get('format') === 'openai') return false;
  return Boolean(req.headers['anthropic-version'] || req.headers['anthropic-beta']);
}

async function modelView(config) {
  const contexts = await getPlanContexts(config);
  return buildModelView(contexts);
}

async function statusPayload(config) {
  const view = await modelView(config);
  return {
    ...toPublicConfig(config),
    auth: authStatus(config),
    accounts: accountSummary(config),
    models: { total: view.all.length, accessible: view.accessible.length, filterApplied: view.filterApplied },
    plan: { planId: view.planId, planName: view.planName, error: view.planError },
    fingerprint: fingerprintStatus(),
  };
}

async function quotaPayload(config, scope = null, { force = false } = {}) {
  const target = scope ?? config.dashboard ?? 'all';
  // only pay for the accounts the caller actually asked about
  let contexts;
  if (target === 'all' && config.accounts.length > 1) {
    contexts = await getPlanContexts(config, { force });
  } else {
    const single = await getPlanContext(config, { force, accountId: target === 'all' ? null : target });
    contexts = single ? [single] : [];
  }
  return {
    quota: quotaSnapshotForScope(contexts, target, config),
    scope: target,
    fetchedAt: Date.now(),
    accounts: accountSummary(config).accounts,
    error: contexts.find((context) => context?.error)?.error ?? null,
  };
}

/** Account rows (status flags) joined with their own quota, for the accounts view. */
async function accountsWithQuota(config, { force = false, accountId = null } = {}) {
  const summary = accountSummary(config);
  if (summary.count === 0) return { ...summary, accounts: [] };
  const quotas = await quotaSummaries(config, { force, accountId });
  const byId = new Map();
  for (const quota of quotas) if (quota?.accountId) byId.set(quota.accountId, quota);
  return { ...summary, accounts: summary.accounts.map((account) => ({ ...account, quota: byId.get(account.id) ?? null })) };
}

function requireMutableAccounts(config) {
  if (isReadonlyStore(config)) {
    throw new GatewayError(
      '当前用 --api-key / 环境变量提供 Key，账号管理已关闭：改动不会落盘也不会生效。去掉该参数、改用面板登录即可使用多账号。',
      { status: 409, type: 'readonly_store' },
    );
  }
}

function dashboardScope(config, requested) {
  if (requested && (requested === 'all' || config.accounts.some((account) => account.id === requested))) return requested;
  return config.dashboard ?? 'all';
}

let statsPublishTimer = null;

function scheduleStatsPublish() {
  if (statsPublishTimer) return;
  statsPublishTimer = setTimeout(() => {
    statsPublishTimer = null;
    publishPer('stats', (client) => statsSnapshot({ hours: client.hours, accountId: client.account ?? 'all' }));
  }, 600);
  statsPublishTimer.unref?.();
}

async function pushStatus(config) {
  try {
    publish('status', await statusPayload(config));
  } catch {
    /* push is best-effort */
  }
}

async function pushQuota(config) {
  try {
    // build one payload per scope in use, so a client watching a single account is not
    // overwritten by the dashboard-wide aggregate
    const scopes = new Set(['all', config.dashboard ?? 'all']);
    for (const client of listClients()) scopes.add(client.account ?? 'all');
    const payloads = new Map();
    for (const scope of scopes) payloads.set(scope, await quotaPayload(config, scope));
    const fallback = payloads.get(config.dashboard ?? 'all') ?? payloads.get('all') ?? null;
    publishPer('quota', (client) => payloads.get(client.account ?? 'all') ?? fallback);
  } catch {
    /* push is best-effort */
  }
}

export function createServer(config) {
  const catalog = loadCatalog();
  config.backend = createBackend(config);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const route = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'OPTIONS' && route !== '/callback') {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    try {
      if (route === '/') {
        sendRedirect(res, '/panel');
        return;
      }

      if (route === '/callback' || route === '/callback/complete') {
        await handleCallback(req, res, config, url);
        return;
      }

      if (req.method === 'GET' && route === '/panel') {
        sendHtml(res, 200, panelHtml());
        return;
      }

      if (req.method === 'GET' && route === '/health') {
        if (!isLoopbackAddress(req.socket?.remoteAddress)) {
          // don't hand the LAN a map of this machine
          sendJson(res, 200, { status: 'ok', gateway: 'cmdc-gateway', port: config.port, authRequired: true });
          return;
        }
        sendJson(res, 200, { status: 'ok', gateway: 'cmdc-gateway', ...toPublicConfig(config), modelCount: catalog.models.length });
        return;
      }

      authorize(req, config);

      if (req.method === 'GET' && route === '/api/status') {
        sendJson(res, 200, await statusPayload(config));
        return;
      }

      if (req.method === 'GET' && route === '/api/events') {
        const hours = Math.min(168, Math.max(1, Number(url.searchParams.get('hours')) || 24));
        const account = dashboardScope(config, url.searchParams.get('account'));
        logRequest(config, '/api/events', `sse client connected (${hours}h, account=${account})`);
        subscribe(req, res, { hours, account });
        return;
      }

      if (req.method === 'GET' && route === '/api/models') {
        const view = await modelView(config);
        const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'accessible';
        sendJson(res, 200, {
          models: scope === 'all' ? view.all : view.accessible,
          scope,
          total: view.all.length,
          accessible: view.accessible.length,
          filterApplied: view.filterApplied,
          planId: view.planId,
          planName: view.planName,
          planError: view.planError,
        });
        return;
      }

      if (req.method === 'GET' && route === '/api/quota') {
        sendJson(res, 200, await quotaPayload(config, dashboardScope(config, url.searchParams.get('account'))));
        return;
      }

      if (req.method === 'GET' && route === '/api/accounts/quota') {
        const requested = url.searchParams.get('account');
        const scope = requested ? dashboardScope(config, requested) : null;
        const payload = await accountsWithQuota(config, {
          force: url.searchParams.get('refresh') === '1',
          accountId: scope && scope !== 'all' ? scope : null,
        });
        sendJson(res, 200, { scope: scope ?? 'all', fetchedAt: Date.now(), ...payload });
        return;
      }

      if (req.method === 'GET' && route === '/api/stats') {
        const hours = Math.min(168, Math.max(1, Number(url.searchParams.get('hours')) || 24));
        const account = dashboardScope(config, url.searchParams.get('account'));
        sendJson(res, 200, { stats: statsSnapshot({ hours, accountId: account }) });
        return;
      }

      if (req.method === 'GET' && route === '/api/accounts') {
        sendJson(res, 200, accountSummary(config));
        return;
      }

      if (req.method === 'POST' && route === '/api/accounts/active') {
        requireMutableAccounts(config);
        const body = await readJsonBody(req);
        const result = setActiveAccount(config, body.id);
        if (!result.ok) throw new GatewayError(`未知账号：${body.id}`, { status: 404, type: 'not_found_error' });
        logRequest(config, '/api/accounts/active', String(body.id));
        invalidatePlanContext();
        pushStatus(config);
        pushQuota(config);
        sendJson(res, 200, {
          ok: true,
          accounts: accountSummary(config),
          ...(result.invalid
            ? { warning: '已设为当前账号，但它的 Key 已失效：请求会由其它可用账号实际服务，先点「重新校验」才能真正用它。' }
            : {}),
        });
        return;
      }

      if (req.method === 'POST' && route === '/api/accounts/mode') {
        requireMutableAccounts(config);
        const body = await readJsonBody(req);
        const result = setRotationMode(config, body.mode);
        if (!result.ok) throw new GatewayError(`未知轮换模式：${body.mode}`, { status: 400, type: 'invalid_request_error' });
        logRequest(config, '/api/accounts/mode', String(body.mode));
        pushStatus(config);
        sendJson(res, 200, { ok: true, accounts: accountSummary(config) });
        return;
      }

      if (req.method === 'POST' && route === '/api/accounts/scope') {
        requireMutableAccounts(config);
        const body = await readJsonBody(req);
        const result = setDashboardScope(config, body.scope ?? 'all');
        if (!result.ok) throw new GatewayError(`未知统计范围：${body.scope}`, { status: 400, type: 'invalid_request_error' });
        logRequest(config, '/api/accounts/scope', String(body.scope));
        pushQuota(config);
        sendJson(res, 200, { ok: true, accounts: accountSummary(config) });
        return;
      }

      const accountActionMatch = /^\/api\/accounts\/([^/]+)\/(verify|reset)$/.exec(route);
      if (req.method === 'POST' && accountActionMatch) {
        const id = decodeURIComponent(accountActionMatch[1]);
        const action = accountActionMatch[2];
        const account = config.accounts.find((entry) => entry.id === id);
        if (!account) throw new GatewayError(`未知账号：${id}`, { status: 404, type: 'not_found_error' });

        if (action === 'reset') {
          clearCooldown(config, id);
          clearInvalid(config, id);
          logRequest(config, '/api/accounts/reset', id);
          invalidatePlanContext(id);
          pushStatus(config);
          pushQuota(config);
          sendJson(res, 200, { ok: true, action, accounts: accountSummary(config) });
          return;
        }

        const identity = await fetchIdentity(config, account.apiKey);
        if (!identity.valid) {
          const message = KEY_ERRORS[identity.error] ?? 'Key 校验失败';
          markInvalid(config, id, { reason: message, status: identity.status ?? null });
          logRequest(config, '/api/accounts/verify', `${id} -> invalid`);
          invalidatePlanContext(id);
          pushStatus(config);
          pushQuota(config);
          sendJson(res, 200, { ok: false, valid: false, error: message, accounts: accountSummary(config) });
          return;
        }

        clearInvalid(config, id);
        if (!isReadonlyStore(config)) {
          const user = identity.whoami?.user ?? {};
          upsertAccount(config, {
            apiKey: account.apiKey,
            userId: user.id ?? account.userId,
            userName: user.userName || user.name || account.userName,
            keyName: account.keyName,
            authenticatedAt: account.authenticatedAt,
          });
        }
        invalidatePlanContext(id);
        const context = await getPlanContext(config, { force: true, accountId: id });
        logRequest(config, '/api/accounts/verify', `${id} -> ok`);
        pushStatus(config);
        pushQuota(config);
        sendJson(res, 200, {
          ok: true,
          valid: true,
          action,
          accounts: accountSummary(config),
          quota: quotaSnapshot(context),
        });
        return;
      }

      const accountMatch = /^\/api\/accounts\/([^/]+)$/.exec(route);
      if (req.method === 'DELETE' && accountMatch) {
        requireMutableAccounts(config);
        const id = decodeURIComponent(accountMatch[1]);
        const result = removeAccount(config, id);
        if (!result.removed) throw new GatewayError(`未知账号：${id}`, { status: 404, type: 'not_found_error' });
        logRequest(config, '/api/accounts', `removed ${id}`);
        invalidatePlanContext();
        pushStatus(config);
        pushQuota(config);
        sendJson(res, 200, { ok: true, accounts: accountSummary(config) });
        return;
      }

      if (req.method === 'POST' && route === '/api/plan/refresh') {
        invalidatePlanContext();
        const contexts = await getPlanContexts(config, { force: true });
        const view = buildModelView(contexts);
        logRequest(config, '/api/plan/refresh', `accounts=${contexts.length} accessible=${view.accessible.length}/${view.all.length}`);
        pushStatus(config);
        pushQuota(config);
        sendJson(res, 200, {
          ok: true,
          quota: quotaSnapshotForScope(contexts, config.dashboard ?? 'all', config),
          planId: view.planId,
          planName: view.planName,
          accessible: view.accessible.length,
          total: view.all.length,
          error: view.planError,
        });
        return;
      }

      if (req.method === 'POST' && route === '/api/auth/apikey') {
        requireMutableAccounts(config);
        const body = await readJsonBody(req);
        const result = await loginWithApiKey(config, body.apiKey);
        logRequest(config, '/api/auth/apikey', `${result.created ? 'added' : 'updated'} account ${result.credentials.userName}`);
        invalidatePlanContext();
        recordFingerprint(config).catch(() => {});
        getPlanContexts(config, { force: true }).then(() => {
          pushStatus(config);
          pushQuota(config);
        }).catch(() => {});
        sendJson(res, 200, {
          ok: true,
          created: result.created,
          userName: result.credentials.userName,
          userId: result.credentials.userId,
          accounts: accountSummary(config),
          file: result.file,
        });
        return;
      }

      if (req.method === 'POST' && route === '/api/auth/browser/start') {
        const result = startBrowserLogin(config);
        logRequest(config, '/api/auth/browser/start', result.callback);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && route === '/api/auth/logout') {
        requireMutableAccounts(config);
        const result = logout(config);
        logRequest(config, '/api/auth/logout', result.file);
        invalidatePlanContext();
        pushStatus(config);
        pushQuota(config);
        sendJson(res, 200, { ok: true, file: result.file });
        return;
      }

      if (req.method === 'GET' && route === '/v1/models') {
        const view = await modelView(config);
        sendJson(res, 200, isAnthropicRequest(req, url) ? anthropicModelList(view.accessible) : openAIModelList(view.accessible));
        return;
      }

      const modelMatch = /^\/v1\/models\/(.+)$/.exec(route);
      if (req.method === 'GET' && modelMatch) {
        const id = decodeURIComponent(modelMatch[1]);
        if (!findModel(id)) throw new GatewayError(`Model not found: ${id}`, { status: 404, type: 'not_found_error' });
        sendJson(res, 200, openAIModel(id));
        return;
      }

      if (req.method === 'POST' && route === '/v1/chat/completions') {
        await handleOpenAI(req, res, config);
        return;
      }

      if (req.method === 'POST' && route === '/v1/messages') {
        await handleAnthropic(req, res, config);
        return;
      }

      throw new GatewayError(`Unknown route: ${req.method} ${route}`, { status: 404, type: 'not_found_error' });
    } catch (error) {
      if (config.verbose) process.stderr.write(`[error] ${error?.stack ?? error}\n`);
      sendError(res, error, route === '/v1/messages' ? 'anthropic' : 'openai');
    }
  });

  return server;
}

async function portOwner(port) {
  try {
    const { execFile } = await import('node:child_process');
    const output = await new Promise((resolve) => {
      execFile('netstat', ['-ano'], { windowsHide: true, timeout: 4000 }, (error, stdout) => resolve(error ? '' : String(stdout ?? '')));
    });
    const pids = new Set();
    for (const line of output.split(/\r?\n/)) {
      if (!line.includes('LISTENING') || !line.includes(`:${port} `)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (/^\d+$/.test(pid)) pids.add(pid);
    }
    return [...pids];
  } catch {
    return [];
  }
}

function main() {
  let config;
  try {
    config = loadConfig();
    loadAccounts(config);
  } catch (error) {
    process.stderr.write(`Configuration error: ${error.message}\n`);
    process.exit(1);
  }

  const server = createServer(config);
  useStatsEnvironment(config.apiEnv);
  const catalog = loadCatalog();
  const accounts = accountSummary(config);

  server.listen(config.port, config.host, () => {
    const info = toPublicConfig(config);
    const active = accounts.accounts.find((account) => account.active);
    const lanLines = info.lanUrls.length
      ? info.lanUrls.map((url) => `  lan url    : ${url}/v1`)
      : ['  lan url    : (未开放，仅本机可用)'];
    process.stdout.write(
      [
        'cmdc-gateway is running',
        `  panel      : http://127.0.0.1:${config.port}/panel`,
        `  base url   : http://127.0.0.1:${config.port}/v1  (本机客户端用这个)`,
        ...lanLines,
        `  port       : ${config.port}${info.portPinned ? ` 固定端口 (来自 ${config.configFile})` : ` 临时端口，固定端口是 ${config.fixedPort}`}`,
        `  access key : ${config.accessKey}${info.accessKeyExplicit ? '  (通过 --client-key 指定)' : '  (默认，可改)'}`,
        `  鉴权规则   : 本机 127.0.0.1 免鉴权；其它地址必须带 x-api-key 或 Authorization: Bearer`,
        `  backend    : ${info.baseUrl} (${info.apiEnv})`,
        `  accounts   : ${accounts.count}${accounts.count ? ` (${active ? `${active.userName} 当前` : '未选中'})` : ' - NO ACCOUNT'}${accounts.invalidCount ? ` · ${accounts.invalidCount} 个失效` : ''}${accounts.coolingCount ? ` · ${accounts.coolingCount} 个冷却中` : ''}`,
        `  rotation   : ${accounts.count > 1 ? `${accounts.mode} · 统计范围 ${accounts.dashboard}` : 'n/a (single account)'}`,
        `  cred store : ${info.storeFile}`,
        `  fingerprint: ${info.fingerprint ? 'on' : 'off'}`,
        `  models     : ${catalog.models.length}${catalog.cliVersion ? ` (cmdc ${catalog.cliVersion})` : ''}`,
        `  mode       : ${info.mode} / permission ${info.permissionMode}`,
        `  cwd        : ${info.cwd}`,
        '',
        'Endpoints:',
        '  GET  /panel                 web panel (accounts, models, quota, stats, playground)',
        '  GET  /health',
        '  GET  /v1/models',
        '  POST /v1/chat/completions   (OpenAI)',
        '  POST /v1/messages           (Anthropic)',
        '',
      ].join('\n'),
    );
  });

  server.on('error', async (error) => {
    if (error?.code === 'EADDRINUSE') {
      const pids = await portOwner(config.port);
      const fix = pids.length ? 2 : 1;
      process.stderr.write(
        [
          `端口 ${config.port} 已被占用。这是固定端口，网关不会自动换成别的端口，`,
          `以免你以为服务在跑、实际地址已经变了，客户端 base_url 对不上。`,
          pids.length ? `占用进程：${pids.map((pid) => `PID ${pid}`).join('、')}` : '未能识别占用进程。',
          '',
          '可选处理方式：',
          ...(pids.length ? [`  1) 结束占用进程：taskkill /PID ${pids[0]} /T /F`] : []),
          `  ${fix}) 本次换端口启动，不改固定端口：node src/server.mjs --port ${config.port + 1}`,
          `  ${fix + 1}) 永久改用别的端口：node src/server.mjs --port 9000 --save-port`,
          `  ${fix + 2}) 用 start-gateway.bat，菜单里选 [3] 关闭服务 或 [4] 启动服务`,
          '',
          `固定端口记录在 ${config.configFile}（"port" 字段），改完记得同步更新客户端 base_url。`,
          '',
        ].join('\n'),
      );
      process.exit(1);
    }
    process.stderr.write(`Server error: ${error.message}\n`);
    process.exit(1);
  });

  recordFingerprint(config).catch(() => {});
  getPlanContexts(config).catch(() => {});

  const shutdown = () => {
    process.stdout.write('\nShutting down...\n');
    flushPendingWrites();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
