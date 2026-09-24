/**
 * Shared test setup.
 *
 * `GATEWAY_STORE_DIR` (and the stats file path) are derived from `os.homedir()` at module load,
 * and the real `~/.cmdc-gateway/` holds live credentials and metrics. So this module points the
 * home env vars at a throwaway directory *before* `src/config.mjs` is first evaluated, then
 * asserts the store really moved: if the isolation ever breaks, every test fails loudly instead
 * of quietly writing to real credentials.
 *
 * Test files must `import './helpers.mjs'` as their FIRST import. ESM evaluates static imports
 * in declaration order, so that guarantees the store is redirected before any module under test
 * pulls in config.mjs.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdc-gateway-test-'));

process.env.HOME = TEST_HOME;
process.env.USERPROFILE = TEST_HOME;
process.env.HOMEDRIVE = '';
process.env.HOMEPATH = '';
for (const key of Object.keys(process.env)) {
  if (key.startsWith('CMD_GATEWAY_') || key === 'COMMAND_CODE_API_KEY') delete process.env[key];
}

const { GATEWAY_STORE_DIR, GATEWAY_CONFIG_FILE } = await import('../src/config.mjs');

if (!path.resolve(GATEWAY_STORE_DIR).startsWith(path.resolve(TEST_HOME))) {
  throw new Error(
    `test isolation failed: store resolved to ${GATEWAY_STORE_DIR}, expected it under ${TEST_HOME}. ` +
      'Refusing to run so tests can never touch the real gateway credentials.',
  );
}

export { GATEWAY_STORE_DIR, GATEWAY_CONFIG_FILE };

export function storePath(name = 'auth.json') {
  return path.join(GATEWAY_STORE_DIR, name);
}

export function resetStore() {
  fs.rmSync(GATEWAY_STORE_DIR, { recursive: true, force: true });
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return value;
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeStore(value, name = 'auth.json') {
  return writeJson(storePath(name), value);
}

export function readStore(name = 'auth.json') {
  return readJson(storePath(name));
}

/** An account record in the shape the store expects. */
export function account(id, overrides = {}) {
  return {
    id,
    apiKey: `user_${id}_key`,
    userId: `uid-${id}`,
    userName: id,
    keyName: 'test',
    authenticatedAt: '2026-01-01T00:00:00.000Z',
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Writes auth.json for the given accounts. Returns nothing: the caller loads the config. */
export function seedStore(accounts, overrides = {}) {
  return writeStore({
    mode: 'failover',
    dashboard: 'all',
    activeId: accounts[0]?.id ?? null,
    accounts,
    ...overrides,
  });
}
