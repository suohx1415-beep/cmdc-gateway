import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const SALT = 'command-code:device-fingerprint:v1';
const COLLECTOR_VERSION = 1;
const ROUTE = '/alpha/fingerprint/record';
const USER_AGENT = 'cli';

let recorded = false;
let recordedForKey = null;
let lastResult = null;

function safeExec(command, args) {
  return new Promise((resolve) => {
    try {
      execFile(command, args, { timeout: 4000, windowsHide: true }, (error, stdout) => {
        resolve(error ? '' : String(stdout ?? '').trim());
      });
    } catch {
      resolve('');
    }
  });
}

export function hashSignal(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return undefined;
  return crypto.createHash('sha256').update(SALT).update('\0').update(trimmed.toLowerCase()).digest('hex');
}

async function readMachineId() {
  try {
    if (process.platform === 'darwin') {
      const output = await safeExec('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
      return /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(output)?.[1] ?? '';
    }
    if (process.platform === 'linux') {
      for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        try {
          const value = fs.readFileSync(file, 'utf8').trim();
          if (value) return value;
        } catch {
          /* try the next location */
        }
      }
      return '';
    }
    if (process.platform === 'win32') {
      const output = await safeExec('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']);
      return /MachineGuid\s+REG_SZ\s+([\w-]+)/i.exec(output)?.[1] ?? '';
    }
  } catch {
    /* fall through */
  }
  return '';
}

function readMacAddresses() {
  try {
    const interfaces = os.networkInterfaces();
    const found = new Set();
    for (const entries of Object.values(interfaces)) {
      for (const entry of entries ?? []) {
        if (entry.internal) continue;
        const mac = entry.mac?.toLowerCase();
        if (mac && mac !== '00:00:00:00:00:00') found.add(mac);
      }
    }
    return [...found];
  } catch {
    return [];
  }
}

async function readGitEmail() {
  const configured = await safeExec('git', ['config', '--global', 'user.email']);
  if (configured) return configured;
  try {
    const text = fs.readFileSync(path.join(os.homedir(), '.gitconfig'), 'utf8');
    return /email\s*=\s*(.+)/i.exec(text)?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}

function detectContainer() {
  try {
    if (fs.existsSync('/.dockerenv')) return true;
    if (process.env.KUBERNETES_SERVICE_HOST) return true;
    if (fs.existsSync('/proc/1/cgroup')) {
      const content = fs.readFileSync('/proc/1/cgroup', 'utf8');
      if (/docker|kubepods|containerd|lxc/.test(content)) return true;
    }
  } catch {
    /* not a container as far as we can tell */
  }
  return false;
}

function readTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

async function gatherRawSignals() {
  let osUser = '';
  try {
    osUser = os.userInfo().username ?? '';
  } catch {
    osUser = process.env.USER ?? process.env.USERNAME ?? '';
  }
  const cpus = (() => {
    try {
      return os.cpus();
    } catch {
      return [];
    }
  })();
  const [machineId, gitEmail] = await Promise.all([readMachineId(), readGitEmail()]);

  return {
    machineId,
    macAddresses: readMacAddresses(),
    osUser,
    hostname: (() => {
      try {
        return os.hostname();
      } catch {
        return '';
      }
    })(),
    gitEmail,
    platform: process.platform,
    arch: process.arch,
    osRelease: (() => {
      try {
        return os.release();
      } catch {
        return '';
      }
    })(),
    cpuModel: cpus[0]?.model?.trim() ?? '',
    cpuCount: cpus.length,
    totalMemBytes: (() => {
      try {
        return os.totalmem();
      } catch {
        return 0;
      }
    })(),
    isContainer: detectContainer(),
    timezone: readTimezone(),
  };
}

export async function buildFingerprint() {
  const signals = await gatherRawSignals();
  const macs = [...new Set(signals.macAddresses.map((mac) => mac.toLowerCase()))].filter(Boolean).sort();
  const machineId = signals.machineId.trim();
  const parts = [
    machineId,
    macs.join(','),
    machineId ? '' : signals.hostname.trim(),
    machineId ? '' : signals.cpuModel.trim(),
  ].filter(Boolean);

  const thumbmark = crypto
    .createHash('sha256')
    .update(SALT)
    .update('\0machine\0')
    .update(parts.join('|') || 'unknown')
    .digest('hex');

  return {
    thumbmark,
    components: {
      machineIdHash: hashSignal(signals.machineId),
      macHashes: macs.map((mac) => hashSignal(mac)).filter(Boolean),
      osUserHash: hashSignal(signals.osUser),
      hostnameHash: hashSignal(signals.hostname),
      gitEmailHash: hashSignal(signals.gitEmail),
      platform: signals.platform,
      arch: signals.arch,
      osRelease: signals.osRelease,
      cpuModel: signals.cpuModel,
      cpuCount: signals.cpuCount,
      memGiB: Math.round(signals.totalMemBytes / 1024 ** 3),
      isContainer: signals.isContainer,
      timezone: signals.timezone || undefined,
      runtime: 'cli',
      collectorVersion: COLLECTOR_VERSION,
    },
  };
}

function telemetryAllowed(config) {
  if (config.fingerprint === false) return false;
  if (process.env.DO_NOT_TRACK === '1' || process.env.DO_NOT_TRACK === 'true') return false;
  if (process.env.CMD_LOCAL_ONLY === '1') return false;
  return true;
}

export async function recordFingerprint(config) {
  // one report per key: a fresh login has to report again, but a request must not re-report
  if (recorded && recordedForKey === config.apiKey) return lastResult;

  if (!telemetryAllowed(config)) {
    recorded = true;
    recordedForKey = config.apiKey;
    lastResult = { recorded: false, reason: 'disabled' };
    return lastResult;
  }
  if (!config.apiKey) {
    lastResult = { recorded: false, reason: 'no api key yet' };
    return lastResult;
  }

  recorded = true;
  recordedForKey = config.apiKey;

  try {
    const fingerprint = await buildFingerprint();
    const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}${ROUTE}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        'User-Agent': USER_AGENT,
        'x-cli-environment': config.apiEnv === 'prod' ? 'production' : config.apiEnv,
        'x-command-code-version': config.cliVersion,
      },
      body: JSON.stringify({ thumbmark: fingerprint.thumbmark, components: fingerprint.components }),
    });
    lastResult = {
      recorded: response.ok,
      status: response.status,
      thumbmark: fingerprint.thumbmark,
      components: fingerprint.components,
      at: new Date().toISOString(),
    };
  } catch (error) {
    lastResult = { recorded: false, reason: error?.message ?? String(error), at: new Date().toISOString() };
  }
  return lastResult;
}

export function fingerprintStatus() {
  return lastResult;
}
