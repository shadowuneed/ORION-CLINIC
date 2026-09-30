import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const launcher = fileURLToPath(new URL('../../scripts/start-orion-clinic.ps1', import.meta.url));
const oldLogs = ['speech.out.log', 'speech.err.log', 'web.out.log', 'web.err.log'];

type Scenario = {
  skip?: boolean;
  speechReady?: boolean;
  webReady?: boolean;
  occupied?: number;
  missingPython?: boolean;
  failMigration?: boolean;
  failBootstrap?: boolean;
  failWeb?: boolean;
  staleLock?: boolean;
};
type Result = {
  error: string | null;
  pnpm: string[];
  launches: { role: string; hidden: string; out: string; err: string }[];
  removed: string[];
  logNames: string[];
  preservedLogs: boolean[];
  lockExists: boolean;
};

// Execute the actual launcher in a disposable checkout. The harness intercepts
// every network/process/provider operation; no service or DB process can start.
// The child receives OS execution paths only, never the main project's secrets.
const harness = String.raw`
param([string]$FixtureRoot, [string]$ScenarioJson)
$ErrorActionPreference = 'Stop'
$global:OrionHarnessScenario = $ScenarioJson | ConvertFrom-Json
$global:OrionHarnessPnpmCalls = [Collections.Generic.List[string]]::new()
$global:OrionHarnessLaunches = [Collections.Generic.List[object]]::new()
$global:OrionHarnessRemoved = [Collections.Generic.List[string]]::new()
$global:OrionHarnessSpeechStarted = $false
$global:OrionHarnessWebStarted = $false
function Invoke-OrionTestPnpm {
    param([string]$Command)
    $global:OrionHarnessPnpmCalls.Add($Command)
    $global:LASTEXITCODE = if (($Command -eq 'db:migrate:local' -and $global:OrionHarnessScenario.failMigration) -or ($Command -eq 'db:bootstrap:local' -and $global:OrionHarnessScenario.failBootstrap)) { 1 } else { 0 }
}
function Get-NetTCPConnection {
    [CmdletBinding()] param([string]$State, [int]$LocalPort)
    if ($global:OrionHarnessScenario.occupied -eq $LocalPort -or ($LocalPort -eq 3200 -and $global:OrionHarnessScenario.webReady)) { [pscustomobject]@{ OwningProcess = 12345 } }
}
function Get-CimInstance {
    [CmdletBinding()] param([string]$ClassName, [string]$Filter)
    if ($Filter -eq 'ProcessId = 12345') { [pscustomobject]@{ CommandLine = $FixtureRoot } }
}
function Get-Process {
    [CmdletBinding()] param([int]$Id)
    [pscustomobject]@{ ProcessName = 'occupied-test-service' }
}
function Test-Path {
    [CmdletBinding()] param([string]$LiteralPath, [string]$Path)
    $target = if ($LiteralPath) { $LiteralPath } else { $Path }
    if ($target -eq (Join-Path $env:LOCALAPPDATA 'ORION\python-env\Scripts\python.exe')) { return -not $global:OrionHarnessScenario.missingPython }
    if (-not $target.StartsWith($FixtureRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected path outside fixture.' }
    Microsoft.PowerShell.Management\Test-Path -LiteralPath $target
}
function Invoke-RestMethod {
    param([string]$Uri, [int]$TimeoutSec)
    if ($Uri -ne 'http://127.0.0.1:3101/health') { throw 'Unexpected health URL.' }
    if (-not ($global:OrionHarnessScenario.speechReady -or $global:OrionHarnessSpeechStarted)) { throw 'Not started.' }
    [pscustomobject]@{ service = 'orion-local-speech'; status = 'ok'; stt = @{ status = 'ready' }; speaker = @{ status = 'ready' } }
}
function Invoke-WebRequest {
    param([switch]$UseBasicParsing, [string]$Uri, [int]$TimeoutSec)
    if ($Uri -eq 'http://localhost:3200/' -and ($global:OrionHarnessScenario.webReady -or $global:OrionHarnessWebStarted) -and -not $global:OrionHarnessScenario.failWeb) { return [pscustomobject]@{ StatusCode = 200 } }
    if ($Uri -eq 'http://127.0.0.1:3101/health' -and ($global:OrionHarnessScenario.speechReady -or $global:OrionHarnessSpeechStarted)) { return [pscustomobject]@{ StatusCode = 200 } }
    throw 'Not started.'
}
function Start-Process {
    param([string]$FilePath, [string[]]$ArgumentList, [string]$WorkingDirectory, [string]$WindowStyle, [string]$RedirectStandardOutput, [string]$RedirectStandardError, [switch]$PassThru)
    if ($FilePath -ne 'powershell.exe' -or $WorkingDirectory -ne $FixtureRoot) { throw 'Unexpected process target.' }
    $role = if (($ArgumentList -join ' ') -match 'run-orion-web\.ps1') { 'web' } else { 'speech' }
    $global:OrionHarnessLaunches.Add([pscustomobject]@{ role = $role; hidden = $WindowStyle; out = $RedirectStandardOutput; err = $RedirectStandardError })
    if ($role -eq 'web') { $global:OrionHarnessWebStarted = $true } else { $global:OrionHarnessSpeechStarted = $true }
    [pscustomobject]@{ Id = 12345; HasExited = ($role -eq 'web' -and $global:OrionHarnessScenario.failWeb) }
}
function Remove-Item {
    [CmdletBinding()] param([string[]]$LiteralPath, [switch]$Force)
    foreach ($target in $LiteralPath) {
        if (-not $target.StartsWith($FixtureRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected removal outside fixture.' }
        $global:OrionHarnessRemoved.Add($target)
        Microsoft.PowerShell.Management\Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
    }
}
function Start-Sleep { param([int]$Milliseconds) throw 'Unexpected readiness polling in harness.' }
$launchError = $null
try { & (Join-Path $FixtureRoot 'scripts\start-orion-clinic.ps1') -SkipDataInitialization:$global:OrionHarnessScenario.skip } catch { $launchError = $_.Exception.Message }
$logDir = Join-Path $FixtureRoot '.orion-runtime\logs'
$preserved = @('speech.out.log', 'speech.err.log', 'web.out.log', 'web.err.log') | ForEach-Object {
    $path = Join-Path $logDir $_
    (Microsoft.PowerShell.Management\Test-Path -LiteralPath $path) -and ((Get-Content -LiteralPath $path -Raw) -eq 'previous evidence')
}
$result = @{ error = $launchError; pnpm = @($global:OrionHarnessPnpmCalls.ToArray()); launches = @($global:OrionHarnessLaunches.ToArray()); removed = @($global:OrionHarnessRemoved.ToArray()); logNames = @(Get-ChildItem -LiteralPath $logDir -Directory | Select-Object -ExpandProperty Name); preservedLogs = @($preserved); lockExists = (Microsoft.PowerShell.Management\Test-Path -LiteralPath (Join-Path $FixtureRoot '.vinext\dev\lock.json')) }
Write-Output ('ORION_RESULT=' + ($result | ConvertTo-Json -Depth 6 -Compress))
`;

function run(scenario: Scenario = {}): Result {
  const root = mkdtempSync(join(tmpdir(), 'orion-launcher-test-'));
  const parent = realpathSync(tmpdir());
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, '.orion-runtime/logs'), { recursive: true });
    copyFileSync(launcher, join(root, 'scripts/start-orion-clinic.ps1'));
    writeFileSync(join(root, 'scripts/resolve-local-runtime.ps1'),
      'function Resolve-OrionLocalRuntime { [pscustomobject]@{ NodeBin=$PSScriptRoot; Pnpm="Invoke-OrionTestPnpm" } }');
    for (const name of oldLogs) writeFileSync(join(root, '.orion-runtime/logs', name), 'previous evidence');
    if (scenario.staleLock) {
      mkdirSync(join(root, '.vinext/dev'), { recursive: true });
      writeFileSync(join(root, '.vinext/dev/lock.json'), JSON.stringify({ pid: 23456 }));
    }
    const harnessPath = join(root, 'harness.ps1');
    writeFileSync(harnessPath, harness);
    const env: NodeJS.ProcessEnv = { LOCALAPPDATA: join(root, 'local-app-data'), NODE_ENV: 'test' };
    for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'COMSPEC']) {
      if (process.env[key]) env[key] = process.env[key];
    }
    const complete = { skip: false, speechReady: false, webReady: false, occupied: 0, missingPython: false, failMigration: false, failBootstrap: false, failWeb: false, staleLock: false, ...scenario };
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harnessPath, '-FixtureRoot', root, '-ScenarioJson', JSON.stringify(complete)],
      { encoding: 'utf8', env, cwd: root, timeout: 4000, windowsHide: true });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const match = /^ORION_RESULT=(.+)$/m.exec(result.stdout);
    expect(match, result.stdout + result.stderr).not.toBeNull();
    return JSON.parse(match![1]!) as Result;
  } finally {
    // Only this test's newly allocated fixture may be recursively removed.
    const resolved = realpathSync(root);
    if (dirname(resolved) !== parent || !basename(resolved).startsWith('orion-launcher-test-')) throw new Error('Unsafe fixture cleanup target.');
    rmSync(resolved, { recursive: true, force: true });
  }
}

describe('Windows local launcher recovery contract', () => {
  it('keeps recovery an explicit opt-in switch', () => {
    const source = readFileSync(launcher, 'utf8');
    expect(source).toContain('[switch]$SkipDataInitialization');
    expect(source).not.toMatch(/\$SkipDataInitialization\s*=\s*\$true/i);
  });

  // Actual PowerShell execution is Windows-specific. Static opt-in contract above
  // remains checked on other CI systems; there is no pretend shell-success stub.
  describe.skipIf(process.platform !== 'win32')('isolated actual PowerShell', () => {
    it('skips all data commands and preserves old logs in a fresh recovery directory', () => {
      const result = run({ skip: true });
      expect(result.error).toBeNull();
      expect(result.pnpm).toEqual([]);
      expect(result.removed).toEqual([]);
      expect(result.preservedLogs).toEqual([true, true, true, true]);
      expect(result.logNames).toHaveLength(1);
      expect(result.logNames[0]).toMatch(/^recovery-\d{8}-\d{6}-\d{3}-[a-f0-9]{32}$/);
      expect(result.launches.map(item => item.role)).toEqual(['speech', 'web']);
      for (const item of result.launches) {
        expect(item.hidden).toBe('Hidden');
        expect(dirname(item.out)).toBe(dirname(item.err));
        expect(basename(dirname(item.out))).toBe(result.logNames[0]);
      }
    });

    it('preserves the default migration then bootstrap behavior', () => {
      const result = run();
      expect(result.error).toBeNull();
      expect(result.pnpm).toEqual(['db:migrate:local', 'db:bootstrap:local']);
      expect(result.logNames).toEqual([]);
      expect(result.removed.map(item => basename(item))).toEqual(oldLogs);
      expect(result.launches).toHaveLength(2);
    });

    it('leaves existing Vinext lock metadata to Vinext in recovery mode', () => {
      const result = run({ skip: true, staleLock: true });
      expect(result.error).toBeNull();
      expect(result.lockExists).toBe(true);
      expect(result.removed).toEqual([]);
      expect(result.pnpm).toEqual([]);
    });

    it('preserves default stale lock cleanup behavior', () => {
      const result = run({ staleLock: true });
      expect(result.error).toBeNull();
      expect(result.lockExists).toBe(false);
      expect(result.removed.map(item => basename(item))).toEqual(['lock.json', ...oldLogs]);
    });

    it.each(['speechReady', 'webReady'] as const)('reuses the ready service: %s', ready => {
      const result = run({ skip: true, [ready]: true });
      expect(result.error).toBeNull();
      expect(result.pnpm).toEqual([]);
      expect(result.launches.map(item => item.role)).toEqual([ready === 'speechReady' ? 'web' : 'speech']);
      expect(result.preservedLogs.every(Boolean)).toBe(true);
    });

    it('does nothing when both services are already ready', () => {
      const result = run({ skip: true, speechReady: true, webReady: true });
      expect(result.error).toBeNull();
      expect(result.pnpm).toEqual([]);
      expect(result.launches).toEqual([]);
      expect(result.logNames).toEqual([]);
      expect(result.preservedLogs.every(Boolean)).toBe(true);
    });

    it.each([3200, 3101])('still refuses occupied port %s before any data/process change', occupied => {
      const result = run({ skip: true, occupied });
      expect(result.error).toContain(`port ${occupied} is already used`);
      expect(result.pnpm).toEqual([]);
      expect(result.launches).toEqual([]);
      expect(result.preservedLogs.every(Boolean)).toBe(true);
    });

    it('does not hide missing local speech installation', () => {
      const result = run({ skip: true, missingPython: true });
      expect(result.error).toContain('Local speech runtime is missing');
      expect(result.launches).toEqual([]);
      expect(result.pnpm).toEqual([]);
    });

    it.each(['failMigration', 'failBootstrap'] as const)('default initialization failure stops before launch: %s', failure => {
      const result = run({ [failure]: true });
      expect(result.error).toContain(failure === 'failMigration' ? 'Local D1 migration failed' : 'Local D1 bootstrap failed');
      expect(result.pnpm).toEqual(failure === 'failMigration' ? ['db:migrate:local'] : ['db:migrate:local', 'db:bootstrap:local']);
      expect(result.launches).toEqual([]);
      expect(result.preservedLogs.every(Boolean)).toBe(true);
    });

    it('reports the recovery-specific error log on startup failure', () => {
      const result = run({ skip: true, failWeb: true });
      expect(result.error).toContain('ORION web did not become ready');
      expect(result.error).toContain(result.launches.find(item => item.role === 'web')!.err);
      expect(result.preservedLogs.every(Boolean)).toBe(true);
    });
  });
});
