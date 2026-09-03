function Resolve-OrionLocalRuntime {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $pnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue

    $bundledRoot = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies"
    $bundledNodeBin = Join-Path $bundledRoot "node\bin"
    $bundledNode = Join-Path $bundledNodeBin "node.exe"
    $bundledPnpm = Join-Path $bundledRoot "bin\fallback\pnpm.cmd"

    if ($null -eq $nodeCommand -and (Test-Path -LiteralPath $bundledNode)) {
        $env:Path = "$bundledNodeBin;$env:Path"
        $nodeCommand = Get-Command $bundledNode -ErrorAction Stop
    }
    if ($null -eq $pnpmCommand -and (Test-Path -LiteralPath $bundledPnpm)) {
        $pnpmCommand = Get-Command $bundledPnpm -ErrorAction Stop
    }
    if ($null -eq $nodeCommand) {
        throw "Node.js 24 is not available. Install the version from .node-version."
    }
    if ($null -eq $pnpmCommand) {
        throw "pnpm is not available. Install pnpm 11 or run this project from Codex once."
    }

    return [pscustomobject]@{
        Node = $nodeCommand.Source
        NodeBin = Split-Path -Parent $nodeCommand.Source
        Pnpm = $pnpmCommand.Source
    }
}
