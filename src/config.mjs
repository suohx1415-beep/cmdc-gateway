import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(HERE, '..');

export const API_BASE_URLS = {
  prod: 'https://api.commandcode.ai',
  staging: 'https://staging-api.commandcode.ai',
  local: 'http://localhost:9090',
};

export const AUTH_FILE_NAMES = {
  prod: 'auth.json',
  staging: 'auth.staging.json',
  local: 'auth.local.json',
};

export const GATEWAY_STORE_DIR = path.join(os.homedir(), '.cmdc-gateway');
export const CLI_DIR = path.join(os.homedir(), '.commandcode');
export const GATEWAY_CONFIG_FILE = path.join(GATEWAY_STORE_DIR, 'config.json');

const DEFAULT_PORT = 8810;
const DEFAULT_HOST = '0.0.0.0';
// Shipped default access key: fixed on purpose so client configs never have to change.
// Override it in ~/.cmdc-gateway/config.json or with `--client-key <key> --save-port`.
const DEFAULT_ACCESS_KEY = 'cmdc_a9d974348498174d9e875ad59e8d87ddedb8e789';
const DEFAULT_MODE = 'agent';
const DEFAULT_PERMISSION_MODE = 'standard';
const DEFAULT_MAX_TOKENS = 64_000;
const DEFAULT_CLI_VERSION = '1.53.1';
const DEFAULT_PLAN_TTL_MS = 60_000;

function parseArgv(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('-')) continue;
    const [rawKey, inlineValue] = arg.replace(/^--?/, '').split('=');
    const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const takesValue = inlineValue === undefined && argv[i + 1] !== undefined && !argv[i + 1].startsWith('-');
    const value = inlineValue ?? (takesValue ? argv[i + 1] : true);
    if (takesValue) i += 1;
    flags[key] = value;
  }
  return flags;
}

export function readJsonSafe(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function gatewayStoreFile(apiEnv) {
  return path.join(GATEWAY_STORE_DIR, AUTH_FILE_NAMES[apiEnv] ?? AUTH_FILE_NAMES.prod);
}

export function cliAuthFile(apiEnv) {
  return path.join(CLI_DIR, AUTH_FILE_NAMES[apiEnv] ?? AUTH_FILE_NAMES.prod);
}

function readGeneratedManifest() {
  return readJsonSafe(path.join(PROJECT_ROOT, 'models.json'));
}

function normalizeEnv(raw) {
  const value = String(raw ?? '').toLowerCase();
  if (value === 'staging' || value === 'local') return value;
  return 'prod';
}

function resolveCredential(apiEnv, explicit, useCliAuth) {
  if (explicit) return { apiKey: explicit, apiKeySource: 'flag/env', credentialFile: null };

  const storeFile = gatewayStoreFile(apiEnv);
  const stored = readJsonSafe(storeFile);
  const storedEnv = typeof stored?.apiEnv === 'string' ? stored.apiEnv : apiEnv;
  if (typeof stored?.apiKey === 'string' && stored.apiKey.trim() && storedEnv === apiEnv) {
    return { apiKey: stored.apiKey.trim(), apiKeySource: 'gateway store', credentialFile: storeFile };
  }

  if (useCliAuth) {
    const cliFile = cliAuthFile(apiEnv);
    const cli = readJsonSafe(cliFile);
    if (typeof cli?.apiKey === 'string' && cli.apiKey.trim()) {
      return { apiKey: cli.apiKey.trim(), apiKeySource: 'cli auth (read-only)', credentialFile: cliFile };
    }
  }

  return { apiKey: '', apiKeySource: 'none', credentialFile: storeFile };
}

function readGatewayConfig() {
  return readJsonSafe(GATEWAY_CONFIG_FILE) ?? {};
}

function writeGatewayConfig(data) {
  try {
    fs.mkdirSync(GATEWAY_STORE_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(GATEWAY_CONFIG_FILE, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

function validPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return port;
}

export function isLoopbackHost(host) {
  const value = String(host ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  return value === 'localhost' || value === '::1' || value === '127.0.0.1' || value.startsWith('127.');
}

export function isLoopbackAddress(address) {
  if (!address) return false;
  const value = String(address).replace(/^::ffff:/i, '').toLowerCase();
  return value === '::1' || value === 'localhost' || value.startsWith('127.');
}

export function lanAddresses() {
  const out = [];
  try {
    for (const entries of Object.values(os.networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.internal || entry.family !== 'IPv4') continue;
        out.push(entry.address);
      }
    }
  } catch {
    /* no interfaces */
  }
  return out;
}

/**
 * The listen port is pinned in ~/.cmdc-gateway/config.json so client base URLs never
 * move. Precedence: --port / env (this run only) > pinned value > 8810 (pinned on first run).
 */
function resolvePort(flags, env) {
  const saved = readGatewayConfig();
  const explicit = flags.port ?? env.CMD_GATEWAY_PORT;

  if (explicit !== undefined && explicit !== true) {
    const port = validPort(explicit);
    if (port === null) throw new Error(`Invalid port: ${explicit}`);
    if (flags.savePort) writeGatewayConfig({ ...saved, port });
    return { port, fixedPort: validPort(saved.port) ?? port, source: 'flag/env', pinned: false };
  }

  const pinned = validPort(saved.port);
  if (pinned !== null) return { port: pinned, fixedPort: pinned, source: 'pinned', pinned: true };

  // first run: pin the default so it stops being a decision
  writeGatewayConfig({ ...saved, port: DEFAULT_PORT });
  return { port: DEFAULT_PORT, fixedPort: DEFAULT_PORT, source: 'default (已固定)', pinned: true };
}

/** Host is pinned the same way, so "LAN open" is a stored decision, not a per-run flag. */
function resolveHost(flags, env) {
  const saved = readGatewayConfig();
  const explicit = flags.host ?? env.CMD_GATEWAY_HOST;
  if (explicit !== undefined && explicit !== true) {
    if (flags.savePort) writeGatewayConfig({ ...saved, host: String(explicit) });
    return { host: String(explicit), fixedHost: String(saved.host ?? explicit), pinned: false };
  }
  if (typeof saved.host === 'string' && saved.host) {
    return { host: saved.host, fixedHost: saved.host, pinned: true };
  }
  writeGatewayConfig({ ...saved, host: DEFAULT_HOST });
  return { host: DEFAULT_HOST, fixedHost: DEFAULT_HOST, pinned: true };
}

/**
 * The access key is fixed, not random: a stable key means client configs never have to
 * change. Loopback stays exempt unless the operator pins an explicit key.
 */
function resolveAccessKey(flags, env, host) {
  const saved = readGatewayConfig();
  const explicit = String(flags.clientKey ?? env.CMD_GATEWAY_CLIENT_KEY ?? '').trim();
  if (explicit) {
    if (flags.savePort) writeGatewayConfig({ ...saved, accessKey: explicit });
    return { accessKey: explicit, accessKeyExplicit: true, required: true };
  }
  if (typeof saved.accessKey === 'string' && saved.accessKey) {
    return { accessKey: saved.accessKey, accessKeyExplicit: false, required: !isLoopbackHost(host) };
  }

  // first run: record the default so it is visible and editable in config.json
  writeGatewayConfig({ ...saved, accessKey: DEFAULT_ACCESS_KEY });
  return { accessKey: DEFAULT_ACCESS_KEY, accessKeyExplicit: false, required: !isLoopbackHost(host), defaulted: true };
}

export function loadConfig(argv = process.argv.slice(2), env = process.env) {
  const flags = parseArgv(argv);

  const apiEnv = normalizeEnv(flags.env ?? env.CMD_GATEWAY_ENV ?? env.CMD_API_ENV);
  const useCliAuth = Boolean(flags.useCliAuth ?? (env.CMD_GATEWAY_USE_CLI_AUTH === '1' || env.CMD_GATEWAY_USE_CLI_AUTH === 'true'));
  const explicitKey = String(flags.apiKey || env.CMD_GATEWAY_API_KEY || env.COMMAND_CODE_API_KEY || '').trim();
  const credential = resolveCredential(apiEnv, explicitKey, useCliAuth);

  const baseUrl = String(flags.baseUrl || env.CMD_GATEWAY_BASE_URL || API_BASE_URLS[apiEnv]).replace(/\/+$/, '');
  const { port, fixedPort, source: portSource, pinned } = resolvePort(flags, env);
  const { host, fixedHost, pinned: hostPinned } = resolveHost(flags, env);
  const { accessKey, accessKeyExplicit, required: accessKeyRequired, defaulted } = resolveAccessKey(flags, env, host);

  const cwd = path.resolve(String(flags.cwd || env.CMD_GATEWAY_CWD || process.cwd()));
  const manifest = readGeneratedManifest();

  const fingerprint = flags.noFingerprint
    ? false
    : flags.fingerprint !== undefined
      ? Boolean(flags.fingerprint)
      : env.CMD_GATEWAY_FINGERPRINT !== '0';

  return {
    apiEnv,
    baseUrl,
    apiKey: credential.apiKey,
    apiKeyExplicit: Boolean(explicitKey),
    apiKeySource: credential.apiKeySource,
    credentialFile: credential.credentialFile,
    storeFile: gatewayStoreFile(apiEnv),
    useCliAuth,
    fingerprint,
    host,
    fixedHost,
    hostPinned,
    port,
    fixedPort,
    portPinned: pinned,
    portSource,
    configFile: GATEWAY_CONFIG_FILE,
    accessKey,
    accessKeyExplicit,
    accessKeyRequired,
    accessKeyDefault: Boolean(defaulted),
    lan: !isLoopbackHost(host),
    cwd,
    callbackBase: String(flags.callbackBase || env.CMD_GATEWAY_CALLBACK_BASE || `http://127.0.0.1:${port}`).replace(/\/+$/, ''),
    mode: String(flags.mode || env.CMD_GATEWAY_MODE || DEFAULT_MODE),
    permissionMode: String(flags.permissionMode || env.CMD_GATEWAY_PERMISSION_MODE || DEFAULT_PERMISSION_MODE),
    maxTokens: Number(flags.maxTokens || env.CMD_GATEWAY_MAX_TOKENS || DEFAULT_MAX_TOKENS),
    // Empty by default on purpose: the gateway must not silently change model behaviour for
    // clients that already work. Set it (e.g. "low") to cap reasoning depth when a client
    // sends none — a client-specified value always wins over this default.
    reasoningEffort: String(flags.reasoningEffort || env.CMD_GATEWAY_REASONING_EFFORT || '').trim(),
    cliVersion: String(flags.cliVersion || env.CMD_GATEWAY_CLI_VERSION || manifest?.cliVersion || DEFAULT_CLI_VERSION),
    projectSlug: String(flags.projectSlug || env.CMD_GATEWAY_PROJECT_SLUG || path.basename(cwd) || 'gateway').replace(/[^A-Za-z0-9._-]/g, '-'),
    planTtlMs: Number(flags.planTtlMs || env.CMD_GATEWAY_PLAN_TTL_MS || DEFAULT_PLAN_TTL_MS),
    verbose: Boolean(flags.verbose ?? env.CMD_GATEWAY_VERBOSE),
  };
}

export function toPublicConfig(config) {
  const lan = config.lan ? lanAddresses().map((address) => `http://${address}:${config.port}`) : [];
  return {
    apiEnv: config.apiEnv,
    baseUrl: config.baseUrl,
    host: config.host,
    port: config.port,
    cwd: config.cwd,
    mode: config.mode,
    permissionMode: config.permissionMode,
    maxTokens: config.maxTokens,
    reasoningEffort: config.reasoningEffort || '',
    cliVersion: config.cliVersion,
    projectSlug: config.projectSlug,
    hasApiKey: Boolean(config.apiKey),
    apiKeySource: config.apiKeySource,
    storeFile: config.storeFile,
    configFile: config.configFile,
    fixedPort: config.fixedPort,
    portPinned: config.portPinned,
    portSource: config.portSource,
    lan: Boolean(config.lan),
    lanUrls: lan,
    accessKey: config.accessKey,
    accessKeyRequired: Boolean(config.accessKeyRequired),
    accessKeyExplicit: Boolean(config.accessKeyExplicit),
    useCliAuth: config.useCliAuth,
    fingerprint: config.fingerprint,
    requiresClientKey: Boolean(config.accessKeyRequired),
  };
}
