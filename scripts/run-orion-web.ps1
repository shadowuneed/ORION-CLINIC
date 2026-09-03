param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [Parameter(Mandatory = $true)][string]$PnpmPath,
    [Parameter(Mandatory = $true)][string]$NodeBin
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$env:Path = "$NodeBin;$env:Path"
Set-Location -LiteralPath $ProjectRoot
& $PnpmPath exec vinext dev --hostname 127.0.0.1 --port 3200
exit $LASTEXITCODE
