const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const root = __dirname;
const storagePath = path.join(root, 'apps', 'server', 'build', 'configs', 'storage.json');
const monitorPath = path.join(root, 'apps', 'server', 'build', 'monitor.js');
const credentialPath = path.join(root, 'keep-monitor.credentials.json');
const defaultPhone = process.env.CHAOXING_DEFAULT_PHONE || '15886795013';
const defaultLocation = process.env.CHAOXING_DEFAULT_LOCATION || '116.36,40.00/北京语言大学-主楼南';

const options = {
  userIndex: 0,
  restartDelaySeconds: 5,
  validateOnly: false,
  setCredentials: false,
  promptLogin: false,
  promptStart: false,
  refreshLogin: false,
};

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--validate-only' || arg === '-ValidateOnly') {
    options.validateOnly = true;
  } else if (arg === '--set-credentials' || arg === '-SetCredentials') {
    options.setCredentials = true;
  } else if (arg === '--prompt-login' || arg === '-PromptLogin') {
    options.promptLogin = true;
  } else if (arg === '--prompt-start' || arg === '-PromptStart') {
    options.promptStart = true;
  } else if (arg === '--refresh-login' || arg === '-RefreshLogin') {
    options.refreshLogin = true;
  } else if (arg === '--user-index' || arg === '-UserIndex') {
    options.userIndex = Number(process.argv[++i]);
  } else if (arg === '--restart-delay' || arg === '-RestartDelaySeconds') {
    options.restartDelaySeconds = Number(process.argv[++i]);
  } else if (arg === '--help' || arg === '-h' || arg === '/?') {
    console.log('Usage: node keep-monitor.js [--user-index 0] [--restart-delay 5] [--prompt-start] [--prompt-login] [--set-credentials] [--refresh-login] [--validate-only]');
    process.exit(0);
  }
}

function fail(message) {
  console.error(`[keep-monitor] ${message}`);
  process.exit(1);
}

function formatError(error) {
  if (!error) return 'unknown error';
  const parts = [];
  if (error.code) parts.push(error.code);
  if (error.message) parts.push(error.message);
  if (error.host) parts.push(`host=${error.host}`);
  if (error.port) parts.push(`port=${error.port}`);
  return parts.length ? parts.join(' | ') : String(error);
}

function maskPhone(phone) {
  const value = String(phone || '');
  if (!value) return '[unknown]';
  if (value.length < 7) return '[masked]';
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function encodePowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function psQuote(value) {
  return String(value).replace(/'/g, "''");
}

function runPowerShell(script, stdio = 'pipe') {
  return spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShell(script)], {
    cwd: root,
    encoding: 'utf8',
    stdio,
  });
}

function setEncryptedCredentials(defaultPhone) {
  const script = `
$ErrorActionPreference = 'Stop'
$path = '${psQuote(credentialPath)}'
$defaultPhone = '${psQuote(defaultPhone || '')}'
if ($defaultPhone) {
  $phone = Read-Host "Phone (press Enter to use $defaultPhone)"
  if ([string]::IsNullOrWhiteSpace($phone)) { $phone = $defaultPhone }
} else {
  $phone = Read-Host 'Phone'
}
$password = Read-Host 'Password' -AsSecureString
$encrypted = $password | ConvertFrom-SecureString
$json = @{ phone = $phone; password = $encrypted } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText($path, $json, [System.Text.UTF8Encoding]::new($false))
Write-Host "[keep-monitor] Encrypted credentials saved to $path"
`;
  const result = runPowerShell(script, 'inherit');
  if (result.status !== 0) {
    fail('Could not save encrypted credentials.');
  }
}

function promptLoginCredentials(defaultPhone) {
  const script = `
$ErrorActionPreference = 'Stop'
$defaultPhone = '${psQuote(defaultPhone || '')}'
if ($defaultPhone) {
  $phone = Read-Host "Phone (press Enter to use $defaultPhone)"
  if ([string]::IsNullOrWhiteSpace($phone)) { $phone = $defaultPhone }
} else {
  $phone = Read-Host 'Phone'
}
$password = Read-Host 'Password' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
@{ phone = $phone; password = $plain } | ConvertTo-Json -Compress
`;
  const result = runPowerShell(script, 'pipe');
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'PowerShell login prompt failed').trim());
  }

  const data = JSON.parse(result.stdout);
  return { ...data, source: 'prompt' };
}

function promptStartDetails(defaultPhone, defaultLocation) {
  const script = `
$ErrorActionPreference = 'Stop'
$defaultPhone = '${psQuote(defaultPhone || '')}'
$defaultLocation = '${psQuote(defaultLocation || '')}'
if ($defaultPhone) {
  $phone = Read-Host "Phone (press Enter to use $defaultPhone)"
  if ([string]::IsNullOrWhiteSpace($phone)) { $phone = $defaultPhone }
} else {
  $phone = Read-Host 'Phone'
}
$password = Read-Host 'Password' -AsSecureString
if ($defaultLocation) {
  $location = Read-Host "Location lng,lat/address (press Enter to use $defaultLocation)"
  if ([string]::IsNullOrWhiteSpace($location)) { $location = $defaultLocation }
} else {
  $location = Read-Host 'Location lng,lat/address'
}
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
@{ phone = $phone; password = $plain; location = $location } | ConvertTo-Json -Compress
`;
  const result = runPowerShell(script, 'pipe');
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'PowerShell startup prompt failed').trim());
  }

  const data = JSON.parse(result.stdout);
  return { ...data, source: 'prompt-start' };
}

function loadEncryptedCredentials() {
  if (process.env.CHAOXING_PASSWORD) {
    return {
      phone: process.env.CHAOXING_PHONE || null,
      password: process.env.CHAOXING_PASSWORD,
      source: 'environment',
    };
  }

  if (!fs.existsSync(credentialPath)) {
    return null;
  }

  const script = `
$ErrorActionPreference = 'Stop'
$raw = Get-Content -Raw -LiteralPath '${psQuote(credentialPath)}' | ConvertFrom-Json
$secure = $raw.password | ConvertTo-SecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
@{ phone = $raw.phone; password = $plain } | ConvertTo-Json -Compress
`;
  const result = runPowerShell(script);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'PowerShell credential decrypt failed').trim());
  }
  const data = JSON.parse(result.stdout);
  return { ...data, source: 'encrypted-file' };
}

function loadStorage() {
  try {
    return JSON.parse(fs.readFileSync(storagePath, 'utf8'));
  } catch (error) {
    fail(`Could not parse saved monitor config: ${error.message}`);
  }
}

function writeStorage(storage) {
  const tmpPath = `${storagePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(storage), 'utf8');
  fs.renameSync(tmpPath, storagePath);
}

function defaultMonitorConfig() {
  return {
    delay: 15,
    presetAddress: [parseLocationInput(defaultLocation)],
  };
}

function ensurePromptStartUser(storage) {
  if (!Array.isArray(storage.users)) {
    storage.users = [];
  }

  if (storage.users.length === 0) {
    storage.users.push({
      phone: defaultPhone,
      params: {},
      monitor: defaultMonitorConfig(),
      mailing: { enabled: false },
      cqserver: { cq_enabled: false },
    });
  }
}

function getSelectedUser(storage, allowMissingParams = false) {
  const users = Array.isArray(storage.users) ? storage.users : [];
  if (users.length === 0) {
    fail("No saved users found. Run 'pnpm monitor' once first.");
  }

  if (options.userIndex >= users.length) {
    fail(`User index ${options.userIndex} is out of range. Saved user count: ${users.length}.`);
  }

  const user = users[options.userIndex];
  if (!user.params && !allowMissingParams) {
    fail("Selected user has no saved login params. Run 'pnpm monitor' once and log in again.");
  }

  if (!user.monitor) {
    fail("Selected user has no saved monitor settings. Run 'pnpm monitor' once and save location/settings first.");
  }

  return user;
}

function getMonitorPayload(user) {
  return {
    credentials: {
      phone: user.phone,
      uf: user.params.uf,
      _d: user.params._d,
      vc3: user.params.vc3,
      uid: user.params._uid,
      lv: user.params.lv,
      fid: user.params.fid,
    },
    config: {
      monitor: user.monitor,
      mailing: user.mailing || { enabled: false },
      cqserver: user.cqserver || { cq_enabled: false },
    },
  };
}

function getPresetAddressCount(user) {
  const presetAddress = user?.monitor?.presetAddress;
  return Array.isArray(presetAddress) ? presetAddress.length : 0;
}

function getDefaultLocationInput(user) {
  const presetAddress = user?.monitor?.presetAddress;
  const first = Array.isArray(presetAddress) ? presetAddress[0] : null;
  if (!first?.lon || !first?.lat || !first?.address) {
    return '';
  }
  return `${first.lon},${first.lat}/${first.address}`;
}

function parseLocationInput(locationInput) {
  const match = String(locationInput || '').match(/^\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\/\s*(.+?)\s*$/u);
  if (!match) {
    fail('Invalid location format. Use: longitude,latitude/address');
  }

  return {
    lon: match[1],
    lat: match[2],
    address: match[3],
  };
}

function applyLocationInput(storage, user, locationInput) {
  const address = parseLocationInput(locationInput);
  if (!user.monitor) {
    user.monitor = {};
  }

  const presetAddress = Array.isArray(user.monitor.presetAddress) ? user.monitor.presetAddress : [];
  presetAddress[0] = address;
  user.monitor.presetAddress = presetAddress;
  writeStorage(storage);
}

function loadBuiltUserFunctions() {
  const userFunctionsPath = path.join(root, 'apps', 'server', 'build', 'functions', 'user.js');
  if (!fs.existsSync(userFunctionsPath)) {
    fail(`Missing build output: ${userFunctionsPath}. Run 'pnpm build' first.`);
  }
  return require(userFunctionsPath);
}

async function refreshSavedLogin(storage, user, credentials) {
  if (!credentials || !credentials.password) {
    return false;
  }

  const { userLogin } = loadBuiltUserFunctions();
  const phone = credentials.phone || user.phone;

  console.log(`[keep-monitor] Refreshing login for ${maskPhone(phone)} using ${credentials.source} credentials...`);
  const params = await userLogin(phone, credentials.password);

  if (typeof params === 'string') {
    console.log(`[keep-monitor] Login refresh failed: ${params}`);
    return false;
  }

  user.phone = phone;
  user.params = params;
  writeStorage(storage);
  console.log('[keep-monitor] Login refresh succeeded. Saved token was updated.');
  return true;
}

async function ensureFreshLogin(storage, user, credentials) {
  const { getIMParams } = loadBuiltUserFunctions();
  const result = await getIMParams(user.params);
  if (result !== 'AuthFailed') {
    return true;
  }

  console.log('[keep-monitor] Saved token appears to be expired.');
  return refreshSavedLogin(storage, user, credentials);
}

if (!Number.isInteger(options.userIndex) || options.userIndex < 0) {
  fail('Invalid --user-index value.');
}

if (!Number.isFinite(options.restartDelaySeconds) || options.restartDelaySeconds < 0) {
  fail('Invalid --restart-delay value.');
}

if (!fs.existsSync(monitorPath)) {
  fail(`Missing build output: ${monitorPath}. Run 'pnpm build' first.`);
}

if (!fs.existsSync(storagePath)) {
  fail(`Missing saved monitor config: ${storagePath}. Run 'pnpm monitor' once first.`);
}

let storage = loadStorage();
if (options.promptStart) {
  ensurePromptStartUser(storage);
}
let user = getSelectedUser(storage, options.promptStart);

if (options.setCredentials) {
  setEncryptedCredentials(user.phone);
  process.exit(0);
}

const maskedPhone = maskPhone(user.phone);
let credentials = null;
try {
  if (options.promptStart) {
    credentials = promptStartDetails(user.phone, getDefaultLocationInput(user));
    applyLocationInput(storage, user, credentials.location);
  } else {
    credentials = options.promptLogin ? promptLoginCredentials(user.phone) : loadEncryptedCredentials();
  }
} catch (error) {
  fail(`Could not load login credentials: ${error.message}`);
}

console.log(`[keep-monitor] Root: ${root}`);
console.log(`[keep-monitor] User: ${maskedPhone}`);
console.log(`[keep-monitor] Restart delay: ${options.restartDelaySeconds} seconds`);
console.log(`[keep-monitor] Location presets: ${getPresetAddressCount(user)} saved`);
console.log(`[keep-monitor] Auto re-login: ${credentials ? `enabled (${credentials.source})` : 'disabled'}`);

if (options.validateOnly) {
  console.log('[keep-monitor] Validation OK. Monitor was not started because --validate-only was set.');
  process.exit(0);
}

if (options.refreshLogin) {
  refreshSavedLogin(storage, user, credentials).then((ok) => process.exit(ok ? 0 : 1));
  return;
}

let child = null;
let stopping = false;
let promptLoginRefreshed = false;
let restartTimer = null;

function stopAndExit(signal) {
  stopping = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (child && !child.killed) {
    child.kill(signal);
    return;
  }
  process.exit(signal === 'SIGINT' ? 130 : 0);
}

process.on('SIGINT', () => stopAndExit('SIGINT'));
process.on('SIGTERM', () => stopAndExit('SIGTERM'));

function scheduleStart() {
  if (stopping || restartTimer) return;
  console.log(`[keep-monitor] Restarting in ${options.restartDelaySeconds} seconds. Press Ctrl+C to stop.`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startMonitor();
  }, options.restartDelaySeconds * 1000);
}

async function startMonitor() {
  try {
    storage = loadStorage();
    user = getSelectedUser(storage);

    if (credentials) {
      const ok = (options.promptLogin || options.promptStart) && !promptLoginRefreshed
        ? await refreshSavedLogin(storage, user, credentials)
        : await ensureFreshLogin(storage, user, credentials);
      if (!ok) {
        console.log('[keep-monitor] Re-login failed.');
        scheduleStart();
        return;
      }
      if (options.promptLogin || options.promptStart) {
        promptLoginRefreshed = true;
        storage = loadStorage();
        user = getSelectedUser(storage);
      }
    }

    const payloadBase64 = Buffer.from(JSON.stringify(getMonitorPayload(user)), 'utf8').toString('base64');
    const startedAt = new Date().toLocaleString();
    console.log(`[keep-monitor] Starting monitor at ${startedAt}...`);

    child = spawn(process.execPath, [monitorPath, '--auth', '-', payloadBase64], {
      cwd: root,
      stdio: 'inherit',
    });

    child.once('error', (error) => {
      console.log(`[keep-monitor] Could not start monitor: ${formatError(error)}`);
      child = null;
      scheduleStart();
    });

    child.on('exit', (code, signal) => {
      const stoppedAt = new Date().toLocaleString();
      console.log(`[keep-monitor] Monitor stopped at ${stoppedAt} with code ${code} signal ${signal || 'none'}.`);
      child = null;

      if (stopping) {
        process.exit(code || 0);
      }

      scheduleStart();
    });
  } catch (error) {
    child = null;
    console.log(`[keep-monitor] Monitor startup failed: ${formatError(error)}`);
    scheduleStart();
  }
}

startMonitor().catch((error) => {
  console.log(`[keep-monitor] Monitor startup failed: ${formatError(error)}`);
  scheduleStart();
});
