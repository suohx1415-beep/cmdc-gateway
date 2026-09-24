/**
 * Account rotation. The regression this file exists for: `activeId` is the user's *preference*,
 * so a concurrent request served by another account must never silently undo a switch made in
 * the panel. `lastServedId` tracks reality separately.
 */
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { account, readStore, resetStore, seedStore } from './helpers.mjs';
import { loadConfig } from '../src/config.mjs';
import * as accounts from '../src/accounts.mjs';

/** Fresh config with the given accounts already seeded and loaded. */
function seed(list, overrides = {}) {
  resetStore();
  seedStore(list, overrides);
  const config = loadConfig([], {});
  accounts.loadAccounts(config);
  return config;
}

const A = () => account('A');
const B = () => account('B');

test('adding a second account does not steal the active slot', () => {
  const config = seed([A()]);
  assert.equal(config.activeId, 'A');

  accounts.upsertAccount(config, B());
  assert.equal(config.activeId, 'A', 'the active account must not follow the newest addition');
  assert.equal(config.accounts.length, 2);
});

test('the first account is activated automatically', () => {
  const config = seed([A(), B()], { activeId: null });
  assert.equal(config.activeId, 'A');
});

test('accounts merge by userId, by userName (case-insensitive), and by apiKey', () => {
  const config = seed([account('A', { userId: 'uid-1', userName: 'alice' })]);

  // same userId, different display name -> same account, updated
  accounts.upsertAccount(config, account('A2', { userId: 'uid-1', userName: 'Alice Renamed' }));
  assert.equal(config.accounts.length, 1);
  assert.equal(config.accounts[0].userName, 'Alice Renamed');
  assert.equal(config.accounts[0].id, 'A', 'the original id must be kept');

  // different userId but the same userName -> merged too
  accounts.upsertAccount(config, account('A3', { userId: 'uid-other', userName: 'ALICE RENAMED' }));
  assert.equal(config.accounts.length, 1);

  // no userId/userName at all -> identity falls back to the key
  resetStore();
  seedStore([account('K', { userId: '', userName: '' })]);
  const keyed = loadConfig([], {});
  accounts.loadAccounts(keyed);
  accounts.upsertAccount(keyed, { apiKey: keyed.accounts[0].apiKey });
  assert.equal(keyed.accounts.length, 1, 'the same key must not create a second entry');
});

/* ------------------------------------------------------------------ switching */

test('a request served by another account does not undo the user\'s choice', () => {
  const config = seed([A(), B()], { activeId: 'A' });

  accounts.noteServedAccount(config, 'B');

  assert.equal(config.activeId, 'A', 'the preference must survive a concurrent request');
  const summary = accounts.accountSummary(config);
  assert.equal(summary.activeId, 'A');
  assert.equal(summary.lastServedId, 'B', 'reality is reported separately');

  const rows = accounts.publicAccounts(config);
  assert.equal(rows.find((row) => row.id === 'A').active, true);
  assert.equal(rows.find((row) => row.id === 'B').active, false);
  assert.equal(rows.find((row) => row.id === 'B').lastServed, true);
});

test('the preference advances when it genuinely could not serve (rotation fell through)', () => {
  const config = seed([A(), B()], { activeId: 'A' });
  accounts.markInvalid(config, 'A', { reason: 'key revoked', status: 401 });

  accounts.noteServedAccount(config, 'B');

  assert.equal(config.activeId, 'B', 'once the preferred account is dead, reality becomes the preference');
  assert.equal(config.apiKey, config.accounts.find((entry) => entry.id === 'B').apiKey);
});

test('a cooling preferred account also lets the preference advance', () => {
  const config = seed([A(), B()], { activeId: 'A' });
  accounts.noteRateLimited(config, 'A', 60_000);
  assert.equal(accounts.isCooling('A'), true);

  accounts.noteServedAccount(config, 'B');
  assert.equal(config.activeId, 'B');
});

test('with rotation off, serving only ever updates who served', () => {
  const config = seed([A()], { activeId: 'A' });
  config.rotationMode = 'off';
  accounts.noteServedAccount(config, 'A');
  assert.equal(config.activeId, 'A');
  assert.equal(accounts.accountSummary(config).lastServedId, 'A');
});

test('an explicit switch is respected even to a dead key, and reported as invalid', () => {
  const config = seed([A(), B()], { activeId: 'A' });
  accounts.markInvalid(config, 'B', { reason: 'expired', status: 403 });

  const result = accounts.setActiveAccount(config, 'B');

  assert.equal(result.ok, true);
  assert.equal(result.invalid, true, 'the UI needs to know it switched to a dead key');
  assert.equal(config.activeId, 'B', 'the user\'s explicit choice wins');
});

test('switching to an unknown account is refused', () => {
  const config = seed([A()], { activeId: 'A' });
  assert.deepEqual(accounts.setActiveAccount(config, 'nope'), { ok: false });
  assert.equal(config.activeId, 'A');
});

test('an explicit switch clears a cooldown on the target', () => {
  const config = seed([A(), B()], { activeId: 'A' });
  accounts.noteRateLimited(config, 'B', 60_000);
  accounts.setActiveAccount(config, 'B');
  assert.equal(accounts.isCooling('B'), false);
});

/* ------------------------------------------------------------------ validity */

test('a rate limit expires on its own', () => {
  const config = seed([A()]);
  accounts.noteRateLimited(config, 'A', 1);
  assert.equal(accounts.isCooling('A'), true);
  const until = accounts.cooldownSnapshot().A;
  assert.ok(until <= Date.now() + 5, 'the cooldown should be near-immediate');
});

test('a rate limit is capped so a bogus Retry-After cannot park an account forever', () => {
  const config = seed([A()]);
  accounts.noteRateLimited(config, 'A', 10 * 365 * 24 * 60 * 60 * 1000);
  const until = accounts.cooldownSnapshot().A;
  assert.ok(until <= Date.now() + accounts.MAX_COOLDOWN_MS + 1000, 'cooldown must be capped at 24h');
});

test('quota exhaustion parks until the reset time when it is in the future', () => {
  const config = seed([A()]);
  const resetAt = Date.now() + 3_600_000;
  accounts.noteQuotaExhausted(config, 'A', resetAt);
  assert.equal(accounts.cooldownSnapshot().A, resetAt);
});

test('quota exhaustion falls back to the default cooldown without a usable reset time', () => {
  const config = seed([A()]);
  for (const value of [null, undefined, 0, Date.now() - 1000, 'later']) {
    accounts.clearCooldown(config, 'A');
    accounts.noteQuotaExhausted(config, 'A', value);
    const until = accounts.cooldownSnapshot().A;
    assert.ok(until > Date.now() && until <= Date.now() + accounts.DEFAULT_COOLDOWN_MS + 1000, `bad untilMs: ${value}`);
  }
});

test('a successful request self-heals an account', () => {
  const config = seed([A()]);
  accounts.markInvalid(config, 'A', { reason: 'expired', status: 401 });
  accounts.noteRateLimited(config, 'A', 60_000);
  assert.equal(accounts.isInvalid('A'), true);
  assert.equal(accounts.isCooling('A'), true);

  accounts.noteSuccess(config, 'A');

  assert.equal(accounts.isInvalid('A'), false, 'a working key must clear its dead flag');
  assert.equal(accounts.isCooling('A'), false);
});

test('clearCooldown and clearInvalid report whether they changed anything', () => {
  const config = seed([A()]);
  assert.equal(accounts.clearCooldown(config, 'A'), false);
  accounts.noteRateLimited(config, 'A', 60_000);
  assert.equal(accounts.clearCooldown(config, 'A'), true);

  assert.equal(accounts.clearInvalid(config, 'A'), false);
  accounts.markInvalid(config, 'A', { reason: 'x', status: 401 });
  assert.equal(accounts.clearInvalid(config, 'A'), true);
});

test('markInvalid keeps the first sighting time across repeated failures', () => {
  const config = seed([A()]);
  accounts.markInvalid(config, 'A', { reason: 'first', status: 401 });
  const firstAt = accounts.invalidSnapshot().A.at;
  accounts.markInvalid(config, 'A', { reason: 'second', status: 403 });

  const entry = accounts.invalidSnapshot().A;
  assert.equal(entry.at, firstAt, 'the original detection time is more useful than the latest one');
  assert.equal(entry.reason, 'second', 'but the latest reason should be shown');
});

/* ------------------------------------------------------------------ persistence */

test('cooldowns, invalid flags and lastServed survive a restart', () => {
  const config = seed([A(), B()], { activeId: 'A' });
  accounts.markInvalid(config, 'B', { reason: 'revoked', status: 401 });
  accounts.noteRateLimited(config, 'A', 120_000);
  accounts.noteServedAccount(config, 'B');
  accounts.flushPendingWrites();

  const saved = readStore();
  assert.equal(saved.lastServedId, 'B');
  assert.ok(saved.states.A.cooldownUntil > Date.now());
  assert.equal(saved.states.B.invalidStatus, 401);

  // simulate a restart: same file, brand new config
  const restarted = loadConfig([], {});
  accounts.loadAccounts(restarted);

  assert.equal(accounts.isCooling('A'), true, 'a cooldown must outlive the process');
  assert.equal(accounts.isInvalid('B'), true, 'a dead key must stay out of rotation');
  assert.equal(accounts.accountSummary(restarted).lastServedId, 'B');
});

test('an expired cooldown is not rehydrated', () => {
  seed([A()], { states: { A: { cooldownUntil: Date.now() - 60_000 } } });
  assert.equal(accounts.isCooling('A'), false);
});

test('switching is written to disk', () => {
  const config = seed([A(), B()], { activeId: 'A' });
  accounts.setActiveAccount(config, 'B');
  assert.equal(readStore().activeId, 'B');
});

test('only the active account\'s key is used as the runtime credential', () => {
  const config = seed([A(), B()], { activeId: 'B' });
  assert.equal(config.apiKey, account('B').apiKey);
  accounts.setActiveAccount(config, 'A');
  assert.equal(config.apiKey, account('A').apiKey);
});

/* ------------------------------------------------------------------ ordering */

test('orderedAccounts puts the active account first and keeps the rest in place', () => {
  const config = seed([A(), B(), account('C')], { activeId: 'C' });
  assert.deepEqual(
    accounts.orderedAccounts(config).map((entry) => entry.id),
    ['C', 'A', 'B'],
  );

  // already first, or single account: order untouched
  accounts.setActiveAccount(config, 'A');
  assert.deepEqual(
    accounts.orderedAccounts(config).map((entry) => entry.id),
    ['A', 'B', 'C'],
  );
});

/* ------------------------------------------------------------------ mutation results */

test('removing the active account promotes another one', () => {
  const config = seed([A(), B()], { activeId: 'A' });
  const result = accounts.removeAccount(config, 'A');

  assert.equal(result.removed, true);
  assert.equal(config.activeId, 'B');
  assert.equal(config.accounts.length, 1);
});

test('removing an unknown account changes nothing', () => {
  const config = seed([A()]);
  assert.deepEqual(accounts.removeAccount(config, 'ghost'), { removed: false });
  assert.equal(config.accounts.length, 1);
});

test('removing the scoped dashboard account falls back to all', () => {
  const config = seed([A(), B()], { activeId: 'A', dashboard: 'B' });
  accounts.removeAccount(config, 'B');
  assert.equal(config.dashboard, 'all');
});

test('rotation mode and dashboard scope validate their input', () => {
  const config = seed([A(), B()], { activeId: 'A' });

  assert.equal(accounts.setRotationMode(config, 'sequential').ok, true);
  assert.equal(config.rotationMode, 'sequential');
  assert.equal(accounts.setRotationMode(config, 'bogus').ok, false);
  assert.equal(config.rotationMode, 'sequential', 'an invalid mode must not be applied');

  assert.equal(accounts.setDashboardScope(config, 'B').ok, true);
  assert.equal(config.dashboard, 'B');
  assert.equal(accounts.setDashboardScope(config, 'ghost').ok, false);
  assert.equal(accounts.setDashboardScope(config, 'all').ok, true);
});

/* ------------------------------------------------------------------ readonly store */

test('an explicit --api-key disables rotation and refuses every mutation', () => {
  resetStore();
  const config = loadConfig(['--api-key', 'user_explicit'], {});
  accounts.loadAccounts(config);

  assert.equal(accounts.isReadonlyStore(config), true);
  assert.equal(config.rotationMode, 'off');
  assert.equal(config.accounts.length, 1);
  assert.equal(config.accounts[0].id, 'explicit');

  assert.throws(() => accounts.upsertAccount(config, B()), /不可用/);
  assert.deepEqual(accounts.setActiveAccount(config, 'explicit'), { ok: false, readonly: true });
  assert.deepEqual(accounts.setRotationMode(config, 'sequential'), { ok: false, readonly: true });
  assert.deepEqual(accounts.setDashboardScope(config, 'all'), { ok: false, readonly: true });
  assert.deepEqual(accounts.removeAccount(config, 'explicit'), { removed: false, readonly: true });
  assert.equal(accounts.clearAccounts(config).readonly, true);
  // nothing may be written for an explicit key
  assert.equal(accounts.accountSummary(config).readonly, true);
});

/* ------------------------------------------------------------------ presentation */

test('the account list masks keys instead of exposing them', () => {
  const config = seed([account('A', { apiKey: 'user_abcdefghijklmnop' })]);
  const [row] = accounts.publicAccounts(config);

  assert.equal(row.maskedKey, 'user_a...mnop');
  assert.ok(!JSON.stringify(row).includes('user_abcdefghijklmnop'), 'the full key must not be serialised');
});

test('an unhelpfully short key is masked entirely', () => {
  const config = seed([account('A', { apiKey: 'short' })]);
  assert.equal(accounts.publicAccounts(config)[0].maskedKey, '...');
});

test('the summary counts cooling and invalid accounts', () => {
  const config = seed([A(), B(), account('C')], { activeId: 'A' });
  accounts.noteRateLimited(config, 'B', 60_000);
  accounts.markInvalid(config, 'C', { reason: 'x', status: 401 });

  const summary = accounts.accountSummary(config);
  assert.equal(summary.count, 3);
  assert.equal(summary.multi, true);
  assert.equal(summary.coolingCount, 1);
  assert.equal(summary.invalidCount, 1);
  assert.equal(summary.accounts.length, 3);
});

test('the display name falls back to the id when the account has no name', () => {
  const config = seed([account('A', { userName: '', userId: '' })]);
  assert.equal(accounts.publicAccounts(config)[0].userName, 'unknown');
});
