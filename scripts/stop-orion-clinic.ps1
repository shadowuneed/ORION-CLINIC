$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$runtimeRoot = Join-Path $projectRoot ".orion-runtime"

function Get-DescendantProcessIds([int]$RootPid) {
    $all = @(Get-CimInstance Win32_Process)
    $pending = [Collections.Generic.Queue[int]]::new()
    $pending.Enqueue($RootPid)
    $descendants = [Collections.Generic.List[int]]::new()
    while ($pending.Count -gt 0) {
        $parent = $pending.Dequeue()
        foreach ($child in $all | Where-Object { $_.ParentProcessId -eq $parent }) {
            $descendants.Add([int]$child.ProcessId)
            $pending.Enqueue([int]$child.ProcessId)
        }
    }
    return @($descendants)
}

function Stop-OrionProcess([string]$PidFile, [string]$Label, [int]$Port) {
    $pidValue = 0
    if (Test-Path -LiteralPath $PidFile) {
        $rawPid = (Get-Content -LiteralPath $PidFile -Raw).Trim()
        if (-not [int]::TryParse($rawPid, [ref]$pidValue)) {
            throw "$Label PID file is invalid; nothing was stopped."
        }
    }

    $process = if ($pidValue -gt 0) {
        Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction SilentlyContinue
    } else { $null }

    if ($null -eq $process) {
        $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -eq $listener) {
            Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
            Write-Host "${Label}: not running."
            return
        }
        $pidValue = [int]$listener.OwningProcess
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction Stop
    }

    $commandLine = [string]$process.CommandLine
    $belongsToCheckout = $commandLine.IndexOf($projectRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0
    $isSpeechListener = $Port -eq 3101 -and $commandLine.IndexOf("orion_local.main:app", [StringComparison]::OrdinalIgnoreCase) -ge 0
    if (-not $belongsToCheckout -and -not $isSpeechListener) {
        throw "$Label PID $pidValue does not belong to this ORION checkout; nothing was stopped."
    }

    $descendants = @(Get-DescendantProcessIds $pidValue)
    [array]::Reverse($descendants)
    foreach ($childPid in $descendants) {
        Stop-Process -Id $childPid -Force -ErrorAction SilentlyContinue
    }
    Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    Write-Host "$Label stopped (PID $pidValue)."
}

Stop-OrionProcess (Join-Path $runtimeRoot "web.pid") "ORION web" 3200
Stop-OrionProcess (Join-Path $runtimeRoot "speech.pid") "Local STT" 3101
