/**
 * Plan / quota logic.
 *
 * The regression this file exists for: `creditAmounts` read the wrong nesting level, so
 * purchased and gifted credits always came back as 0 and those accounts never got the
 * "credits unlock every model" behaviour they were entitled to.
 */
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildModelView,
  creditAmounts,
  evaluateModelAccess,
  getAccessData,
  quotaSnapshot,
  quotaSnapshotForScope,
} from '../src/plan.mjs';

const access = getAccessData();
/** Plan that is restricted to open-source models, used to exercise filtering. */
const LIMITED_PLAN = 'individual-go';

test('models.json still carries a usable plan access table', () => {
  // regression guard: regenerating models.json against a newer CLI bundle silently produced a
  // file with no `access` section at all, which turns plan filtering off without any error
  assert.ok(access, 'models.json must carry the `access` table');
  assert.ok(access.planOrder.length > 0, 'planOrder is empty');
  assert.ok(Object.keys(access.planRules).length > 0, 'planRules is empty');
  assert.ok(Object.keys(access.modelAccess).length > 0, 'modelAccess is empty');
  assert.ok(Object.keys(access.planNames).length > 0, 'planNames is empty');
});

test('every plan in the order has rules and a display name', () => {
  for (const planId of access.planOrder) {
    assert.ok(access.planRules[planId], `${planId} has no rules`);
    assert.ok(access.planNames[planId], `${planId} has no display name`);
    assert.ok(Array.isArray(access.planRules[planId].allowedCategories));
    assert.ok(Array.isArray(access.planRules[planId].blockedModels));
  }
});

test('the fixture stays meaningful: the limited plan really cannot use premium models', () => {
  assert.equal(access.planRules[LIMITED_PLAN].allowedCategories.includes('premium'), false);
  assert.ok(
    Object.values(access.modelAccess).some((entry) => entry.category === 'premium'),
    'expected at least one premium model for the filtering tests',
  );
});

test('creditAmounts reads the nested payload the backend actually returns', () => {
  // this is the shape that used to be missed, making every account look credit-less
  assert.deepEqual(creditAmounts({ credits: { purchasedCredits: 12.5, freeCredits: 3 } }), { purchased: 12.5, free: 3 });
});

test('creditAmounts falls back to the older top-level layout', () => {
  assert.deepEqual(creditAmounts({ purchasedCredits: 7, freeCredits: 1 }), { purchased: 7, free: 1 });
});

test('a nested value wins over a stale top-level one', () => {
  assert.deepEqual(creditAmounts({ credits: { purchasedCredits: 5 }, purchasedCredits: 99 }), { purchased: 5, free: 0 });
});

test('creditAmounts is safe on absent or junk input', () => {
  for (const input of [undefined, null, {}, { credits: null }, { credits: { purchasedCredits: 'lots' } }, { purchasedCredits: NaN }]) {
    assert.deepEqual(creditAmounts(input), { purchased: 0, free: 0 }, `bad input: ${JSON.stringify(input)}`);
  }
});

test('any positive credit balance unlocks every model', () => {
  const premiumModel = Object.entries(access.modelAccess).find(([, entry]) => entry.category === 'premium')[0];
  for (const credits of [{ purchasedCredits: 0.0001 }, { freeCredits: 1 }, { purchasedCredits: 5, freeCredits: 5 }]) {
    assert.equal(
      evaluateModelAccess(premiumModel, { planId: LIMITED_PLAN, credits }).allowed,
      true,
      `credits should unlock ${premiumModel}: ${JSON.stringify(credits)}`,
    );
  }
});

test('access defaults to allowed when the plan cannot be determined', () => {
  const premiumModel = Object.entries(access.modelAccess).find(([, entry]) => entry.category === 'premium')[0];
  const unknownModel = 'model-that-does-not-exist';

  for (const context of [undefined, null, {}, { planId: null }, { planId: 'a-plan-that-does-not-exist' }]) {
    assert.equal(evaluateModelAccess(premiumModel, context).allowed, true, `unresolved plan: ${JSON.stringify(context)}`);
  }
  assert.equal(evaluateModelAccess(unknownModel, { planId: LIMITED_PLAN }).allowed, true, 'unknown models are not filtered');
});

test('a model outside the plan is blocked and points at the cheapest plan that allows it', () => {
  const [premiumModel, entry] = Object.entries(access.modelAccess).find(([, value]) => value.category === 'premium');
  const result = evaluateModelAccess(premiumModel, { planId: LIMITED_PLAN });

  assert.equal(result.allowed, false);
  assert.ok(result.minimumPlanName, 'the panel needs a plan name to show');

  // derive the expectation from the table itself instead of hardcoding plan ids
  const fullModelId = `${entry.provider}:${premiumModel}`;
  const expected = access.planOrder.find((planId) => {
    const rules = access.planRules[planId];
    return rules?.allowedCategories.includes(entry.category) && !rules.blockedModels.includes(fullModelId);
  });
  assert.equal(result.minimumPlanId, expected, 'must be the first plan in the order that allows it');
  assert.equal(result.minimumPlanName, access.planNames[expected]);
});

test('an allowed model in the plan needs no upgrade', () => {
  const allowedModel = Object.keys(access.modelAccess).find((modelId) => {
    const entry = access.modelAccess[modelId];
    const rules = access.planRules[LIMITED_PLAN];
    return rules.allowedCategories.includes(entry.category) && !rules.blockedModels.includes(`${entry.provider}:${modelId}`);
  });
  assert.ok(allowedModel, 'expected at least one model the limited plan can use');

  assert.deepEqual(evaluateModelAccess(allowedModel, { planId: LIMITED_PLAN }), {
    allowed: true,
    minimumPlanId: null,
    minimumPlanName: null,
  });
});

test('an explicitly blocked model is refused even inside an allowed category', () => {
  const blockedFullIds = access.planRules[LIMITED_PLAN].blockedModels;
  assert.ok(blockedFullIds.length > 0, 'fixture expects the limited plan to block something');

  const blockedModel = Object.keys(access.modelAccess).find(
    (modelId) => blockedFullIds.includes(`${access.modelAccess[modelId].provider}:${modelId}`),
  );
  assert.ok(blockedModel, 'the blocked list should reference a real model');

  const result = evaluateModelAccess(blockedModel, { planId: LIMITED_PLAN });
  assert.equal(result.allowed, false, 'a blocked model must not be reachable through its category');
});

/* ------------------------------------------------------------------ quota shapes */

const context = (overrides = {}) => ({
  accountId: 'A',
  accountName: 'Account A',
  fetchedAt: 1_700_000_000_000,
  planId: LIMITED_PLAN,
  planName: 'Go',
  credits: { monthlyCredits: 1.0826111, purchasedCredits: 0, freeCredits: 0, creditThreshold: 0.5, belowThreshold: false },
  windowLimits: {
    limited: true,
    fiveHour: { used: 0.5033031, cap: 3, exceeded: false, resetAt: '2026-01-01T05:00:00.000Z' },
    weekly: { used: 3.9484241, cap: 6, exceeded: false, resetAt: '2026-01-05T00:00:00.000Z' },
  },
  subscription: { currentPeriodStart: '2026-01-01', currentPeriodEnd: '2026-02-01', status: 'active', cancelAtPeriodEnd: false },
  usage: { totalCount: 10, completedCount: 9, failedCount: 1, totalTokensIn: 100, totalTokensOut: 50, totalCost: 0.00123456, totalCredits: 0.01, periodBasis: 'month' },
  ...overrides,
});

test('quotaSnapshot rounds and renames the raw payload for the panel', () => {
  const snapshot = quotaSnapshot(context());

  assert.equal(snapshot.accountId, 'A');
  assert.equal(snapshot.planName, 'Go');
  assert.equal(snapshot.credits.monthly, 1.082611, 'rounded to 6 decimals');
  assert.equal(snapshot.windows.fiveHour.used, 0.503303);
  assert.equal(snapshot.windows.fiveHour.cap, 3);
  assert.equal(snapshot.windows.limited, true);
  assert.equal(snapshot.period.start, '2026-01-01');
  assert.equal(snapshot.usage.requests, 10);
  assert.equal(snapshot.usage.cost, 0.001235, 'cost is rounded too');
  assert.equal(snapshot.error, null);
});

test('quotaSnapshot returns null rather than an empty shell', () => {
  assert.equal(quotaSnapshot(null), null);
  assert.equal(quotaSnapshot(undefined), null);
});

test('quotaSnapshot survives a context with nothing in it', () => {
  const snapshot = quotaSnapshot({ accountId: 'A', fetchedAt: 1 });
  assert.equal(snapshot.credits.monthly, 0);
  assert.equal(snapshot.windows.fiveHour, null);
  assert.equal(snapshot.period, null);
  assert.equal(snapshot.usage.requests, null);
});

test('a single-account scope returns that account\'s own snapshot', () => {
  const snapshot = quotaSnapshotForScope([context()], 'all');
  assert.equal(snapshot.accountId, 'A');
  assert.equal(snapshot.aggregate, undefined, 'one account should not be presented as an aggregate');
});

test('a named scope picks the matching account', () => {
  const contexts = [context({ accountId: 'A' }), context({ accountId: 'B', accountName: 'Account B' })];
  assert.equal(quotaSnapshotForScope(contexts, 'B').accountId, 'B');
  assert.equal(quotaSnapshotForScope(contexts, 'ghost'), null);
});

test('an all-accounts aggregate sums credits, windows and usage', () => {
  const a = context({ accountId: 'A', credits: { monthlyCredits: 1, purchasedCredits: 2, freeCredits: 0, creditThreshold: 0.5, belowThreshold: false } });
  const b = context({
    accountId: 'B',
    credits: { monthlyCredits: 3, purchasedCredits: 0, freeCredits: 1, creditThreshold: 0.5, belowThreshold: false },
    windowLimits: {
      limited: true,
      fiveHour: { used: 1, cap: 3, exceeded: false, resetAt: '2026-01-01T09:00:00.000Z' },
      weekly: { used: 1, cap: 6, exceeded: true, resetAt: '2026-01-06T00:00:00.000Z' },
    },
    usage: { totalCount: 5, completedCount: 5, failedCount: 0, totalTokensIn: 10, totalTokensOut: 20, totalCost: 0.5, totalCredits: 0.02, periodBasis: 'month' },
  });

  const aggregate = quotaSnapshotForScope([a, b], 'all', { accounts: [a, b] });

  assert.equal(aggregate.aggregate, true);
  assert.equal(aggregate.accountId, 'all');
  assert.equal(aggregate.credits.monthly, 4);
  assert.equal(aggregate.credits.purchased, 2);
  assert.equal(aggregate.credits.free, 1);
  assert.equal(aggregate.windows.fiveHour.used, 1.503303);
  assert.equal(aggregate.windows.fiveHour.cap, 6);
  // the earliest reset is the one that matters to the user
  assert.equal(aggregate.windows.fiveHour.resetAt, '2026-01-01T05:00:00.000Z');
  assert.equal(aggregate.windows.weekly.exceeded, true, 'one exceeded window makes the aggregate exceeded');
  assert.equal(aggregate.usage.requests, 15);
  assert.equal(aggregate.usage.tokensOut, 70);
  assert.equal(aggregate.parts.length, 2, 'per-account detail is kept for the breakdown table');
  assert.equal(aggregate.partial, false);
  assert.equal(aggregate.periodMixed, false);
});

test('a failed account makes the aggregate partial instead of quietly smaller', () => {
  const good = context({ accountId: 'A' });
  const bad = context({ accountId: 'B', credits: null, windowLimits: null, usage: null, error: 'GET /alpha/billing/credits -> 500', errorStatus: 500 });

  const aggregate = quotaSnapshotForScope([good, bad], 'all', { accounts: [good, bad] });

  assert.equal(aggregate.partial, true, 'a smaller-than-real total must never look authoritative');
  assert.deepEqual(aggregate.failedAccounts, ['B']);
  assert.equal(aggregate.error, 'GET /alpha/billing/credits -> 500');
  assert.equal(aggregate.errorStatus, 500);
  assert.equal(aggregate.credits.monthly, 1.082611, 'the successful account still contributes');
});

test('differing billing periods are flagged instead of merged silently', () => {
  const a = context({ accountId: 'A', subscription: { currentPeriodStart: '2026-01-01' } });
  const b = context({ accountId: 'B', subscription: { currentPeriodStart: '2026-01-15' } });

  const aggregate = quotaSnapshotForScope([a, b], 'all', { accounts: [a, b] });
  assert.equal(aggregate.periodMixed, true);
  assert.equal(aggregate.period, null, 'a mixed period cannot be shown as one window');
});

test('a shared billing period is shown as-is', () => {
  const a = context({ accountId: 'A' });
  const b = context({ accountId: 'B' });
  const aggregate = quotaSnapshotForScope([a, b], 'all', { accounts: [a, b] });
  assert.equal(aggregate.periodMixed, false);
  assert.equal(aggregate.period.start, '2026-01-01');
});

test('an empty context list aggregates to null', () => {
  assert.equal(quotaSnapshotForScope([], 'all'), null);
  assert.equal(quotaSnapshotForScope([null, undefined], 'all'), null);
});

/* ------------------------------------------------------------------ model view */

test('the model view filters by plan when a plan is known', () => {
  const view = buildModelView([context()]);

  assert.equal(view.filterApplied, true);
  assert.ok(view.accessible.length > 0);
  assert.ok(view.accessible.length < view.all.length, 'a limited plan must hide something');
  assert.ok(view.accessible.every((model) => model.accessible));
  assert.equal(view.planName, 'Go');
  assert.ok(view.all.every((model) => model.minimumPlanName !== undefined), 'blocked models carry the upgrade hint');
});

test('credits turn filtering off for every model', () => {
  const view = buildModelView([context({ credits: { purchasedCredits: 10 } })]);
  assert.equal(view.accessible.length, view.all.length, 'a credit balance unlocks everything');
});

test('a failed plan lookup does not filter anything, and does not claim to', () => {
  const view = buildModelView([context({ error: 'boom', planId: null })]);
  assert.equal(view.filterApplied, false, 'without a plan the filter must be reported as not applied');
  assert.equal(view.accessible.length, view.all.length);
});

test('multiple accounts label the view as combined', () => {
  const view = buildModelView([context({ accountId: 'A' }), context({ accountId: 'B' })]);
  assert.equal(view.planName, '2 个账号');
  assert.equal(view.all[0].allowedBy.length >= 0, true);
});

test('the model view survives being handed nothing', () => {
  const view = buildModelView([]);
  assert.equal(view.filterApplied, false);
  assert.equal(view.all.length > 0, true, 'the catalogue is still listed');
  assert.equal(view.planName, null);
});
