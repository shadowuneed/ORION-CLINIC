param(
    [ValidateSet("Auto", "Cpu", "Cuda")]
    [string]$Device = "Auto",
    [string]$CudaWheelIndex = "https://download.pytorch.org/whl/cu128",
    [switch]$SkipModels,
    [switch]$CacheBothSttModels,
    [string]$RuntimeDir = (Join-Path $env:LOCALAPPDATA "ORION")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvDir = Join-Path $RuntimeDir "python-env"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$ModelDir = Join-Path $RuntimeDir "models"

New-Item -ItemType Directory -Force -Path $RuntimeDir, $ModelDir | Out-Null
$env:ORION_MODEL_DIR = $ModelDir
$env:ORION_HF_CACHE_DIR = Join-Path $ModelDir "huggingface"

if (-not (Test-Path -LiteralPath $VenvPython)) {
    $PyLauncher = Get-Command py -ErrorAction SilentlyContinue
    if ($null -ne $PyLauncher) {
        & $PyLauncher.Source -3 -m venv $VenvDir
    } else {
        $SystemPython = Get-Command python -ErrorAction Stop
        & $SystemPython.Source -m venv $VenvDir
    }
}

& $VenvPython -m pip install --upgrade pip wheel

$ResolvedDevice = $Device
if ($Device -eq "Auto") {
    $ResolvedDevice = if ($null -ne (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) {
        "Cuda"
    } else {
        "Cpu"
    }
}

$TorchIndex = if ($ResolvedDevice -eq "Cuda") {
    $CudaWheelIndex
} else {
    "https://download.pytorch.org/whl/cpu"
}

& $VenvPython -m pip install "torch>=2.10,<2.11" "torchaudio>=2.10,<2.11" --index-url $TorchIndex
& $VenvPython -m pip install --requirement (Join-Path $ProjectDir "requirements.txt")

if (-not $SkipModels) {
    $DownloadArgs = @(
        (Join-Path $ProjectDir "download_models.py"),
        "--device",
        $ResolvedDevice.ToLowerInvariant()
    )
    if ($CacheBothSttModels) {
        $DownloadArgs += "--all-stt"
    }
    & $VenvPython @DownloadArgs
}

Write-Host "ORION local speech is ready. Start with:"
Write-Host "  .\services\local-speech\start.ps1 -Device $ResolvedDevice"
