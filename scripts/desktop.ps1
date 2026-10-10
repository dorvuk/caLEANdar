param([ValidateSet('dev','build','test')][string]$Mode = 'dev')
$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $workspacePath
try {
    $localCargoPath = Join-Path $workspacePath '.tools\cargo'
    $localRustupPath = Join-Path $workspacePath '.tools\rustup'
    if (Test-Path -LiteralPath (Join-Path $localCargoPath 'bin\cargo.exe')) {
        $env:CARGO_HOME = $localCargoPath
        $env:RUSTUP_HOME = $localRustupPath
        $env:PATH = "$localCargoPath\bin;$env:PATH"
    }
    if ($Mode -eq 'test') { cargo test --manifest-path src-tauri/Cargo.toml }
    elseif ($Mode -eq 'build') { npm run desktop:build }
    else { npm run desktop }
    exit $LASTEXITCODE
} finally { Pop-Location }
