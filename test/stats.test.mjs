/**
 * Metrics, and in particular the reasoning split.
 *
 * The rule these tests pin down: a request only counts towards the reasoning share if it
 * actually reported a split. Records written before that field existed must not be treated as
 * "0 reasoning", because that would claim a measurement that was never made.
 */
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { TEST_HOME, resetStore, writeJson } from './helpers.mjs';
import { estimateCost, modelPrice, recordRequest, statsSnapshot, useStatsEnvironment } from '../src/stats.mjs';
import { loadCatalog } from '../src/models.mjs';

// stats.mjs keeps the loaded records in module memory, so alternating the api env is how each
// test gets a clean slate: a path change drops the cache, and the store is then wiped.
let flip = false;
function freshStats() {
  flip = !flip;
  const file = useStatsEnvironment(flip ? 'staging' : 'prod');
  resetStore();
  return file;
}

test('metrics for a non-prod environment go to their own file', () => {
  const prod = useStatsEnvironment('prod');
  const staging = useStatsEnvironment('staging');
  const local = useStatsEnvironment('local');

  assert.ok(prod.endsWith(`${path.sep}stats.json`), prod);
  assert.ok(staging.endsWith(`${path.sep}stats.staging.json`), staging);
  assert.ok(local.endsWith(`${path.sep}stats.local.json`), local);
  assert.ok(path.dirname(prod).startsWith(TEST_HOME), 'metrics must stay in the isolated store');
  useStatsEnvironment('prod');
});

test('an empty history produces a well-formed snapshot instead of nulls', () => {
  freshStats();
  const snapshot = statsSnapshot();

  assert.equal(snapshot.totals.requests, 0);
  assert.equal(snapshot.totals.cost, 0);
  assert.equal(snapshot.totals.reasoningShare, null);
  assert.equal(snapshot.totals.reasoningSamples, 0);
  assert.equal(snapshot.totals.cacheHitRate, null, 'no requests means no measured hit rate');
  assert.deepEqual(snapshot.models, []);
  assert.ok(Array.isArray(snapshot.series) && snapshot.series.length > 0, 'the chart still needs buckets');
});

test('recorded requests show up in the totals', () => {
  freshStats();
  recordRequest({ model: 'm', promptTokens: 100, cachedTokens: 80, completionTokens: 50, cost: 0.002, ok: true, ttftMs: 300, durationMs: 900 });
  recordRequest({ model: 'm', promptTokens: 200, cachedTokens: 100, completionTokens: 100, cost: 0.004, ok: false, error: 'boom' });

  const snapshot = statsSnapshot();
  assert.equal(snapshot.totals.requests, 2);
  assert.equal(snapshot.totals.ok, 1);
  assert.equal(snapshot.totals.failed, 1);
  assert.equal(snapshot.totals.promptTokens, 300);
  assert.equal(snapshot.totals.cachedTokens, 180);
  assert.equal(snapshot.totals.completionTokens, 150);
  assert.equal(snapshot.totals.totalTokens, 450);
  assert.equal(snapshot.totals.cacheHitRate, 180 / 300);
  assert.equal(Math.round(snapshot.totals.cost * 1e6) / 1e6, 0.006);
  assert.equal(snapshot.totals.avgTtftMs, 300, 'only requests that measured a first token count');
  assert.equal(snapshot.totals.measuredTtft, 1);
  assert.equal(snapshot.models[0].failed, 1);
});

test('a request with no first-token measurement does not drag the average down', () => {
  freshStats();
  recordRequest({ model: 'm', promptTokens: 1, completionTokens: 1, ttftMs: 100 });
  recordRequest({ model: 'm', promptTokens: 1, completionTokens: 1 }); // never produced a token

  const snapshot = statsSnapshot();
  assert.equal(snapshot.totals.avgTtftMs, 100);
  assert.equal(snapshot.totals.measuredTtft, 1);
});

test('the reasoning split is summed and shared over the whole window', () => {
  freshStats();
  recordRequest({ model: 'm', promptTokens: 10, completionTokens: 100, reasoningTokens: 30, textTokens: 70, reasoningChars: 120 });
  recordRequest({ model: 'm', promptTokens: 10, completionTokens: 50, reasoningTokens: 10, textTokens: 40, reasoningChars: 40 });

  const snapshot = statsSnapshot();
  assert.equal(snapshot.totals.reasoningTokens, 40);
  assert.equal(snapshot.totals.textTokens, 110);
  assert.equal(snapshot.totals.reasoningChars, 160);
  assert.equal(snapshot.totals.reasoningShare, 40 / 150, 'reasoning over the output of reporting requests');
  assert.equal(snapshot.totals.reasoningSamples, 2);
});

test('records written before the reasoning field existed are excluded, not counted as zero', () => {
  const file = freshStats();
  writeJson(file, {
    updatedAt: Date.now(),
    requests: [
      // legacy record: 1000 output tokens and no split information at all
      { t: Date.now() - 2000, model: 'm', ok: true, promptTokens: 1, completionTokens: 1000, cost: 0 },
      { t: Date.now() - 1000, model: 'm', ok: true, promptTokens: 1, completionTokens: 100, reasoningTokens: 25, textTokens: 75, cost: 0 },
    ],
  });

  const snapshot = statsSnapshot();
  assert.equal(snapshot.totals.reasoningSamples, 1, 'only the record that reported a split is a sample');
  assert.equal(snapshot.totals.reasoningShare, 25 / 100, 'the legacy record must not dilute the share');
  assert.equal(snapshot.models[0].reasoningShare, 25 / 100);
});

test('a history with no split anywhere reports no share at all', () => {
  const file = freshStats();
  writeJson(file, {
    updatedAt: Date.now(),
    requests: [{ t: Date.now() - 1000, model: 'm', ok: true, promptTokens: 1, completionTokens: 50, cost: 0 }],
  });

  const snapshot = statsSnapshot();
  assert.equal(snapshot.totals.reasoningTokens, 0);
  assert.equal(snapshot.totals.reasoningSamples, 0);
  assert.equal(snapshot.totals.reasoningShare, null, 'never claim a measurement that was not made');
  assert.equal(snapshot.models[0].reasoningShare, null);
});

test('an explicitly supplied cost wins over the price table', () => {
  freshStats();
  recordRequest({ model: 'unknown-model', promptTokens: 1, completionTokens: 1, cost: 1.5 });
  recordRequest({ model: 'unknown-model', promptTokens: 1, completionTokens: 1 });

  const snapshot = statsSnapshot();
  assert.equal(snapshot.totals.cost, 1.5, 'a model with no price contributes nothing rather than guessing');
  assert.equal(snapshot.models[0].price, null);
});

test('models are ranked by request count', () => {
  freshStats();
  recordRequest({ model: 'rare', promptTokens: 1, completionTokens: 1 });
  recordRequest({ model: 'busy', promptTokens: 1, completionTokens: 1 });
  recordRequest({ model: 'busy', promptTokens: 1, completionTokens: 1 });

  assert.deepEqual(
    statsSnapshot().models.map((row) => row.model),
    ['busy', 'rare'],
  );
});

test('the per-account breakdown ignores the scope filter, the totals do not', () => {
  freshStats();
  recordRequest({ model: 'm', accountId: 'A', accountName: 'Account A', promptTokens: 10, completionTokens: 1 });
  recordRequest({ model: 'm', accountId: 'B', accountName: 'Account B', promptTokens: 20, completionTokens: 1 });

  const all = statsSnapshot();
  assert.equal(all.totals.promptTokens, 30);
  assert.equal(all.accounts.length, 2);
  assert.equal(all.accounts.find((row) => row.accountId === 'A').scoped, false);

  const scoped = statsSnapshot({ accountId: 'A' });
  assert.equal(scoped.totals.promptTokens, 10, 'totals follow the scope');
  assert.equal(scoped.accounts.length, 2, 'the breakdown still shows every account for comparison');
  assert.equal(scoped.accounts.find((row) => row.accountId === 'A').scoped, true);
});

test('a request with no account is grouped as unknown rather than dropped', () => {
  freshStats();
  recordRequest({ model: 'm', promptTokens: 1, completionTokens: 1 });
  const snapshot = statsSnapshot();
  assert.equal(snapshot.accounts[0].accountId, 'unknown');
});

test('the recent feed is newest first and capped', () => {
  freshStats();
  for (let index = 0; index < 40; index += 1) {
    recordRequest({ model: `m${index}`, promptTokens: 1, completionTokens: 1, t: Date.now() - (40 - index) * 1000 });
  }

  const snapshot = statsSnapshot();
  assert.ok(snapshot.recent.length <= 25, `expected at most 25 recent entries, got ${snapshot.recent.length}`);
  const times = snapshot.recent.map((entry) => entry.t);
  assert.deepEqual(times, [...times].sort((a, b) => b - a), 'recent must be newest first');
});

test('requests outside the window are excluded from the totals', () => {
  freshStats();
  recordRequest({ model: 'm', promptTokens: 5, completionTokens: 5, t: Date.now() });
  recordRequest({ model: 'old', promptTokens: 5, completionTokens: 5, t: Date.now() - 48 * 3_600_000 });

  const snapshot = statsSnapshot({ hours: 24 });
  assert.equal(snapshot.totals.requests, 1);
  assert.equal(snapshot.models[0].model, 'm');
});

test('long error text is truncated so one failure cannot bloat the history', () => {
  freshStats();
  const record = recordRequest({ model: 'm', promptTokens: 1, completionTokens: 1, error: 'x'.repeat(500) });
  assert.equal(record.error.length, 200);
});

/* ------------------------------------------------------------------ pricing */

test('a known model exposes its price table', () => {
  const model = loadCatalog().models[0];
  const price = modelPrice(model.id);
  assert.ok(price, `expected a price for ${model.id}`);
  assert.equal(typeof price.input, 'number');
});

test('an unknown model has no price', () => {
  assert.equal(modelPrice('not-a-real-model'), null);
});

test('cost is computed per million tokens with the cached rate applied', () => {
  const model = loadCatalog().models.find((entry) => entry.cost && typeof entry.cost.input === 'number');
  const price = modelPrice(model.id);
  const usage = { promptTokens: 1000, cachedTokens: 900, completionTokens: 25, cacheWriteTokens: 50 };

  const expected =
    (price.input * 100 + price.cacheRead * 900 + (price.cacheWrite ?? 0) * 50 + price.output * 25) / 1_000_000;
  assert.equal(estimateCost(model.id, usage), expected);
});

test('more cached tokens than prompt tokens cannot produce a negative charge', () => {
  const model = loadCatalog().models.find((entry) => entry.cost && typeof entry.cost.input === 'number');
  const price = modelPrice(model.id);
  // cached is clamped to the prompt size, so the fresh portion is never negative
  const cost = estimateCost(model.id, { promptTokens: 10, cachedTokens: 999, completionTokens: 0, cacheWriteTokens: 0 });
  assert.equal(cost, (price.cacheRead * 10) / 1_000_000);
});

test('a model with no price table cannot be costed', () => {
  assert.equal(estimateCost('not-a-real-model', { promptTokens: 10, completionTokens: 10 }), null);
});

test('missing usage fields are treated as zero rather than NaN', () => {
  const model = loadCatalog().models.find((entry) => entry.cost && typeof entry.cost.input === 'number');
  const cost = estimateCost(model.id, {});
  assert.equal(cost, 0);
  assert.equal(Number.isNaN(cost), false);
});
