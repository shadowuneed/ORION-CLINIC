param(
    [ValidateSet("Auto", "Cpu", "Cuda")]
    [string]$Device = "Auto",
    [switch]$AllowModelDownload,
    [switch]$Reload,
    [string]$RuntimeDir = (Join-Path $env:LOCALAPPDATA "ORION")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvPython = Join-Path $RuntimeDir "python-env\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $VenvPython)) {
    throw "Virtual environment is missing. Run .\services\local-speech\setup.ps1 first."
}

$env:ORION_STT_DEVICE = $Device.ToLowerInvariant()
$env:ORION_ALLOW_MODEL_DOWNLOAD = if ($AllowModelDownload) { "1" } else { "0" }
$env:ORION_MODEL_DIR = Join-Path $RuntimeDir "models"
$env:ORION_HF_CACHE_DIR = Join-Path $env:ORION_MODEL_DIR "huggingface"

$UvicornArgs = @(
    "-m", "uvicorn",
    "orion_local.main:app",
    "--app-dir", $ProjectDir,
    "--host", "127.0.0.1",
    "--port", "3101",
    "--no-access-log",
    "--limit-concurrency", "8",
    "--timeout-keep-alive", "5"
)
if ($Reload) {
    $UvicornArgs += "--reload"
}

Write-Host "ORION local speech: http://127.0.0.1:3101"
& $VenvPython @UvicornArgs
