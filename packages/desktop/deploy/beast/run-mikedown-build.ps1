# ASCII ONLY in this file: the scheduled task runs it under Windows PowerShell 5.1,
# which reads a BOM-less .ps1 as cp1252 (estate-facts id beast-scheduled-task-ps1-must-be-ascii).
#
# packages/desktop/deploy/beast/run-mikedown-build.ps1
#
# Deployed to BEAST at C:\tools\remote-build\run-mikedown-build.ps1 and run ONLY by the
# Windows Scheduled Task "MikeDownRemoteBuild", registered once by hand at an RDP console
# with a stored password (one line, PowerShell):
#
#   schtasks /create /tn "MikeDownRemoteBuild" /ru michaeljoseph /rp * /rl HIGHEST /f /sc ONCE /st 00:00 /sd 01/01/2020 /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\tools\remote-build\run-mikedown-build.ps1"
#
# Why a task: Azure Artifact Signing needs DPAPI, which needs a password logon; a key-auth
# SSH session fails with NTE_PERM (estate-facts id beast-signing-ssh-token-blocks-cng).
# Same design as lymescribe deploy/beast/run-lymescribe-msi-build.ps1.
#
# Job file (written by deploy/remote-build-windows.sh before it triggers the task):
#   C:\temp\mikedown-build\job.json = { "Sha": "<commit>", "Version": "<x.y.z>",
#                                       "AllowUnpublishedCore": <bool> }
# Sentinel (ALWAYS written, success or failure, and ALWAYS last):
#   C:\temp\mikedown-build\done.json = { ok, exitCode, errorMessage, exePath, exeSignature,
#                                        sha256, size, restoredTo, restoreOk, log }
#
# Write-Output only, never Write-Host (CLIXML floods the SSH side).

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoPath = 'C:\git\mikedown'
$JobDir   = 'C:\temp\mikedown-build'
$JobPath  = Join-Path $JobDir 'job.json'
$DonePath = Join-Path $JobDir 'done.json'
$LogPath  = Join-Path $JobDir 'build.log'

# Current Artifact Signing dlib (1.0.128). Never C:\tools\TrustedSigning (stale 1.0.95).
$env:MIKEDOWN_SIGN_DLIB     = 'C:\tools\ArtifactSigning\bin\x64\Azure.CodeSigning.Dlib.dll'
$env:MIKEDOWN_SIGN_METADATA = Join-Path $RepoPath 'packages\desktop\deploy\sign-metadata.json'

# Tracked files the build may rewrite in place (none known today). Anything else dirty
# after the build stops the restore and is reported.
$AllowedDirty = @()

Start-Transcript -Path $LogPath -Force | Out-Null

function Write-Done([hashtable]$Result) {
    try { Stop-Transcript | Out-Null } catch {}
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($DonePath, ($Result | ConvertTo-Json -Depth 6), $utf8NoBom)
}

$restoreCmd = $null
$restoreDesc = $null
$restoreNeeded = $false

function Invoke-GuardedRestore {
    if (-not $restoreNeeded) { return @{ ok = $true; restoredTo = $restoreDesc } }
    Set-Location $RepoPath
    $dirtyPaths = @(git status --porcelain --untracked-files=no | Where-Object { $_.Trim() -ne '' } | ForEach-Object { $_.Substring(3).Trim() })
    $unexpected = @($dirtyPaths | Where-Object { $AllowedDirty -notcontains $_ })
    if ($unexpected.Count -gt 0) {
        Write-Output "RESTORE-REFUSED: unexpected dirty paths: $($unexpected -join ', ')"
        return @{ ok = $false; restoredTo = ("left-at:" + (git rev-parse HEAD)) }
    }
    if ($dirtyPaths.Count -gt 0) { git checkout --quiet -- . }
    & $restoreCmd
    if ($LASTEXITCODE -ne 0) { return @{ ok = $false; restoredTo = ("left-at:" + (git rev-parse HEAD)) } }
    return @{ ok = $true; restoredTo = $restoreDesc }
}

try {
    if (-not (Test-Path $JobPath)) { throw "no job file at $JobPath" }
    $job = Get-Content $JobPath -Raw | ConvertFrom-Json
    if (-not $job.Sha -or -not $job.Version) { throw "job.json is missing Sha or Version" }
    $sha = [string]$job.Sha
    $version = [string]$job.Version
    $allowUnpublished = $false
    if ($job.PSObject.Properties.Name -contains 'AllowUnpublishedCore') { $allowUnpublished = [bool]$job.AllowUnpublishedCore }

    Write-Output "=== MikeDown remote build: sha=$sha version=$version allowUnpublishedCore=$allowUnpublished ==="
    if (-not (Test-Path (Join-Path $RepoPath '.git'))) { throw "$RepoPath is not a git clone (replace the M0 tarball snapshot with a clone, see deploy/README.md)" }
    Set-Location $RepoPath

    $dirtyLines = @(git status --porcelain --untracked-files=no)
    if ($dirtyLines.Count -gt 0) { throw "working tree at $RepoPath has uncommitted changes, refusing: $($dirtyLines -join ' | ')" }
    $priorBranch = (git symbolic-ref --quiet --short HEAD)
    if ($LASTEXITCODE -ne 0) { $priorBranch = $null }
    $priorSha = (git rev-parse HEAD)
    if ($priorBranch) {
        $restoreDesc = "branch:$priorBranch"
        $restoreCmd = { git checkout --quiet $priorBranch }.GetNewClosure()
    } else {
        $restoreDesc = "detached:$priorSha"
        $restoreCmd = { git checkout --quiet --detach $priorSha }.GetNewClosure()
    }
    $restoreNeeded = $true

    git fetch --quiet origin
    if ($LASTEXITCODE -ne 0) { throw "git fetch origin failed" }
    git checkout --quiet --detach $sha
    if ($LASTEXITCODE -ne 0) { throw "git checkout --detach $sha failed" }

    & npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

    $outDir = Join-Path $RepoPath "packages\desktop\deploy\dist\$version"
    $buildArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $RepoPath 'packages\desktop\deploy\build-windows.ps1'), '-Version', $version, '-OutDir', $outDir)
    if ($allowUnpublished) { $buildArgs += '-AllowUnpublishedCore' }
    $shell = 'powershell.exe'
    if (Get-Command pwsh -ErrorAction SilentlyContinue) { $shell = 'pwsh' }
    & $shell @buildArgs
    if ($LASTEXITCODE -ne 0) { throw "build-windows.ps1 exited $LASTEXITCODE" }

    $exe = Join-Path $outDir "MikeDown-$version-windows-x64-setup.exe"
    if (-not (Test-Path $exe)) { throw "expected installer not found: $exe" }
    $exeSig = (Get-AuthenticodeSignature $exe).Status.ToString()
    Write-Output "Installer Authenticode status: $exeSig"
    if ($exeSig -ne 'Valid') { throw "installer is not validly signed (status: $exeSig)" }

    $restoreResult = Invoke-GuardedRestore
    $restoreNeeded = $false
    Write-Done @{
        ok = $true; exitCode = 0; errorMessage = $null
        exePath = $exe; exeSignature = $exeSig
        sha256 = (Get-FileHash -Algorithm SHA256 $exe).Hash.ToLower(); size = (Get-Item $exe).Length
        restoredTo = $restoreResult.restoredTo; restoreOk = $restoreResult.ok; log = $LogPath
    }
    exit 0
} catch {
    $errMsg = $_.ToString()
    Write-Output "REMOTE-BUILD-ERROR: $errMsg"
    $restoreResult = @{ ok = $null; restoredTo = $null }
    try { $restoreResult = Invoke-GuardedRestore } catch { Write-Output "restore also failed: $($_.ToString())" }
    $restoreNeeded = $false
    Write-Done @{
        ok = $false; exitCode = 1; errorMessage = $errMsg
        exePath = $null; exeSignature = $null; sha256 = $null; size = $null
        restoredTo = $restoreResult.restoredTo; restoreOk = $restoreResult.ok; log = $LogPath
    }
    exit 1
}
