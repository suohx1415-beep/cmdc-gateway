/**
 * The access key must be random but *stable*: generated once, persisted, and reused forever.
 * Regenerating on every start would silently invalidate every client's configuration, which is
 * the one failure mode this design exists to prevent.
 */
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  GATEWAY_CONFIG_FILE,
  GATEWAY_STORE_DIR,
  readJson,
  resetStore,
  storePath,
  writeJson,
} from './helpers.mjs';
import { loadConfig, toPublicConfig, isLoopbackHost } from '../src/config.mjs';

/** The old shipped default. Kept here only so the "still using it" warning can be tested. */
const LEGACY_PUBLIC_ACCESS_KEY = 'cmdc_a9d974348498174d9e875ad59e8d87ddedb8e789';
const KEY_SHAPE = /^cmdc_[0-9a-f]{40}$/;

test('first run: generates a well-formed key, persists it, and reports that it did', () => {
  resetStore();
  const config = loadConfig([], {});

  assert.match(config.accessKey, KEY_SHAPE);
  assert.equal(config.accessKeyGenerated, true);
  assert.equal(config.accessKeyPersistFailed, false);
  assert.equal(config.accessKeyLegacyPublic, false);
  assert.equal(config.accessKeyExplicit, false);
  // it must actually be on disk, or the next start would generate a different one
  assert.equal(readJson(GATEWAY_CONFIG_FILE).accessKey, config.accessKey);
});

test('restart: reuses the saved key instead of generating a new one', () => {
  resetStore();
  const first = loadConfig([], {});
  const second = loadConfig([], {});
  const third = loadConfig([], {});

  assert.equal(second.accessKey, first.accessKey);
  assert.equal(third.accessKey, first.accessKey);
  // only the first run generated; later runs read it back
  assert.equal(second.accessKeyGenerated, false);
  assert.equal(third.accessKeyGenerated, false);
});

test('two fresh installs do not produce the same key', () => {
  resetStore();
  const a = loadConfig([], {}).accessKey;
  resetStore();
  const b = loadConfig([], {}).accessKey;

  assert.notEqual(a, b);
  assert.match(a, KEY_SHAPE);
  assert.match(b, KEY_SHAPE);
});

test('an install still holding the published legacy key is flagged, not silently rewritten', () => {
  resetStore();
  // seed a config the way an older version would have left it
  loadConfig([], {});
  writeJson(GATEWAY_CONFIG_FILE, { ...readJson(GATEWAY_CONFIG_FILE), accessKey: LEGACY_PUBLIC_ACCESS_KEY });

  const loaded = loadConfig([], {});
  assert.equal(loaded.accessKey, LEGACY_PUBLIC_ACCESS_KEY);
  assert.equal(loaded.accessKeyLegacyPublic, true);
  assert.equal(loaded.accessKeyGenerated, false);
  // reported but never auto-rotated: rotating would break every client without warning
  assert.equal(readJson(GATEWAY_CONFIG_FILE).accessKey, LEGACY_PUBLIC_ACCESS_KEY);
});

test('a saved non-legacy key is not flagged as public', () => {
  resetStore();
  loadConfig([], {});
  const loaded = loadConfig([], {});
  assert.equal(loaded.accessKeyLegacyPublic, false);
  assert.equal(loaded.accessKeyGenerated, false);
});

test('an explicit --client-key wins over the saved key and does not overwrite it', () => {
  resetStore();
  const saved = loadConfig([], {});
  const explicit = loadConfig(['--client-key', 'cmdc_explicit_choice'], {});

  assert.equal(explicit.accessKey, 'cmdc_explicit_choice');
  assert.equal(explicit.accessKeyExplicit, true);
  assert.equal(readJson(GATEWAY_CONFIG_FILE).accessKey, saved.accessKey, 'saved key must survive');
});

test('--client-key with --save-port persists the new key', () => {
  resetStore();
  loadConfig([], {});
  const config = loadConfig(['--client-key', 'cmdc_rotated', '--save-port'], {});

  assert.equal(config.accessKey, 'cmdc_rotated');
  assert.equal(readJson(GATEWAY_CONFIG_FILE).accessKey, 'cmdc_rotated');
});

test('CMD_GATEWAY_CLIENT_KEY behaves like the flag', () => {
  resetStore();
  const config = loadConfig([], { CMD_GATEWAY_CLIENT_KEY: 'cmdc_from_env' });
  assert.equal(config.accessKey, 'cmdc_from_env');
  assert.equal(config.accessKeyExplicit, true);
});

test('the key is required on a LAN bind and exempt on loopback', () => {
  resetStore();
  assert.equal(loadConfig([], {}).accessKeyRequired, true);
  assert.equal(loadConfig(['--host', '0.0.0.0'], {}).accessKeyRequired, true);
  resetStore();
  assert.equal(loadConfig(['--host', '127.0.0.1'], {}).accessKeyRequired, false);
});

test('loopback detection covers the forms clients actually use', () => {
  for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]', '127.5.5.5']) {
    assert.equal(isLoopbackHost(host), true, `${host} should be loopback`);
  }
  for (const host of ['0.0.0.0', '192.168.1.10', '', null]) {
    assert.equal(isLoopbackHost(host), false, `${host} should not be loopback`);
  }
});

test('port is pinned on first run and reused afterwards', () => {
  resetStore();
  const first = loadConfig([], {});
  assert.equal(first.port, 8810);
  assert.equal(first.portPinned, true);
  assert.equal(readJson(GATEWAY_CONFIG_FILE).port, 8810);

  const second = loadConfig([], {});
  assert.equal(second.port, 8810);
  assert.equal(second.portSource, 'pinned');
});

test('--port changes this run only; --save-port makes it permanent', () => {
  resetStore();
  loadConfig([], {});

  const temporary = loadConfig(['--port', '9000'], {});
  assert.equal(temporary.port, 9000);
  assert.equal(temporary.fixedPort, 8810, 'the pinned port must not follow a temporary override');
  assert.equal(readJson(GATEWAY_CONFIG_FILE).port, 8810, 'a temporary port must not be written');

  const permanent = loadConfig(['--port', '9000', '--save-port'], {});
  assert.equal(permanent.port, 9000);
  assert.equal(readJson(GATEWAY_CONFIG_FILE).port, 9000);
});

test('an invalid port is rejected instead of silently defaulting', () => {
  resetStore();
  assert.throws(() => loadConfig(['--port', 'not-a-port'], {}), /Invalid port/);
  assert.throws(() => loadConfig(['--port', '70000'], {}), /Invalid port/);
});

test('toPublicConfig exposes the access-key state without inventing fields', () => {
  resetStore();
  const config = loadConfig([], {});
  const publicConfig = toPublicConfig(config);

  assert.equal(publicConfig.accessKey, config.accessKey);
  assert.equal(publicConfig.accessKeyGenerated, true);
  assert.equal(publicConfig.accessKeyLegacyPublic, false);
  assert.equal(publicConfig.accessKeyPersistFailed, false);
  assert.equal(publicConfig.accessKeyRequired, true);
  assert.equal(publicConfig.requiresClientKey, true);
  assert.equal(publicConfig.cliVersion, '1.53.1', 'cli version should come from models.json');
});

test('an unwritable store is reported rather than silently regenerating later', () => {
  resetStore();
  // put a FILE where the store directory has to be, so mkdir/write cannot succeed
  fs.writeFileSync(GATEWAY_STORE_DIR, 'not a directory', 'utf8');
  try {
    const config = loadConfig([], {});
    assert.equal(config.accessKeyPersistFailed, true, 'a failed write must be surfaced');
    assert.match(config.accessKey, KEY_SHAPE);
  } finally {
    fs.rmSync(GATEWAY_STORE_DIR, { force: true });
  }
});

test('the store file follows the api env', () => {
  resetStore();
  assert.ok(storePath('auth.json').endsWith('auth.json'));
  const staging = loadConfig(['--env', 'staging'], {});
  assert.ok(staging.storeFile.endsWith('auth.staging.json'));
});
