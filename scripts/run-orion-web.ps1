param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [Parameter(Mandatory = $true)][string]$PnpmPath,
    [Parameter(Mandatory = $true)][string]$NodeBin
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$env:Path = "$NodeBin;$env:Path"
Set-Location -LiteralPath $ProjectRoot
# Resume only the initialized ORION PostgreSQL cluster. Never migrate or seed at startup.
$crmMarker = Join-Path $env:LOCALAPPDATA 'ORION-Clinic-CRM\cluster-owner.json'
if (Test-Path -LiteralPath $crmMarker) {
    & (Join-Path $NodeBin 'node.exe') scripts/crm-local-postgres.mjs start
    if ($LASTEXITCODE -ne 0) { throw 'ORION PostgreSQL unavailable. Startup stopped; legacy data fallback is forbidden.' }
}
& $PnpmPath exec vinext dev --hostname 127.0.0.1 --port 3200
exit $LASTEXITCODE
