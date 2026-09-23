$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:BUILD_STATION -ne '1') { throw 'This entrypoint must be run by Build Station.' }
if ([string]::IsNullOrWhiteSpace($env:BUILD_STATION_OUTPUT_DIR)) { throw 'BUILD_STATION_OUTPUT_DIR is not set.' }

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$output = $env:BUILD_STATION_OUTPUT_DIR
$npmCache = 'C:\BuildStation\cache\npm'
New-Item -ItemType Directory -Force -Path $output, $npmCache | Out-Null
$env:npm_config_cache = $npmCache

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][scriptblock]$Command
    )
    Write-Host ''
    Write-Host "=== Calendar Studio :: $Label ==="
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE" }
}

Push-Location $root
try {
    foreach ($tool in @('git','node','npm','rustc','cargo')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            throw "Required tool '$tool' is not available on PATH."
        }
    }

    foreach ($required in @('package-lock.json','src-tauri\Cargo.lock','src-tauri\icons\icon.ico')) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            throw "Required release input '$required' is missing."
        }
    }

    $packageLockHashBefore = (Get-FileHash 'package-lock.json' -Algorithm SHA256).Hash
    $cargoLockHashBefore = (Get-FileHash 'src-tauri\Cargo.lock' -Algorithm SHA256).Hash

    Invoke-Checked 'npm ci' { npm ci --prefer-offline --no-audit --no-fund }
    Invoke-Checked 'tests' { npm test }
    Invoke-Checked 'lint' { npm run lint }
    Invoke-Checked 'frontend build' { npm run build }
    Invoke-Checked 'rustfmt' { cargo fmt --manifest-path src-tauri/Cargo.toml -- --check }
    Invoke-Checked 'clippy' { cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings }
    Invoke-Checked 'Tauri NSIS build' { npm run tauri build -- --bundles nsis }

    $packageLockHashAfter = (Get-FileHash 'package-lock.json' -Algorithm SHA256).Hash
    $cargoLockHashAfter = (Get-FileHash 'src-tauri\Cargo.lock' -Algorithm SHA256).Hash
    if ($packageLockHashAfter -ne $packageLockHashBefore) { throw 'package-lock.json changed during build.' }
    if ($cargoLockHashAfter -ne $cargoLockHashBefore) { throw 'src-tauri\Cargo.lock changed during build.' }

    $nsisRoot = Join-Path $root 'src-tauri\target\release\bundle\nsis'
    $exePath = Join-Path $root 'src-tauri\target\release\calendar-studio.exe'
    $installers = @(Get-ChildItem -LiteralPath $nsisRoot -Filter '*.exe' -File -ErrorAction SilentlyContinue)
    if ($installers.Count -eq 0) { throw "No NSIS installer found in $nsisRoot" }
    if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) { throw "Application executable missing: $exePath" }

    foreach ($installer in $installers) {
        Copy-Item -LiteralPath $installer.FullName -Destination (Join-Path $output $installer.Name) -Force
        Write-Host "CALENDAR_STUDIO_INSTALLER=$($installer.Name)"
    }
    Copy-Item -LiteralPath $exePath -Destination (Join-Path $output (Split-Path $exePath -Leaf)) -Force

    $metadata = [ordered]@{
        project = 'Calendar Studio'
        version = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
        sourceSha = (& git rev-parse HEAD).Trim()
        gitRef = if ($env:BUILD_STATION_SOURCE_REF) { $env:BUILD_STATION_SOURCE_REF } else { $env:GITHUB_REF }
        builtUnix = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        installers = @($installers | ForEach-Object { $_.Name })
        executable = (Split-Path $exePath -Leaf)
    }
    $metadata | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $output 'calendar-studio-build.json') -Encoding UTF8
}
finally {
    Pop-Location
}
