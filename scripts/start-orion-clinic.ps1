param(
    [ValidateSet("Auto", "Cpu", "Cuda")][string]$Device = "Auto"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "resolve-local-runtime.ps1")
$runtime = Resolve-OrionLocalRuntime
$env:Path = "$($runtime.NodeBin);$env:Path"
$runtimeRoot = Join-Path $projectRoot ".orion-runtime"
$logRoot = Join-Path $runtimeRoot "logs"
New-Item -ItemType Directory -Force -Path $runtimeRoot, $logRoot | Out-Null

function Assert-PortFree([int]$Port, [string]$ServiceName) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $listener) {
        $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
        $processName = if ($null -ne $process) { $process.ProcessName } else { "unknown" }
        throw "$ServiceName cannot start: port $Port is already used by PID $($listener.OwningProcess) ($processName). ORION did not stop or replace it."
    }
}

function Remove-StaleVinextLock {
    $lockPath = Join-Path $projectRoot ".vinext\dev\lock.json"
    if (-not (Test-Path -LiteralPath $lockPath)) { return }

    $listener = Get-NetTCPConnection -State Listen -LocalPort 3200 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $listener) { return }

    try {
        $lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
        $lockedProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$lock.pid)" -ErrorAction SilentlyContinue
        $lockedCommandLine = if ($null -ne $lockedProcess) { [string]$lockedProcess.CommandLine } else { "" }
        $belongsToCheckout = $lockedCommandLine.IndexOf(
            $projectRoot,
            [StringComparison]::OrdinalIgnoreCase
        ) -ge 0

        if ($belongsToCheckout) {
            throw "Vinext process PID $($lock.pid) still belongs to this checkout but is not listening on port 3200. Stop it before retrying."
        }

        Remove-Item -LiteralPath $lockPath -Force
        Write-Host "Removed a stale Vinext lock for this checkout (recorded PID $($lock.pid))."
    } catch {
        throw "Cannot safely clear Vinext lock '$lockPath': $($_.Exception.Message)"
    }
}

function Test-HttpReady([string]$Url, [int]$TimeoutSec = 5) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec $TimeoutSec
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
    } catch {
        return $false
    }
}

function Test-OrionSpeechReady {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:3101/health" -TimeoutSec 5
        return (
            $health.service -eq "orion-local-speech" -and
            $health.status -eq "ok" -and
            $health.stt.status -eq "ready" -and
            $health.speaker.status -eq "ready"
        )
    } catch {
        return $false
    }
}

function Test-OrionWebReady {
    $listener = Get-NetTCPConnection -State Listen -LocalPort 3200 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $listener) { return $false }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
    if ($null -eq $process) { return $false }
    $belongsToCheckout = ([string]$process.CommandLine).IndexOf(
        $projectRoot,
        [StringComparison]::OrdinalIgnoreCase
    ) -ge 0
    return $belongsToCheckout -and (Test-HttpReady "http://localhost:3200/")
}

$speechAlreadyReady = Test-OrionSpeechReady
$webAlreadyReady = Test-OrionWebReady
if ($speechAlreadyReady -and $webAlreadyReady) {
    Write-Host "ORION Clinic is already running."
    Write-Host "Web:  http://localhost:3200/"
    Write-Host "STT:  http://127.0.0.1:3101/health"
    Write-Host "Logs: $logRoot"
    Write-Host "Stop: STOP_ORION_CLINIC.bat"
    exit 0
}

if (-not $speechAlreadyReady) {
    Assert-PortFree 3101 "Local speech"
}
if (-not $webAlreadyReady) {
    Remove-StaleVinextLock
    Assert-PortFree 3200 "ORION web"
}

$speechPython = Join-Path $env:LOCALAPPDATA "ORION\python-env\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $speechPython)) {
    throw "Local speech runtime is missing. Run SETUP_ORION_CLINIC.bat first."
}

Set-Location -LiteralPath $projectRoot
Write-Host "Applying local D1 migrations and application bootstrap..."
& $runtime.Pnpm db:migrate:local
if ($LASTEXITCODE -ne 0) { throw "Local D1 migration failed." }
& $runtime.Pnpm db:bootstrap:local
if ($LASTEXITCODE -ne 0) { throw "Local D1 bootstrap failed." }

$devVars = Join-Path $projectRoot ".dev.vars"
$groqConfigured =
    (Test-Path -LiteralPath $devVars) -and
    (Select-String -LiteralPath $devVars -Pattern '^\s*GROQ_API_KEY\s*=\s*gsk_' -Quiet)
if (-not $groqConfigured) {
    Write-Warning "Groq is not configured. STT and clinical records will work, but real AI drafts require CONFIGURE_GROQ.bat and a restart."
}

$speechOut = Join-Path $logRoot "speech.out.log"
$speechErr = Join-Path $logRoot "speech.err.log"
$webOut = Join-Path $logRoot "web.out.log"
$webErr = Join-Path $logRoot "web.err.log"
Remove-Item -LiteralPath $speechOut, $speechErr, $webOut, $webErr -Force -ErrorAction SilentlyContinue

$speechProcess = $null
if ($speechAlreadyReady) {
    Write-Host "Reusing ready local STT on 127.0.0.1:3101."
} else {
    Write-Host "Starting local STT on 127.0.0.1:3101..."
    $speechProcess = Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        (Join-Path $projectRoot "services\local-speech\start.ps1"),
        "-Device", $Device
    ) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $speechOut -RedirectStandardError $speechErr -PassThru
    Set-Content -LiteralPath (Join-Path $runtimeRoot "speech.pid") -Value $speechProcess.Id -Encoding ASCII
}

$webProcess = $null
if ($webAlreadyReady) {
    Write-Host "Reusing ORION Clinic on 127.0.0.1:3200."
} else {
    Write-Host "Starting ORION Clinic on 127.0.0.1:3200..."
    $webProcess = Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        (Join-Path $projectRoot "scripts\run-orion-web.ps1"),
        "-ProjectRoot", $projectRoot,
        "-PnpmPath", $runtime.Pnpm,
        "-NodeBin", $runtime.NodeBin
    ) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $webOut -RedirectStandardError $webErr -PassThru
    Set-Content -LiteralPath (Join-Path $runtimeRoot "web.pid") -Value $webProcess.Id -Encoding ASCII
}

$webReady = $webAlreadyReady
for ($attempt = 0; -not $webReady -and $attempt -lt 120; $attempt += 1) {
    if ($null -ne $webProcess -and $webProcess.HasExited) { break }
    if (Test-HttpReady "http://localhost:3200/") { $webReady = $true; break }
    Start-Sleep -Milliseconds 500
}
if (-not $webReady) {
    throw "ORION web did not become ready. Inspect .orion-runtime\logs\web.err.log."
}

$speechReachable = $speechAlreadyReady
for ($attempt = 0; -not $speechReachable -and $attempt -lt 60; $attempt += 1) {
    if ($null -ne $speechProcess -and $speechProcess.HasExited) { break }
    if (Test-HttpReady "http://127.0.0.1:3101/health") { $speechReachable = $true; break }
    Start-Sleep -Milliseconds 500
}
if (-not $speechReachable) {
    throw "Local speech service did not become reachable. Inspect .orion-runtime\logs\speech.err.log."
}

Write-Host ""
Write-Host "ORION Clinic is running."
Write-Host "Web:  http://localhost:3200/"
Write-Host "STT:  http://127.0.0.1:3101/health"
Write-Host "Logs: $logRoot"
Write-Host "Stop: STOP_ORION_CLINIC.bat"
if (-not $groqConfigured) { Write-Host "AI:   not configured (run CONFIGURE_GROQ.bat, then restart)" }
