/**
 * The generated model catalogue. `models.json` is a build artefact checked into the repo, so
 * these tests guard both its integrity and the fact that it stays free of machine-local paths.
 */
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { PROJECT_ROOT } from '../src/config.mjs';
import { anthropicModelList, findModel, loadCatalog, openAIModel, openAIModelList } from '../src/models.mjs';

const MANIFEST_FILE = path.join(PROJECT_ROOT, 'models.json');
const raw = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
const catalog = loadCatalog();

test('the manifest is complete enough to serve requests', () => {
  assert.ok(Array.isArray(raw.models) && raw.models.length > 0, 'models.json lists no models');
  assert.equal(typeof raw.cliVersion, 'string');
  assert.ok(raw.cliVersion.length > 0);
  assert.ok(raw.generatedAt, 'the manifest should record when it was generated');
});

test('the manifest does not leak a machine-local path', () => {
  // `source` used to be the absolute path of the installed CLI, which exposed the local
  // username on a public repo. It must stay a portable, relative reference.
  assert.equal(typeof raw.source, 'string', 'source should be recorded');
  assert.doesNotMatch(raw.source, /[A-Za-z]:[\\/]/, 'no Windows drive path');
  assert.doesNotMatch(raw.source, /\\/, 'no backslashes at all');
  assert.doesNotMatch(raw.source, /(^|\/)(Users|home)\//i, 'no home directory path');
});

test('the catalogue reports the manifest version', () => {
  assert.equal(catalog.cliVersion, raw.cliVersion);
  assert.equal(catalog.generatedAt, raw.generatedAt);
});

test('every model has the fields the APIs and the panel rely on', () => {
  for (const model of catalog.models) {
    assert.equal(typeof model.id, 'string', `${JSON.stringify(model)} has no id`);
    assert.ok(model.id.length > 0);
    assert.equal(typeof model.name, 'string', `${model.id} has no name`);
    // a few models legitimately have no context window in the CLI's own table
    assert.ok(
      model.contextWindow === null || (typeof model.contextWindow === 'number' && model.contextWindow > 0),
      `${model.id} has an invalid context window: ${JSON.stringify(model.contextWindow)}`,
    );
    assert.ok(Array.isArray(model.reasoningEfforts), `${model.id} has no reasoning efforts`);
    assert.ok(model.cost && typeof model.cost === 'object', `${model.id} has no cost`);
  }
});

test('model ids are unique', () => {
  const ids = catalog.models.map((model) => model.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, [], 'duplicate model ids would make routing ambiguous');
});

test('prices are non-negative numbers', () => {
  for (const model of catalog.models) {
    for (const [key, value] of Object.entries(model.cost)) {
      assert.equal(typeof value, 'number', `${model.id}.cost.${key} is not a number`);
      assert.ok(value >= 0, `${model.id}.cost.${key} is negative`);
    }
    assert.equal(typeof model.cost.input, 'number', `${model.id} has no input price`);
    assert.equal(typeof model.cost.output, 'number', `${model.id} has no output price`);
  }
});

test('the access table only references categories that exist', () => {
  const access = catalog.access;
  assert.ok(access, 'the access table is missing');

  const categories = new Set(Object.values(access.modelAccess).map((entry) => entry.category));
  for (const [planId, rules] of Object.entries(access.planRules)) {
    for (const category of rules.allowedCategories) {
      assert.ok(categories.has(category), `${planId} allows unknown category ${category}`);
    }
  }
});

test('blocked model references are well formed and mostly resolvable', () => {
  const access = catalog.access;
  const known = new Set(Object.entries(access.modelAccess).map(([id, entry]) => `${entry.provider}:${id}`));
  const unknown = [];

  for (const [planId, rules] of Object.entries(access.planRules)) {
    for (const blocked of rules.blockedModels) {
      assert.match(blocked, /^[a-z0-9-]+:.+$/, `${planId} blocks a malformed id: ${blocked}`);
      if (!known.has(blocked)) unknown.push(blocked);
    }
  }

  // A handful reference models the catalogue does not list (claude-opus-4-6 and
  // claude-opus-4-5-20251101 at the time of writing). Those can never match, so they are
  // inert. A sudden jump here would mean the access table and the model list drifted apart.
  assert.ok(unknown.length <= 10, `blocked ids missing from the catalogue: ${[...new Set(unknown)].join(', ')}`);
});

test('the OpenAI model list is shaped the way the SDK expects', () => {
  const list = openAIModelList();

  assert.equal(list.object, 'list');
  assert.equal(list.data.length, catalog.models.length);
  for (const entry of list.data) {
    assert.equal(entry.object, 'model');
    assert.equal(entry.owned_by, 'command-code');
    assert.equal(typeof entry.created, 'number');
  }
  assert.equal(list.data[0].id, catalog.models[0].id);
});

test('a single OpenAI model entry is returned for any id, without validation', () => {
  // the route is a thin passthrough: asking for an unknown model must not throw here
  assert.deepEqual(openAIModel('does-not-exist'), {
    id: 'does-not-exist',
    object: 'model',
    created: 0,
    owned_by: 'command-code',
  });
});

test('the Anthropic model list is shaped the way the SDK expects', () => {
  const list = anthropicModelList();

  assert.equal(list.has_more, false);
  assert.equal(list.data.length, catalog.models.length);
  assert.equal(list.first_id, catalog.models[0].id);
  assert.equal(list.last_id, catalog.models.at(-1).id);

  const [first] = list.data;
  assert.equal(first.type, 'model');
  assert.equal(first.id, catalog.models[0].id);
  assert.equal(first.display_name, catalog.models[0].name);
  assert.equal(first.created_at, new Date(0).toISOString());
});

test('findModel resolves known ids and returns null otherwise', () => {
  const first = catalog.models[0];
  assert.equal(findModel(first.id).id, first.id);
  assert.equal(findModel('definitely-not-a-model'), null);
});

test('the catalogue is cached rather than re-read per call', () => {
  assert.equal(loadCatalog(), loadCatalog(), 'loadCatalog should return a stable object');
});
