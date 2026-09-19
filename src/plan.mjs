import { loadCatalog } from './models.mjs';

const DEFAULT_ALLOWED = { allowed: true, minimumPlanId: null, minimumPlanName: null };
/** Failures are re-tried much sooner than successes so the panel can recover quickly. */
const FAILED_TTL_MS = 10_000;

export function getAccessData() {
  return loadCatalog().access ?? null;
}

function numberOr(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Pay-as-you-go and gifted credits unlock every model. They live on `context.credits`
 * (the parsed /alpha/billing/credits payload), with a top-level fallback for older shapes.
 */
export function creditAmounts(context) {
  const nested = context?.credits ?? {};
  const pick = (a, b) => {
    if (typeof a === 'number' && Number.isFinite(a)) return a;
    if (typeof b === 'number' && Number.isFinite(b)) return b;
    return 0;
  };
  return {
    purchased: pick(nested.purchasedCredits, context?.purchasedCredits),
    free: pick(nested.freeCredits, context?.freeCredits),
  };
}

export function evaluateModelAccess(modelId, planContext) {
  const access = getAccessData();
  if (!access) return DEFAULT_ALLOWED;

  const { purchased, free } = creditAmounts(planContext);
  if (purchased > 0 || free > 0) return DEFAULT_ALLOWED;

  const planId = planContext?.planId ?? null;
  if (!planId) return DEFAULT_ALLOWED;
  const rules = access.planRules[planId];
  if (!rules) return DEFAULT_ALLOWED;

  const entry = access.modelAccess[modelId];
  if (!entry) return DEFAULT_ALLOWED;

  const fullModelId = `${entry.provider}:${modelId}`;
  const categoryAllowed = rules.allowedCategories.includes(entry.category);
  const blocked = rules.blockedModels.includes(fullModelId);
  if (categoryAllowed && !blocked) return DEFAULT_ALLOWED;

  const minimumPlanId =
    access.planOrder.find((candidate) => {
      const candidateRules = access.planRules[candidate];
      if (!candidateRules) return false;
      return candidateRules.allowedCategories.includes(entry.category) && !candidateRules.blockedModels.includes(fullModelId);
    }) ?? null;

  return {
    allowed: false,
    minimumPlanId,
    minimumPlanName: minimumPlanId ? access.planNames[minimumPlanId] ?? minimumPlanId : 'Ultra',
  };
}

function usageUrl(base, { orgId, since }) {
  const params = new URLSearchParams();
  if (orgId) params.set('orgId', orgId);
  if (since) params.set('since', since);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

async function getJson(config, route, apiKey) {
  const response = await fetch(`${config.baseUrl}${route}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    const error = new Error(`GET ${route} -> ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

/**
 * Billing endpoints are queried independently: one failing route must not turn the whole
 * context into "all zeros with no explanation".
 */
async function tryJson(config, route, apiKey) {
  try {
    return { ok: true, value: await getJson(config, route, apiKey) };
  } catch (error) {
    return { ok: false, error };
  }
}

async function loadPlanContext(config, account) {
  const apiKey = account.apiKey;
  const whoamiResult = await tryJson(config, '/alpha/whoami?limits=1', apiKey);
  const whoami = whoamiResult.value ?? null;
  const orgId = whoami?.org?.id ?? null;

  const [subscriptionsResult, creditsResult] = await Promise.all([
    tryJson(config, usageUrl('/alpha/billing/subscriptions', { orgId }), apiKey),
    tryJson(config, usageUrl('/alpha/billing/credits', { orgId }), apiKey),
  ]);

  const subscription = subscriptionsResult.value?.data ?? null;
  const credits = creditsResult.value?.credits ?? null;
  const planId = subscription?.planId ?? credits?.planId ?? null;
  const since = subscription?.currentPeriodStart ?? null;
  const usageResult = await tryJson(config, usageUrl('/alpha/usage/summary', { orgId, since }), apiKey);

  const results = [
    { route: '/alpha/whoami', result: whoamiResult },
    { route: '/alpha/billing/subscriptions', result: subscriptionsResult },
    { route: '/alpha/billing/credits', result: creditsResult },
    { route: '/alpha/usage/summary', result: usageResult },
  ];
  const failures = results.filter((entry) => !entry.result.ok);
  const authFailure = failures.find((entry) => entry.result.error?.status === 401 || entry.result.error?.status === 403) ?? null;
  const primary = authFailure ?? failures[0] ?? null;

  return {
    accountId: account.id,
    accountName: account.userName || account.id,
    fetchedAt: Date.now(),
    orgId,
    planId,
    planName: planId ? getAccessData()?.planNames?.[planId] ?? planId : null,
    subscription,
    credits,
    windowLimits: creditsResult.value?.windowLimits ?? null,
    usage: usageResult.value ?? null,
    limits: whoami?.limits ?? null,
    whoami,
    error: primary ? (primary.result.error?.message ?? String(primary.result.error)) : null,
    errorStatus: primary?.result.error?.status ?? null,
    errorRoute: primary?.route ?? null,
    authError: Boolean(authFailure),
    partial: failures.length > 0 && failures.length < results.length,
    failedRoutes: failures.map((entry) => entry.route),
  };
}

const cache = new Map();
const inflight = new Map();

function contextKey(account) {
  return account.id;
}

function ttlFor(context, config) {
  return context?.error ? Math.min(config.planTtlMs, FAILED_TTL_MS) : config.planTtlMs;
}

/** Last known context for an account, ignoring the TTL. Used for cheap resetAt lookups. */
export function peekPlanContext(accountId) {
  return cache.get(accountId) ?? null;
}

export async function getPlanContext(config, { force = false, accountId = null } = {}) {
  const id = accountId ?? config.activeId;
  const account = config.accounts.find((entry) => entry.id === id) ?? config.accounts[0];
  if (!account) return null;

  const key = contextKey(account);
  const cached = cache.get(key);
  if (!force && cached && Date.now() - cached.fetchedAt < ttlFor(cached, config)) return cached;
  if (inflight.has(key)) return inflight.get(key);

  const promise = loadPlanContext(config, account)
    .then((context) => {
      cache.set(key, context);
      return context;
    })
    .catch((error) => {
      const failed = {
        accountId: account.id,
        accountName: account.userName || account.id,
        fetchedAt: Date.now(),
        error: error?.message ?? String(error),
        errorStatus: error?.status ?? null,
        planId: cached?.planId ?? null,
        planName: cached?.planName ?? null,
        credits: cached?.credits ?? null,
        windowLimits: cached?.windowLimits ?? null,
        usage: cached?.usage ?? null,
        subscription: cached?.subscription ?? null,
        stale: Boolean(cached),
      };
      cache.set(key, failed);
      return failed;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

export function invalidatePlanContext(accountId = null) {
  if (accountId) cache.delete(accountId);
  else cache.clear();
}

/** Fetches every account's context once, sharing the in-flight work. */
export async function getPlanContexts(config, { force = false } = {}) {
  if (config.accounts.length === 0) return [];
  const contexts = await Promise.all(config.accounts.map((account) => getPlanContext(config, { force, accountId: account.id })));
  return contexts.filter(Boolean);
}

/** Per-account quota rows for the accounts view, in account order. */
export async function quotaSummaries(config, { force = false, accountId = null } = {}) {
  const targets = accountId ? config.accounts.filter((entry) => entry.id === accountId) : config.accounts;
  // Promise.all preserves order, so each context lines up with the account that produced it
  const contexts = await Promise.all(targets.map((entry) => getPlanContext(config, { force, accountId: entry.id })));
  return contexts.map((context) => quotaSnapshot(context));
}

export function buildModelView(contexts) {
  const catalog = loadCatalog();
  const access = catalog.access ?? null;
  const list = (Array.isArray(contexts) ? contexts.filter(Boolean) : contexts ? [contexts] : []).filter(
    (context) => !context.error,
  );
  const anyPurchased = list.some((context) => {
    const credits = creditAmounts(context);
    return credits.purchased > 0 || credits.free > 0;
  });
  const hasPlan = anyPurchased || list.some((context) => Boolean(context.planId));

  const models = catalog.models.map((model) => {
    if (!access) return { ...model, accessible: true, minimumPlanName: null, accounts: [] };

    const results = list.map((context) => ({
      accountId: context.accountId,
      accountName: context.accountName,
      ...evaluateModelAccess(model.id, context),
    }));
    const allowedBy = results.filter((result) => result.allowed).map((result) => result.accountId);
    const blocked = results.find((result) => !result.allowed);
    return {
      ...model,
      accessible: allowedBy.length > 0,
      allowedBy,
      minimumPlanName: allowedBy.length === 0 ? blocked?.minimumPlanName ?? null : null,
    };
  });

  const filterApplied = Boolean(access) && hasPlan;
  return {
    filterApplied,
    all: models,
    accessible: filterApplied ? models.filter((model) => model.accessible) : models,
    planId: list[0]?.planId ?? null,
    planName: list.length > 1 ? `${list.length} 个账号` : list[0]?.planName ?? null,
    planError: list.length === 0 ? contexts?.error ?? null : null,
  };
}

function round(value) {
  return typeof value === 'number' ? Math.round(value * 1e6) / 1e6 : null;
}

function windowOf(entry) {
  if (!entry) return null;
  return {
    used: round(entry.used) ?? 0,
    cap: round(entry.cap) ?? 0,
    exceeded: Boolean(entry.exceeded),
    resetAt: entry.resetAt ?? null,
  };
}

export function quotaSnapshot(planContext) {
  if (!planContext) return null;
  const credits = planContext.credits ?? {};
  const windows = planContext.windowLimits ?? {};
  const usage = planContext.usage ?? {};

  return {
    accountId: planContext.accountId ?? null,
    accountName: planContext.accountName ?? null,
    fetchedAt: planContext.fetchedAt,
    stale: Boolean(planContext.stale),
    error: planContext.error ?? null,
    errorStatus: planContext.errorStatus ?? null,
    errorRoute: planContext.errorRoute ?? null,
    authError: Boolean(planContext.authError),
    partial: Boolean(planContext.partial),
    planId: planContext.planId ?? null,
    planName: planContext.planName ?? null,
    credits: {
      monthly: numberOr(round(credits.monthlyCredits)),
      purchased: numberOr(round(credits.purchasedCredits)),
      free: numberOr(round(credits.freeCredits)),
      threshold: numberOr(round(credits.creditThreshold)),
      belowThreshold: Boolean(credits.belowThreshold),
    },
    windows: {
      limited: Boolean(windows.limited),
      fiveHour: windowOf(windows.fiveHour),
      weekly: windowOf(windows.weekly),
    },
    period: planContext.subscription
      ? {
          start: planContext.subscription.currentPeriodStart ?? null,
          end: planContext.subscription.currentPeriodEnd ?? null,
          status: planContext.subscription.status ?? null,
          cancelAtPeriodEnd: Boolean(planContext.subscription.cancelAtPeriodEnd),
        }
      : null,
    usage: {
      requests: usage.totalCount ?? null,
      completed: usage.completedCount ?? null,
      failed: usage.failedCount ?? null,
      tokensIn: usage.totalTokensIn ?? null,
      tokensOut: usage.totalTokensOut ?? null,
      cost: round(usage.totalCost) ?? null,
      credits: round(usage.totalCredits) ?? null,
      basis: usage.periodBasis ?? null,
    },
  };
}

/**
 * Quota for a scope: one account, or "all" which sums credits and both rate-limit windows
 * across every account. Aggregates carry `partial` when any account failed to report, so
 * a smaller-than-real total is never presented as authoritative.
 */
export function quotaSnapshotForScope(contexts, scope, config) {
  const list = Array.isArray(contexts) ? contexts.filter(Boolean) : [];
  if (list.length === 0) return null;

  if (scope && scope !== 'all') {
    const found = list.find((context) => context.accountId === scope);
    return found ? quotaSnapshot(found) : null;
  }

  if (list.length === 1) return quotaSnapshot(list[0]);

  const parts = list.map(quotaSnapshot).filter(Boolean);
  const failing = parts.filter((part) => part.error);
  const sum = (pick) => parts.reduce((total, part) => total + (pick(part) ?? 0), 0);
  const mergeWindow = (key) => {
    const present = parts.map((part) => part.windows[key]).filter(Boolean);
    if (present.length === 0) return null;
    return {
      used: round(sum((part) => part.windows[key]?.used)),
      cap: round(sum((part) => part.windows[key]?.cap)),
      exceeded: present.some((entry) => entry.exceeded),
      resetAt: present.map((entry) => entry.resetAt).filter(Boolean).sort()[0] ?? null,
    };
  };

  const periodStarts = new Set(parts.map((part) => part.period?.start ?? null));
  const sharedPeriod = periodStarts.size === 1 ? parts[0].period : null;

  return {
    accountId: 'all',
    accountName: `${config?.accounts.length ?? parts.length} 个账号合计`,
    aggregate: true,
    parts: parts.map((part) => ({
      accountId: part.accountId,
      accountName: part.accountName,
      planName: part.planName,
      credits: part.credits,
      windows: part.windows,
      error: part.error,
      errorStatus: part.errorStatus,
      authError: part.authError,
      stale: part.stale,
      fetchedAt: part.fetchedAt,
    })),
    fetchedAt: Math.max(...parts.map((part) => part.fetchedAt ?? 0)),
    stale: parts.some((part) => part.stale),
    partial: failing.length > 0,
    error: failing[0]?.error ?? null,
    errorStatus: failing[0]?.errorStatus ?? null,
    authError: failing.some((part) => part.authError),
    failedAccounts: failing.map((part) => part.accountId),
    planId: null,
    planName: parts.map((part) => part.planName).filter(Boolean).join(' + ') || null,
    credits: {
      monthly: round(sum((part) => part.credits.monthly)),
      purchased: round(sum((part) => part.credits.purchased)),
      free: round(sum((part) => part.credits.free)),
      threshold: round(sum((part) => part.credits.threshold)),
      belowThreshold: parts.some((part) => part.credits.belowThreshold),
    },
    windows: {
      limited: parts.some((part) => part.windows.limited),
      fiveHour: mergeWindow('fiveHour'),
      weekly: mergeWindow('weekly'),
    },
    period: sharedPeriod,
    periodMixed: periodStarts.size > 1,
    usage: {
      requests: sum((part) => part.usage.requests),
      completed: sum((part) => part.usage.completed),
      failed: sum((part) => part.usage.failed),
      tokensIn: sum((part) => part.usage.tokensIn),
      tokensOut: sum((part) => part.usage.tokensOut),
      cost: round(sum((part) => part.usage.cost)),
      credits: round(sum((part) => part.usage.credits)),
      basis: parts[0].usage.basis,
    },
  };
}
