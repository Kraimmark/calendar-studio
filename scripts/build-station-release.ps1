$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ProjectName = 'calendar-studio'
$ArtifactRoot = Join-Path 'C:\BuildStation\artifacts' $ProjectName
$LatestRoot = Join-Path $ArtifactRoot 'latest'
$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$SnapshotRoot = Join-Path $ArtifactRoot $Timestamp

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][scriptblock]$Command
    )

    Write-Host "`n==> $Label"
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE"
    }
}

Write-Host 'Calendar Studio — Build Station release gate'
Write-Host "Runner: $env:RUNNER_NAME"
Write-Host "Workspace: $env:GITHUB_WORKSPACE"
Write-Host "Artifacts: $ArtifactRoot"

if ($env:RUNNER_NAME -and $env:RUNNER_NAME -ne 'KRAIMMARK-BUILD-01') {
    Write-Warning "Expected KRAIMMARK-BUILD-01, actual runner is '$env:RUNNER_NAME'. Labels remain the authoritative routing gate."
}

foreach ($tool in @('git', 'node', 'npm', 'rustc', 'cargo')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "Required Build Station tool '$tool' is not available on PATH."
    }
}

Invoke-Checked 'Git version' { git --version }
Invoke-Checked 'Node version' { node --version }
Invoke-Checked 'npm version' { npm --version }
Invoke-Checked 'Rust version' { rustc --version }
Invoke-Checked 'Cargo version' { cargo --version }

$RequiredReleaseInputs = @(
    'package-lock.json',
    'src-tauri\Cargo.lock',
    'src-tauri\icons\icon.ico'
)
foreach ($requiredInput in $RequiredReleaseInputs) {
    if (-not (Test-Path $requiredInput)) {
        throw "Required reproducible-release input '$requiredInput' is missing."
    }
}

$PackageLockHashBefore = (Get-FileHash 'package-lock.json' -Algorithm SHA256).Hash
$CargoLockHashBefore = (Get-FileHash 'src-tauri\Cargo.lock' -Algorithm SHA256).Hash
$IconHash = (Get-FileHash 'src-tauri\icons\icon.ico' -Algorithm SHA256).Hash
Write-Host "package-lock.json SHA-256: $PackageLockHashBefore"
Write-Host "Cargo.lock SHA-256:        $CargoLockHashBefore"
Write-Host "icon.ico SHA-256:          $IconHash"

Invoke-Checked 'Install npm dependencies from lockfile' { npm ci }

Invoke-Checked 'Unit and integration tests' { npm test }
Invoke-Checked 'ESLint' { npm run lint }
Invoke-Checked 'Production frontend build' { npm run build }
Invoke-Checked 'Rustfmt check' { cargo fmt --manifest-path src-tauri/Cargo.toml -- --check }
Invoke-Checked 'Clippy' { cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings }
Invoke-Checked 'Tauri NSIS build' { npm run tauri build -- --bundles nsis }

$PackageLockHashAfter = (Get-FileHash 'package-lock.json' -Algorithm SHA256).Hash
$CargoLockHashAfter = (Get-FileHash 'src-tauri\Cargo.lock' -Algorithm SHA256).Hash
if ($PackageLockHashAfter -ne $PackageLockHashBefore) {
    throw 'package-lock.json changed during the release gate.'
}
if ($CargoLockHashAfter -ne $CargoLockHashBefore) {
    throw 'src-tauri\Cargo.lock changed during the release gate.'
}

$NsisRoot = Join-Path $PWD 'src-tauri\target\release\bundle\nsis'
$ExePath = Join-Path $PWD 'src-tauri\target\release\calendar-studio.exe'
$Installers = @()
if (Test-Path $NsisRoot) {
    $Installers = @(Get-ChildItem -Path $NsisRoot -Filter '*.exe' -File)
}

if ($Installers.Count -eq 0) {
    throw "Tauri build completed but no NSIS installer was found in '$NsisRoot'."
}
if (-not (Test-Path $ExePath)) {
    throw "Tauri build completed but application executable was not found at '$ExePath'."
}

New-Item -ItemType Directory -Force -Path $SnapshotRoot | Out-Null
New-Item -ItemType Directory -Force -Path $LatestRoot | Out-Null
Get-ChildItem -Path $LatestRoot -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force

foreach ($installer in $Installers) {
    Copy-Item $installer.FullName -Destination $SnapshotRoot -Force
    Copy-Item $installer.FullName -Destination $LatestRoot -Force
}
Copy-Item $ExePath -Destination $SnapshotRoot -Force
Copy-Item $ExePath -Destination $LatestRoot -Force

$Metadata = [ordered]@{
    project = $ProjectName
    builtAt = (Get-Date).ToString('o')
    runner = $env:RUNNER_NAME
    repository = $env:GITHUB_REPOSITORY
    ref = $env:GITHUB_REF
    sha = $env:GITHUB_SHA
    installers = @($Installers | ForEach-Object { $_.Name })
    executable = (Split-Path $ExePath -Leaf)
}
$MetadataJson = $Metadata | ConvertTo-Json -Depth 4
$MetadataJson | Set-Content -Path (Join-Path $SnapshotRoot 'build-metadata.json') -Encoding UTF8
$MetadataJson | Set-Content -Path (Join-Path $LatestRoot 'build-metadata.json') -Encoding UTF8

Write-Host "`nBuild Station release gate passed."
Write-Host "Snapshot: $SnapshotRoot"
Write-Host "Latest:   $LatestRoot"
