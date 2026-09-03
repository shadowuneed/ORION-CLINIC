param(
    [ValidateSet("Auto", "Cpu", "Cuda")][string]$Device = "Auto",
    [switch]$SkipSpeechModels
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "resolve-local-runtime.ps1")
$runtime = Resolve-OrionLocalRuntime
$env:Path = "$($runtime.NodeBin);$env:Path"

Write-Host "[1/4] Installing pinned web dependencies..."
Set-Location -LiteralPath $projectRoot
& $runtime.Pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed." }

Write-Host "[2/4] Applying local D1 migrations..."
& $runtime.Pnpm db:migrate:local
if ($LASTEXITCODE -ne 0) { throw "Local D1 migration failed." }

Write-Host "[3/4] Loading idempotent synthetic fixtures..."
& $runtime.Pnpm db:bootstrap:local
if ($LASTEXITCODE -ne 0) { throw "Local D1 bootstrap failed." }

Write-Host "[4/4] Preparing the local speech runtime..."
$speechSetup = Join-Path $projectRoot "services\local-speech\setup.ps1"
$speechArguments = @{ Device = $Device }
if ($SkipSpeechModels) { $speechArguments.SkipModels = $true }
& $speechSetup @speechArguments

Write-Host ""
Write-Host "ORION Clinic setup is complete."
Write-Host "If Groq is not configured yet, run CONFIGURE_GROQ.bat once."
Write-Host "Then run START_ORION.bat."
