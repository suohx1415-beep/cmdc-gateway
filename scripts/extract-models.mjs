#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '..');

function candidateNodeModules() {
  const home = os.homedir();
  const roots = [
    process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'node_modules') : null,
    path.join(home, 'AppData', 'Roaming', 'npm', 'node_modules'),
    path.join(home, '.npm-global', 'lib', 'node_modules'),
    path.join(home, '.local', 'share', 'npm', 'node_modules'),
    '/usr/local/lib/node_modules',
    '/usr/lib/node_modules',
    process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter).join('') : null,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'nodejs', 'node_modules') : null,
  ];
  return roots.filter(Boolean);
}

function findPackageDir(explicit) {
  const roots = explicit ? [explicit] : candidateNodeModules();
  for (const root of roots) {
    const dir = path.join(root, 'command-code');
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
  }
  return null;
}

/**
 * Provenance recorded in models.json. Never write the absolute path: it embeds the local
 * username (`C:\Users\you\AppData\...`) into a file that is meant to be published. Render it
 * relative to the node_modules root with forward slashes, so it is portable and anonymous.
 */
function portableSource(pkgDir, filePath) {
  const rel = path.relative(path.dirname(pkgDir), filePath);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return `node_modules/${rel.split(path.sep).join('/')}`;
  }
  return `command-code/${path.basename(filePath)}`;
}

function parseArgs(argv) {
  const out = { from: null, out: path.join(PROJECT_ROOT, 'models.json') };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--from') out.from = argv[++i];
    else if (arg === '--out') out.out = argv[++i];
  }
  return out;
}

function parseContext(raw) {
  const text = raw.replace(/[*`]/g, '').trim();
  if (!text || text === '—' || text === '-') return null;
  const match = /^([\d.]+)\s*([MKmk])?$/.exec(text);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2]?.toUpperCase();
  if (unit === 'M') return Math.round(value * 1_000_000);
  if (unit === 'K') return Math.round(value * 1_000);
  return Math.round(value);
}

function parseEfforts(raw) {
  const text = raw.replace(/[*`]/g, '').trim();
  if (!text || text === '—' || text === '-') return [];
  return text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^(low|medium|high|xhigh|max)$/.test(part));
}

function parseNumber(pattern, text) {
  const match = pattern.exec(text);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function parseCost(raw) {
  const text = raw.trim();
  const input = parseNumber(/\$([\d.]+)/, text);
  const afterSlash = text.slice(text.indexOf('/') + 1);
  const output = parseNumber(/\$([\d.]+)/, afterSlash);
  const cacheRead = parseNumber(/cache\s*\$([\d.]+)/i, text);
  const cacheWrite = parseNumber(/write\s*\$([\d.]+)/i, text);
  const cost = {};
  if (input !== undefined) cost.input = input;
  if (output !== undefined) cost.output = output;
  if (cacheRead !== undefined) cost.cacheRead = cacheRead;
  if (cacheWrite !== undefined) cost.cacheWrite = cacheWrite;
  return cost;
}

function parseModelsMarkdown(markdown) {
  const models = [];
  const seen = new Set();
  let category = null;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      category = heading[1].trim();
      continue;
    }
    if (!line.startsWith('|')) continue;
    const cells = line.split('|');
    if (cells.length < 8) continue;
    const id = cells[1].replace(/[`*]/g, '').trim();
    if (!id || id === 'Id (use EXACTLY this)') continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const name = cells[2].replace(/[`*]/g, '').trim();
    const contextWindow = parseContext(cells[3]);
    const reasoningEfforts = parseEfforts(cells[4]);
    const cost = parseCost(cells[5]);
    const minPlan = cells[6].replace(/[`*]/g, '').trim();
    const bestFor = cells[7].replace(/[`*]/g, '').trim();
    models.push({
      id,
      name: name || id,
      category: category ?? 'other',
      contextWindow,
      reasoningEfforts,
      cost,
      minPlan,
      bestFor,
      free: /(^|\/)\$0\/\$0/.test(cells[5]) || /:free$/.test(id),
    });
  }
  return models;
}

const PROVIDER_CONSTANTS = { Lr: 'anthropic', Or: 'openai', Dr: 'vercel-ai-gateway' };
const CATEGORY_CONSTANTS = { Nr: 'premium', $r: 'opensource' };

function sliceLiteral(source, startIndex) {
  const open = source[startIndex];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = startIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return source.slice(startIndex, i + 1);
    }
  }
  return null;
}

function literalAfter(source, marker) {
  const at = source.indexOf(marker);
  if (at < 0) return null;
  return sliceLiteral(source, at + marker.length - 1);
}

function matchAll(text, pattern) {
  const out = [];
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let match;
  while ((match = re.exec(text))) out.push(match);
  return out;
}

function parseModelAccess(source) {
  const literal = literalAfter(source, 'Ur={');
  if (!literal) return {};
  const out = {};
  for (const [, id, value] of matchAll(literal, /"([^"]+)":(\{[^{}]*\}|_r\(\w+\)|Fr\(\))/)) {
    if (value === 'Fr()') {
      out[id] = { provider: 'cai', category: 'opensource' };
      continue;
    }
    const helper = /^_r\((\w+)\)$/.exec(value);
    if (helper) {
      out[id] = { provider: PROVIDER_CONSTANTS[helper[1]] ?? helper[1], category: 'premium' };
      continue;
    }
    const providerMatch = /provider:("([^"]*)"|(\w+))/.exec(value);
    const categoryMatch = /category:(\$?\w+)/.exec(value);
    const provider = providerMatch
      ? providerMatch[2] ?? PROVIDER_CONSTANTS[providerMatch[3]] ?? providerMatch[3]
      : 'unknown';
    const rawCategory = categoryMatch?.[1];
    const category = CATEGORY_CONSTANTS[rawCategory] ?? rawCategory ?? 'unknown';
    out[id] = { provider, category };
  }
  return out;
}

function parsePlanRules(source) {
  const literal = literalAfter(source, 'jr={');
  if (!literal) return {};
  const out = {};
  for (const [, id, categories, blocked] of matchAll(
    literal,
    /"([^"]+)":\{allowedCategories:\[([^\]]*)\](?:,blockedModels:\[([^\]]*)\])?\}/,
  )) {
    out[id] = {
      allowedCategories: categories
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => CATEGORY_CONSTANTS[part] ?? part),
      blockedModels: matchAll(blocked ?? '', /"([^"]+)"/).map((match) => match[1]),
    };
  }
  return out;
}

function parsePlanOrder(source) {
  const literal = literalAfter(source, 'Br=[');
  if (!literal) return [];
  return matchAll(literal, /"([^"]+)"/).map((match) => match[1]);
}

function parsePlanNames(source) {
  const literal = literalAfter(source, 'Wr={');
  if (!literal) return {};
  const out = {};
  for (const [, id, name] of matchAll(literal, /"([^"]+)":"([^"]*)"/)) out[id] = name;
  return out;
}

function parseAccess(source) {
  const modelAccess = parseModelAccess(source);
  const planRules = parsePlanRules(source);
  const planOrder = parsePlanOrder(source);
  if (Object.keys(modelAccess).length === 0 || planOrder.length === 0) return null;
  return { planOrder, planNames: parsePlanNames(source), planRules, modelAccess };
}

const FALLBACK_MODELS = [
  { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 1_000_000, reasoningEfforts: ['high', 'max'] },
  { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextWindow: 1_000_000, reasoningEfforts: ['high', 'max'] },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 1_000_000, reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', contextWindow: 400_000, reasoningEfforts: ['low', 'medium', 'high'] },
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const pkgDir = findPackageDir(args.from);
  if (!pkgDir) {
    console.error('Could not locate the installed "command-code" package.');
    console.error('Pass --from <path-to-node_modules> or run: npm i -g command-code');
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const modelsPath = path.join(pkgDir, 'dist', 'bundled', 'command-code-knowledge', 'reference', 'models.md');
  if (!fs.existsSync(modelsPath)) {
    console.error(`Reference not found: ${modelsPath}`);
    process.exit(1);
  }

  const models = parseModelsMarkdown(fs.readFileSync(modelsPath, 'utf8'));

  const cliPath = path.join(pkgDir, 'dist', 'cli.mjs');
  let access = null;
  if (fs.existsSync(cliPath)) {
    try {
      access = parseAccess(fs.readFileSync(cliPath, 'utf8'));
    } catch (error) {
      console.warn(`warning: failed to parse access metadata: ${error.message}`);
    }
  }
  if (!access) {
    console.warn('warning: no model-access metadata found; the gateway will list every model');
  } else {
    for (const model of models) {
      const entry = access.modelAccess[model.id];
      if (entry) {
        model.provider = entry.provider;
        model.category = entry.category;
      }
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source: portableSource(pkgDir, modelsPath),
    cliVersion: pkg.version,
    ...(access ? { access } : {}),
    models: models.length > 0 ? models : FALLBACK_MODELS,
  };

  fs.writeFileSync(args.out, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${output.models.length} models to ${args.out}`);
  console.log(`command-code version: ${output.cliVersion}`);
  if (access) {
    const premium = Object.values(access.modelAccess).filter((entry) => entry.category === 'premium').length;
    console.log(`access metadata: ${access.planOrder.length} plans, ${premium} premium / ${Object.keys(access.modelAccess).length - premium} opensource models`);
  }
}

main();
