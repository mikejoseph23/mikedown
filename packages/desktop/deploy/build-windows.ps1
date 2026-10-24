# packages/desktop/deploy/build-windows.ps1
# ASCII ONLY (Windows PowerShell 5.1 reads BOM-less files as cp1252).
#
# Build the MikeDown Desktop Windows installer on BEAST: NSIS only, per-user
# (installMode currentUser, no admin prompt), WebView2 via the download
# bootstrapper, every binary Authenticode-signed through Azure Artifact
# Signing (Tauri runs deploy/sign-artifact.ps1 as bundle.windows.signCommand).
#
# The updater signature (.sig) is NOT made here: the minisign private key
# lives only on the Mac. release.sh / remote-build-windows.sh sign the
# returned installer with `tauri signer sign` after verifying it.
#
# Normally run by beast/run-mikedown-build.ps1 inside the MikeDownRemoteBuild
# Scheduled Task (signing needs a password logon). By hand at an RDP console:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File packages\desktop\deploy\build-windows.ps1 -Version 0.2.0 -AllowUnpublishedCore
#
# Parameters:
#   -Version x.y.z          Required; must match the synced version files.
#   -AllowUnpublishedCore   Build against packages\core\dist (see check-core-pin.js).
#   -SkipSign               Unsigned build (proves the build over SSH). Not shippable.
#   -OutDir <dir>           Default packages\desktop\deploy\dist\<version>
#
# Output: <OutDir>\MikeDown-<version>-windows-x64-setup.exe and result.json
# ({ path, sha256, size, signature, fileVersion }).

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [switch]$AllowUnpublishedCore,
    [switch]$SkipSign,
    [string]$OutDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$DeployDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PkgDir = Split-Path -Parent $DeployDir
$RepoRoot = Split-Path -Parent (Split-Path -Parent $PkgDir)
$TauriDir = Join-Path $PkgDir 'src-tauri'
if (-not $OutDir) { $OutDir = Join-Path $DeployDir "dist\$Version" }

$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (Test-Path $cargoBin) { $env:Path = "$cargoBin;$env:Path" }

function Invoke-Checked([string]$what, [scriptblock]$block) {
    & $block
    if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" }
}

Write-Output "=== MikeDown Desktop $Version (Windows x64, NSIS) ==="

# 1. Gates
Push-Location $PkgDir
try {
    $synced = (& node deploy\sync-version.js --check)
    if ($LASTEXITCODE -ne 0) { throw "version files out of sync" }
    if ($synced -ne $Version) { throw "version files say $synced but -Version is $Version" }
    $pinArgs = @('deploy\check-core-pin.js')
    if ($AllowUnpublishedCore) { $pinArgs += '--allow-unpublished-core' }
    Invoke-Checked 'check-core-pin' { & node @pinArgs }
} finally { Pop-Location }

if (-not $SkipSign) {
    foreach ($name in @('AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TENANT_ID', 'MIKEDOWN_SIGN_DLIB', 'MIKEDOWN_SIGN_METADATA')) {
        if (-not [Environment]::GetEnvironmentVariable($name)) { throw "signing env var $name is not set (use -SkipSign for an unsigned test build)" }
    }
}

# 2. Core
Push-Location $RepoRoot
try { Invoke-Checked 'build:core' { & npm run build:core } } finally { Pop-Location }

# 3. Config overlay: signCommand (unless -SkipSign), no updater artifacts here.
$overlay = @{ bundle = @{ createUpdaterArtifacts = $false } }
if (-not $SkipSign) {
    $signScript = Join-Path $DeployDir 'sign-artifact.ps1'
    $overlay.bundle.windows = @{ signCommand = @{
        cmd = 'powershell.exe'
        args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $signScript, '-Path', '%1')
    } }
}
$overlayPath = Join-Path $env:TEMP "mikedown-release-$PID.conf.json"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($overlayPath, ($overlay | ConvertTo-Json -Depth 6), $utf8NoBom)

# 4. Build
$env:RELEASE = '1'
Push-Location $PkgDir
try {
    Invoke-Checked 'tauri build' { & npx tauri build --bundles nsis --config $overlayPath }
} finally {
    Pop-Location
    Remove-Item -Force -ErrorAction SilentlyContinue $overlayPath
    Remove-Item Env:\RELEASE -ErrorAction SilentlyContinue
}

$built = Join-Path $TauriDir "target\release\bundle\nsis\MikeDown_${Version}_x64-setup.exe"
if (-not (Test-Path $built)) { throw "expected installer not found: $built" }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$out = Join-Path $OutDir "MikeDown-$Version-windows-x64-setup.exe"
Copy-Item -Force $built $out

# 5. Verify
$sig = (Get-AuthenticodeSignature $out)
$status = $sig.Status.ToString()
$fileVersion = (Get-Item $out).VersionInfo.ProductVersion
Write-Output "Installer: $out"
Write-Output "Authenticode: $status $(if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject })"
Write-Output "ProductVersion: $fileVersion"
if (-not $SkipSign -and $status -ne 'Valid') { throw "installer is not validly signed (status: $status)" }

$result = [ordered]@{
    path        = $out
    sha256      = (Get-FileHash -Algorithm SHA256 $out).Hash.ToLower()
    size        = (Get-Item $out).Length
    signature   = $status
    signer      = $(if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { $null })
    fileVersion = $fileVersion
}
[System.IO.File]::WriteAllText((Join-Path $OutDir 'result.json'), ($result | ConvertTo-Json), $utf8NoBom)
Write-Output "Done: $out"
