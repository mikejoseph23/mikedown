# packages/desktop/deploy/sign-artifact.ps1
# ASCII ONLY: runs under Windows PowerShell 5.1 from a Scheduled Task (see
# estate-facts id beast-scheduled-task-ps1-must-be-ascii).
#
# Sign one file through Azure Artifact Signing (formerly Trusted Signing).
# Copied from lymescribe/deploy/sign-artifact.ps1 with MikeDown env names.
# Tauri calls it for every binary it signs (bundle.windows.signCommand, set
# by build-windows.ps1): the app exe, the NSIS uninstaller and the installer.
#
# Required env vars (all or nothing):
#   AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID   service principal
#   MIKEDOWN_SIGN_DLIB      path to Azure.CodeSigning.Dlib.dll
#                           (BEAST: C:\tools\ArtifactSigning\bin\x64\Azure.CodeSigning.Dlib.dll)
#   MIKEDOWN_SIGN_METADATA  path to metadata.json (deploy/sign-metadata.json:
#                           account interapp-signing, profile interapp-public-trust)
#
# With any of them missing it warns and exits 0, so an unsigned dev build
# still works; build-windows.ps1 and the remote wrapper then refuse the
# artifact for a release because its Authenticode status is not Valid.
#
# Signing needs a real password logon (DPAPI). Over a key-auth SSH session it
# fails with "Access is denied" (NTE_PERM); see estate-facts id
# beast-signing-ssh-token-blocks-cng. Run it from the MikeDownRemoteBuild
# Scheduled Task or an RDP console.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File sign-artifact.ps1 -Path <file>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path $Path)) {
    throw "sign-artifact.ps1: file not found: $Path"
}

$missing = @()
foreach ($name in @('AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TENANT_ID', 'MIKEDOWN_SIGN_DLIB', 'MIKEDOWN_SIGN_METADATA')) {
    if (-not [Environment]::GetEnvironmentVariable($name)) { $missing += $name }
}
if ($missing.Count -gt 0) {
    Write-Output "sign-artifact.ps1: SKIPPING signing, $(Split-Path -Leaf $Path) stays UNSIGNED. Missing: $($missing -join ', ')"
    exit 0
}

$dlibPath = $env:MIKEDOWN_SIGN_DLIB
$metadataPath = $env:MIKEDOWN_SIGN_METADATA
if (-not (Test-Path $dlibPath)) { throw "sign-artifact.ps1: MIKEDOWN_SIGN_DLIB does not exist: $dlibPath" }
if (-not (Test-Path $metadataPath)) { throw "sign-artifact.ps1: MIKEDOWN_SIGN_METADATA does not exist: $metadataPath" }

$programFilesX86 = ${env:ProgramFiles(x86)}
$sdkRoot = Join-Path $programFilesX86 "Windows Kits\10\bin"
if (-not (Test-Path $sdkRoot)) {
    throw "sign-artifact.ps1: Windows Kits 10 not found at $sdkRoot (install the Windows SDK; signtool >= 10.0.22261.755)"
}
$signtool = Get-ChildItem $sdkRoot -Directory |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName "x64\signtool.exe" } |
    Where-Object { Test-Path $_ } |
    Select-Object -First 1
if (-not $signtool) { throw "sign-artifact.ps1: x64\signtool.exe not found under $sdkRoot" }

Write-Output "sign-artifact.ps1: signing $(Split-Path -Leaf $Path) with $signtool"
& $signtool sign /v /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib $dlibPath /dmdf $metadataPath $Path
if ($LASTEXITCODE -ne 0) {
    throw "sign-artifact.ps1: signtool sign failed (exit $LASTEXITCODE). A 403 means the service principal lacks 'Artifact Signing Certificate Profile Signer'; 'Access is denied' over SSH is the DPAPI/NTE_PERM case."
}

& $signtool verify /pa $Path
if ($LASTEXITCODE -ne 0) { throw "sign-artifact.ps1: signtool verify /pa failed (exit $LASTEXITCODE)" }
Write-Output "sign-artifact.ps1: signed and verified: $Path"
