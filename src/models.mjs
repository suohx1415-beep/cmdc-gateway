import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from './config.mjs';

const FALLBACK = [
  { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 1_000_000, reasoningEfforts: ['high', 'max'] },
  { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextWindow: 1_000_000, reasoningEfforts: ['high', 'max'] },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 1_000_000, reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', contextWindow: 400_000, reasoningEfforts: ['low', 'medium', 'high'] },
];

let cache = null;

export function loadCatalog() {
  if (cache) return cache;
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'models.json'), 'utf8'));
  } catch {
    /* fall back below */
  }
  const models = Array.isArray(manifest?.models) && manifest.models.length ? manifest.models : FALLBACK;
  cache = {
    cliVersion: manifest?.cliVersion ?? null,
    generatedAt: manifest?.generatedAt ?? null,
    access: manifest?.access ?? null,
    models,
  };
  return cache;
}

export function findModel(id) {
  return loadCatalog().models.find((model) => model.id === id) ?? null;
}

export function openAIModelList(models = loadCatalog().models) {
  return {
    object: 'list',
    data: models.map((model) => ({ id: model.id, object: 'model', created: 0, owned_by: 'command-code' })),
  };
}

export function openAIModel(id) {
  return { id, object: 'model', created: 0, owned_by: 'command-code' };
}

export function anthropicModelList(models = loadCatalog().models) {
  return {
    data: models.map((model) => ({
      type: 'model',
      id: model.id,
      display_name: model.name ?? model.id,
      created_at: new Date(0).toISOString(),
    })),
    has_more: false,
    first_id: models[0]?.id ?? null,
    last_id: models[models.length - 1]?.id ?? null,
  };
}
