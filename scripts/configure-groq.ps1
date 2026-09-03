$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$target = Join-Path $projectRoot ".dev.vars"

$secureKey = Read-Host "Paste a NEW Groq API key (it will not be displayed)" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
    $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ([string]::IsNullOrWhiteSpace($plainKey) -or -not $plainKey.StartsWith("gsk_") -or $plainKey.Length -lt 20) {
        throw "The value does not look like a Groq API key. Nothing was written."
    }

    $lines = @()
    if (Test-Path -LiteralPath $target) {
        $lines = @(Get-Content -LiteralPath $target | Where-Object { $_ -notmatch '^\s*GROQ_API_KEY\s*=' })
    }
    $lines += "GROQ_API_KEY=$plainKey"
    Set-Content -LiteralPath $target -Value $lines -Encoding UTF8
    Write-Host "Groq key saved to ignored local file .dev.vars. The key was not printed."
} finally {
    if ($pointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    $plainKey = $null
    $secureKey = $null
}
