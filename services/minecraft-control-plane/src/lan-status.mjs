import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';

const BEDROCK_PORT = 19132;
const BIND_ADDRESS = '0.0.0.0';
const POWERSHELL_TIMEOUT_MS = 5_000;
const MAX_POWERSHELL_OUTPUT_BYTES = 32 * 1024;

// This is deliberately a constant. The endpoint never accepts commands,
// process IDs, rule names, or executable paths from a caller. The only dynamic
// value is a validated list of Java ports derived from managed inventory and
// supplied through one private environment variable.
const WINDOWS_INSPECTION_COMMAND = String.raw`
$ErrorActionPreference = 'Stop'
$ruleGroup = 'Mastermind Family Server LAN'
$bedrockPort = 19132
$ruleGenerations = @(
  [pscustomobject]@{ Bedrock = 'Mastermind-Family-Bedrock-UDP-A'; Java = 'Mastermind-Family-Java-TCP-A' },
  [pscustomobject]@{ Bedrock = 'Mastermind-Family-Bedrock-UDP-B'; Java = 'Mastermind-Family-Java-TCP-B' },
  [pscustomobject]@{ Bedrock = 'Mastermind-Family-Bedrock-UDP'; Java = 'Mastermind-Family-Java-TCP' }
)
$result = [ordered]@{
  endpointKnown = $false
  occupied = $null
  pid = $null
  processName = $null
  firewallKnown = $false
  firewallRulesPresent = $null
  localSubnetOnly = $null
}

function Test-ExactLanRule {
  param(
    [object]$Rule,
    [string]$Protocol,
    [int[]]$AllowedPorts
  )

  if ($null -eq $Rule -or
      $Rule.Enabled.ToString() -ne 'True' -or
      $Rule.Direction.ToString() -ne 'Inbound' -or
      $Rule.Action.ToString() -ne 'Allow' -or
      $Rule.Profile.ToString() -ne 'Private') {
    return $false
  }

  $portFilters = @(Get-NetFirewallPortFilter -AssociatedNetFirewallRule $Rule -ErrorAction Stop)
  $addressFilters = @(Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $Rule -ErrorAction Stop)
  if ($portFilters.Count -ne 1 -or $addressFilters.Count -ne 1) {
    return $false
  }

  $localPorts = @($portFilters[0].LocalPort)
  $remoteAddresses = @($addressFilters[0].RemoteAddress)
  if ($portFilters[0].Protocol.ToString() -ne $Protocol -or
      $localPorts.Count -ne 1 -or
      $remoteAddresses.Count -ne 1 -or
      $remoteAddresses[0].ToString() -ne 'LocalSubnet') {
    return $false
  }

  $actualPort = $localPorts[0].ToString()
  return @($AllowedPorts | Where-Object { $_.ToString() -eq $actualPort }).Count -eq 1
}

try {
  $endpoint = Get-NetUDPEndpoint -LocalPort 19132 -ErrorAction Stop | Select-Object -First 1
  $result.endpointKnown = $true
  $result.occupied = $null -ne $endpoint
  if ($null -ne $endpoint) {
    $result.pid = [int]$endpoint.OwningProcess
    $process = Get-Process -Id $endpoint.OwningProcess -ErrorAction SilentlyContinue
    if ($null -ne $process) {
      $result.processName = [string]$process.ProcessName
    }
  }
} catch {
  if ($_.Exception.FullyQualifiedErrorId -match 'NoMatching') {
    $result.endpointKnown = $true
    $result.occupied = $false
  } else {
    $result.endpointKnown = $false
  }
}

try {
  $expectedJavaPorts = @()
  if (-not [string]::IsNullOrWhiteSpace($env:MASTERMIND_LAN_JAVA_PORTS)) {
    foreach ($part in $env:MASTERMIND_LAN_JAVA_PORTS.Split(',')) {
      [int]$parsedPort = 0
      if ([int]::TryParse($part, [ref]$parsedPort) -and $parsedPort -ge 1 -and $parsedPort -le 65535) {
        $expectedJavaPorts += $parsedPort
      }
    }
  }
  $expectedJavaPorts = @($expectedJavaPorts | Sort-Object -Unique)
  if ($expectedJavaPorts.Count -eq 0) { throw 'No managed Java port is available for exact inspection.' }

  $rules = @(Get-NetFirewallRule -PolicyStore ActiveStore -ErrorAction Stop |
    Where-Object { $_.Group -eq $ruleGroup })
  $expectedByName = @{}
  foreach ($generation in $ruleGenerations) {
    $expectedByName[$generation.Bedrock] = [pscustomobject]@{ Protocol = 'UDP'; Ports = @($bedrockPort) }
    $expectedByName[$generation.Java] = [pscustomobject]@{ Protocol = 'TCP'; Ports = $expectedJavaPorts }
  }

  $completeGeneration = $false
  foreach ($generation in $ruleGenerations) {
    $bedrockRules = @($rules | Where-Object { $_.Name -eq $generation.Bedrock })
    $javaRules = @($rules | Where-Object { $_.Name -eq $generation.Java })
    if ($bedrockRules.Count -eq 1 -and $javaRules.Count -eq 1 -and
        (Test-ExactLanRule $bedrockRules[0] 'UDP' @($bedrockPort)) -and
        (Test-ExactLanRule $javaRules[0] 'TCP' $expectedJavaPorts)) {
      $completeGeneration = $true
    }
  }

  $allRulesExact = $rules.Count -gt 0
  foreach ($rule in $rules) {
    if (-not $expectedByName.ContainsKey([string]$rule.Name)) {
      $allRulesExact = $false
      continue
    }
    $expected = $expectedByName[[string]$rule.Name]
    if (-not (Test-ExactLanRule $rule $expected.Protocol $expected.Ports)) {
      $allRulesExact = $false
    }
  }

  $result.firewallKnown = $true
  $result.firewallRulesPresent = $completeGeneration
  $result.localSubnetOnly = $completeGeneration -and $allRulesExact
} catch {
  $result.firewallKnown = $false
  $result.firewallRulesPresent = $null
  $result.localSubnetOnly = $null
}

$result | ConvertTo-Json -Compress
`;

const VIRTUAL_INTERFACE_NAME = /(?:loopback|vethernet|hyper-v|docker|wsl|virtual|vmware|virtualbox|vbox|tailscale|zerotier|\btun\b|\btap\b|\bvpn\b|npcap|wi-fi direct)/i;

export function isPrivateIpv4(address) {
  if (typeof address !== 'string' || net.isIP(address) !== 4) return false;
  const [first, second] = address.split('.').map(Number);
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

export function privateLanAddresses(interfaces = os.networkInterfaces()) {
  const addresses = new Set();
  for (const [name, entries] of Object.entries(interfaces ?? {})) {
    if (VIRTUAL_INTERFACE_NAME.test(name)) continue;
    for (const entry of entries ?? []) {
      const family = entry?.family;
      if ((family === 'IPv4' || family === 4) && entry.internal !== true && isPrivateIpv4(entry.address)) {
        addresses.add(entry.address);
      }
    }
  }
  return [...addresses].sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));
}

function validProcessName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || name.length > 128 || /[\x00-\x1f\x7f\\/:<>"|]/.test(name)) return null;
  return name;
}

export function normalizeWindowsInspection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const pid = Number.isInteger(value.pid) && value.pid > 0 && value.pid <= 0xffffffff ? value.pid : null;
  return {
    endpointKnown: value.endpointKnown === true,
    occupied: value.occupied === true,
    pid,
    processName: validProcessName(value.processName),
    firewallKnown: value.firewallKnown === true,
    firewallRulesPresent: value.firewallKnown === true && typeof value.firewallRulesPresent === 'boolean'
      ? value.firewallRulesPresent
      : null,
    localSubnetOnly: value.firewallKnown === true && typeof value.localSubnetOnly === 'boolean'
      ? value.localSubnetOnly
      : null,
  };
}

function managedJavaPorts(options) {
  const supplied = [options?.javaPort, ...(Array.isArray(options?.javaPorts) ? options.javaPorts : [])];
  return [...new Set(supplied.filter((port) => Number.isInteger(port) && port >= 1 && port <= 65535))]
    .sort((left, right) => left - right);
}

function runFixedPowerShell(javaPorts) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let outputBytes = 0;
    const child = spawn('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      WINDOWS_INSPECTION_COMMAND,
    ], {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, MASTERMIND_LAN_JAVA_PORTS: javaPorts.join(',') },
    });

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, POWERSHELL_TIMEOUT_MS);
    timer.unref?.();

    child.once('error', () => finish(null));
    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_POWERSHELL_OUTPUT_BYTES) {
        child.kill();
        finish(null);
        return;
      }
      stdout += chunk.toString('utf8');
    });
    child.once('exit', (code) => {
      if (code !== 0) return finish(null);
      try {
        finish(normalizeWindowsInspection(JSON.parse(stdout.trim())));
      } catch {
        finish(null);
      }
    });
  });
}

export async function inspectOwnerWithNetstat() {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    const child = spawn('netstat.exe', ['-ano', '-p', 'udp'], {
      windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => { child.kill(); finish(null); }, POWERSHELL_TIMEOUT_MS);
    timer.unref?.();
    child.once('error', () => finish(null));
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (Buffer.byteLength(stdout) > MAX_POWERSHELL_OUTPUT_BYTES) { child.kill(); finish(null); }
    });
    child.once('exit', (code) => {
      if (code !== 0) return finish(null);
      const line = stdout.split(/\r?\n/).find((entry) => /^\s*UDP\s+(?:0\.0\.0\.0|\[::\]):19132\s+/i.test(entry));
      const match = line?.match(/\s(\d+)\s*$/);
      finish(match ? Number(match[1]) : null);
    });
  }).then(async (pid) => {
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return { pid, processName: null };
  });
}

export async function inspectWindowsLan(javaPorts = []) {
  if (process.platform !== 'win32') return null;
  return runFixedPowerShell(managedJavaPorts({ javaPorts }));
}

export function probeGeyserPort() {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: false });
    let settled = false;

    const finish = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(status);
    };

    const timer = setTimeout(() => {
      try { socket.close(); } catch { /* The socket may not have bound. */ }
      finish('unknown');
    }, 2_000);
    timer.unref?.();

    socket.once('error', (error) => {
      try { socket.close(); } catch { /* The socket may not have bound. */ }
      finish(error?.code === 'EADDRINUSE' ? 'occupied' : 'unknown');
    });
    socket.bind({ address: BIND_ADDRESS, port: BEDROCK_PORT, exclusive: true }, () => {
      socket.close(() => finish('available'));
    });
  });
}

export async function getLanStatus(options = {}) {
  const interfaces = options.networkInterfaces ?? os.networkInterfaces();
  const probe = options.probe ?? probeGeyserPort;
  const inspectWindows = options.inspectWindows ?? inspectWindowsLan;
  const javaPorts = managedJavaPorts(options);
  const [probeResult, windowsResult, netstatResult] = await Promise.allSettled([
    probe(), inspectWindows(javaPorts), process.platform === 'win32' ? inspectOwnerWithNetstat() : Promise.resolve(null),
  ]);
  const probeStatus = probeResult.status === 'fulfilled' && ['available', 'occupied', 'unknown'].includes(probeResult.value)
    ? probeResult.value
    : 'unknown';
  const windows = windowsResult.status === 'fulfilled' ? normalizeWindowsInspection(windowsResult.value) : null;
  const netstatOwner = netstatResult.status === 'fulfilled' ? netstatResult.value : null;

  let portStatus = probeStatus;
  if (windows?.endpointKnown && windows.occupied) portStatus = 'occupied';
  else if (portStatus === 'unknown' && windows?.endpointKnown && !windows.occupied) portStatus = 'available';

  const status = {
    bindAddress: BIND_ADDRESS,
    addresses: privateLanAddresses(interfaces),
    bedrockPort: BEDROCK_PORT,
    portStatus,
    firewallRulesPresent: windows?.firewallRulesPresent ?? null,
    localSubnetOnly: windows?.localSubnetOnly ?? null,
    checkedAt: new Date().toISOString(),
  };

  const owner = windows?.occupied && (windows.pid || windows.processName)
    ? { pid: windows.pid, processName: windows.processName }
    : netstatOwner;
  if (portStatus === 'occupied' && owner && (owner.pid || owner.processName)) {
    status.owner = {
      ...(owner.pid ? { pid: owner.pid } : {}),
      ...(owner.processName ? { processName: owner.processName } : {}),
    };
  }
  return status;
}
