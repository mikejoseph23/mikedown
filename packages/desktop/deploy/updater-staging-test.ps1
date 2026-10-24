# packages/desktop/deploy/updater-staging-test.ps1
# ASCII ONLY (Windows PowerShell 5.1 reads BOM-less files as cp1252).
#
# Windows half of the updater staging harness (the macOS half is
# updater-staging-test.sh). Nothing built or served here is shippable and
# nothing touches iadev.net: the server binds 127.0.0.1.
#
# Two modes. The Mac drives both over SSH with updater-staging-test-windows.sh,
# which also makes the update signatures (the minisign key lives only on the Mac).
#
#   -Mode Build   on a box with Rust + Node (BEAST): from a copy of the source
#                 tree build an UNSIGNED staging installer of version N (default
#                 0.0.9) and the updater_cases test executable. No Trusted
#                 Signing is used: the signing identity needs a password logon
#                 on BEAST (estate fact beast-signing-ssh-token-blocks-cng).
#
#   -Mode Run     on any Windows box (DEVBOX1): serve the bundle on 127.0.0.1,
#                 run the shared engine cases (same updater_cases.exe cases as
#                 macOS), then four real install flows against a per-user NSIS
#                 install of N:
#                   quiet N to N+1   the genuine, Trusted-Signed 0.1.0 installer is
#                                    the N+1 payload; confirms the new version is
#                                    installed and relaunched by the installer
#                   unsigned .exe    update-key-signed payload with no Authenticode
#                                    signature: refused, installed version unchanged
#                   broken Authenticode  genuine signed installer with a byte
#                                    changed, then update-key-signed: refused
#                   continuity       0.1.0's own shipped updater block (legacy
#                                    latest.json only, installMode passive)
#                 Every case prints "[case] name: PASS|FAIL|SKIP detail"; the exit
#                 code is 1 on any FAIL.
#
# Why N is 0.0.9 and N+1 is the real 0.1.0: the pre-install check requires an
# Authenticode signature from "Interapp Development, Inc.". The only such
# installer that exists is the released 0.1.0, so the staging build is the OLD
# side (unsigned is fine there) and 0.1.0 is the payload it updates to.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File updater-staging-test.ps1 -Mode Build -Tree C:\temp\mikedown-u4\tree -Out C:\temp\mikedown-u4\out
#   powershell -NoProfile -ExecutionPolicy Bypass -File updater-staging-test.ps1 -Mode Run -Bundle C:\temp\mikedown-u4\bundle

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('Build', 'Run')][string]$Mode,
    [string]$Tree,
    [string]$Out,
    [string]$NodeModulesFrom = 'C:\git\mikedown',
    [string]$Bundle,
    [int]$Port = 18765,
    [string]$N = '0.0.9',
    [string]$Next = '0.1.0',
    [switch]$Keep
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Run-Native([string]$Exe, [string]$ArgLine, [string]$OutFile) {
    # cmd redirects stdout and stderr together; PowerShell 5.1 would turn native stderr into errors.
    $cmd = '"' + $Exe + '" ' + $ArgLine + ' > "' + $OutFile + '" 2>&1'
    & cmd.exe /c $cmd
    return $LASTEXITCODE
}

# ------------------------------------------------------------------ Build
if ($Mode -eq 'Build') {
    if (-not $Tree -or -not $Out) { throw '-Tree and -Out are required for -Mode Build' }
    $cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
    if (Test-Path $cargoBin) { $env:Path = "$cargoBin;$env:Path" }
    New-Item -ItemType Directory -Force -Path $Out | Out-Null
    foreach ($rel in @('node_modules', 'packages\core\node_modules', 'packages\desktop\node_modules')) {
        $link = Join-Path $Tree $rel
        $target = Join-Path $NodeModulesFrom $rel
        if (-not (Test-Path $link)) {
            if (-not (Test-Path $target)) {
                if ($rel -eq 'node_modules') { throw "missing $target" }
                continue
            }
            & cmd.exe /c mklink /J "$link" "$target" | Out-Null
        }
    }
    $pkg = Join-Path $Tree 'packages\desktop'
    $tauriDir = Join-Path $pkg 'src-tauri'
    $overlay = Join-Path $env:TEMP "mikedown-staging-$PID.conf.json"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    # The staging build must never reach iadev.net: point its updater at the local staging server,
    # with the shipped endpoint order.
    $ep1 = "http://127.0.0.1:$Port/pertarget/latest-{{target}}-{{arch}}.json"
    $ep2 = "http://127.0.0.1:$Port/pertarget/latest.json"
    $json = '{ "version": "' + $N + '", "plugins": { "updater": { "endpoints": ["' + $ep1 + '", "' + $ep2 + '"], "dangerousInsecureTransportProtocol": true } }, "bundle": { "createUpdaterArtifacts": false } }'
    [System.IO.File]::WriteAllText($overlay, $json, $utf8NoBom)
    Write-Output "=== building UNSIGNED staging installer $N ==="
    $env:RELEASE = '1'
    Push-Location $pkg
    try {
        & npx.cmd tauri build --bundles nsis --config $overlay
        if ($LASTEXITCODE -ne 0) { throw "tauri build failed ($LASTEXITCODE)" }
    } finally { Pop-Location; Remove-Item -Force -ErrorAction SilentlyContinue $overlay; Remove-Item Env:\RELEASE -ErrorAction SilentlyContinue }
    $built = Join-Path $tauriDir "target\release\bundle\nsis\MikeDown_${N}_x64-setup.exe"
    if (-not (Test-Path $built)) { throw "installer not found: $built" }
    Copy-Item -Force $built (Join-Path $Out "MikeDown-$N-windows-x64-setup.exe")
    Write-Output "=== building updater_cases test executable ==="
    Push-Location $tauriDir
    try {
        # cargo rustc passes the link args to the test crate only. The comctl32 v6 manifest is
        # needed or the exe dies at load with 0xC0000139 (see deploy/windows-test.manifest).
        $manifest = Join-Path $PSScriptRoot 'windows-test.manifest'
        & cargo.exe rustc --test updater_cases -- -C link-arg=/MANIFEST:EMBED "-Clink-arg=/MANIFESTINPUT:$manifest"
        if ($LASTEXITCODE -ne 0) { throw "cargo rustc --test failed ($LASTEXITCODE)" }
    } finally { Pop-Location }
    $exe = Get-ChildItem (Join-Path $tauriDir 'target\debug\deps') -Filter 'updater_cases-*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $exe) { throw 'updater_cases test exe not found' }
    Copy-Item -Force $exe.FullName (Join-Path $Out 'updater_cases.exe')
    $sig = Get-AuthenticodeSignature (Join-Path $Out "MikeDown-$N-windows-x64-setup.exe")
    Write-Output "Built: $Out  (staging installer Authenticode status: $($sig.Status), expected NotSigned)"
    exit 0
}

# -------------------------------------------------------------------- Run
if (-not $Bundle) { throw '-Bundle is required for -Mode Run' }
$Bundle = (Resolve-Path $Bundle).Path
$serve = Join-Path $Bundle 'serve'
$testExe = Join-Path $Bundle 'updater_cases.exe'
$work = Join-Path $Bundle 'work'
$httpLog = Join-Path $work 'http.log'
New-Item -ItemType Directory -Force -Path $work | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue $httpLog
$base = "http://127.0.0.1:$Port"
$suffix = '-windows-x64-setup.exe'
$nSetup = Join-Path $serve "MikeDown-$N$suffix"
$nextSetup = Join-Path $serve "MikeDown-$Next$suffix"
$installDir = Join-Path $env:LOCALAPPDATA 'MikeDown'
$installedExe = Join-Path $installDir 'mikedown-desktop.exe'
$uninstaller = Join-Path $installDir 'uninstall.exe'
$legacyConf = Join-Path $Bundle 'legacy-0.1.0-updater.json'

$results = New-Object System.Collections.ArrayList
function Add-Result([string]$Name, [string]$Status, [string]$Detail) {
    $line = "[case] ${Name}: $Status $Detail"
    Write-Output $line
    [void]$results.Add($line)
}

foreach ($f in @($testExe, $nSetup, $nextSetup, (Join-Path $Bundle 'staging-scenarios.js'), (Join-Path $Bundle 'staging-serve.js'))) {
    if (-not (Test-Path $f)) { throw "bundle is incomplete, missing: $f" }
}

function Get-InstalledVersion {
    $keys = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MikeDown')
    foreach ($k in $keys) {
        if (Test-Path $k) {
            $v = (Get-ItemProperty $k).DisplayVersion
            if ($v) { return [string]$v }
        }
    }
    if (Test-Path $installedExe) { return (Get-Item $installedExe).VersionInfo.ProductVersion }
    return $null
}

function Stop-App {
    Get-Process -Name 'mikedown-desktop' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($installDir) } | Stop-Process -Force -ErrorAction SilentlyContinue
}

function Uninstall-App {
    Stop-App
    if (Test-Path $uninstaller) {
        Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait
        for ($i = 0; $i -lt 60 -and (Test-Path $installedExe); $i++) { Start-Sleep -Milliseconds 500 }
    }
    if (Test-Path $installDir) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $installDir }
}

function Install-N {
    Uninstall-App
    $p = Start-Process -FilePath $nSetup -ArgumentList '/S' -Wait -PassThru
    for ($i = 0; $i -lt 60 -and -not (Test-Path $installedExe); $i++) { Start-Sleep -Milliseconds 500 }
    $v = Get-InstalledVersion
    if (-not (Test-Path $installedExe) -or $v -ne $N) { throw "could not install the staging build $N per-user (exe present: $(Test-Path $installedExe), version: $v, installer exit $($p.ExitCode))" }
}

# Scenarios and server.
& node (Join-Path $Bundle 'staging-scenarios.js') --serve $serve --n $N --next $Next --base $base --keys windows-x86_64 --suffix $suffix --platform windows
if ($LASTEXITCODE -ne 0) { throw 'staging-scenarios.js failed' }
$server = Start-Process -FilePath 'node' -ArgumentList @((Join-Path $Bundle 'staging-serve.js'), '--dir', $serve, '--port', $Port, '--log', $httpLog) -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2

$failed = $false
try {
    # ---- shared engine cases (same code and cases as macOS) ----
    $dead = $Port + 1
    $env:MIKEDOWN_E2E_BASE = $base
    $env:MIKEDOWN_E2E_DEAD_PORT = "$dead"
    $env:MIKEDOWN_E2E_CURRENT = $N
    $env:MIKEDOWN_E2E_EXPECT = $Next
    $env:MIKEDOWN_E2E_GOOD_FILE = "MikeDown-$Next$suffix"
    $env:MIKEDOWN_E2E_PRECHECK_OK = $nextSetup
    $garbage = Join-Path $work 'garbage.bin'
    [System.IO.File]::WriteAllText($garbage, 'this is not an installer')
    $badsig = Join-Path $serve "MikeDown-$Next-badsig$suffix"
    $env:MIKEDOWN_E2E_PRECHECK_BAD = "unsigned installer=$nSetup;genuine installer with a byte changed after signing=$badsig;a file that is not an installer=$garbage"
    $casesOut = Join-Path $work 'cases.log'
    $rc = Run-Native $testExe '--ignored --nocapture --test-threads 1 --skip windows_install_hand_over' $casesOut
    foreach ($line in (Get-Content $casesOut)) {
        $m = [regex]::Match($line, '\[case\] .*')
        if ($m.Success) { Write-Output $m.Value; [void]$results.Add($m.Value) }
    }
    if ($rc -ne 0) { Add-Result 'engine cases (updater_cases.exe)' 'FAIL' "exit code $rc, see $casesOut" }

    # ---- server log checks ----
    $log = if (Test-Path $httpLog) { Get-Content $httpLog -Raw } else { '' }
    if (($log -match 'GET /fallback/latest-windows-x86_64.json HTTP/1.1" 404') -and ($log -match 'GET /fallback/latest.json HTTP/1.1" 200')) {
        Add-Result 'server log: per-target 404 then latest.json 200' 'PASS' ''
    } else { Add-Result 'server log: per-target 404 then latest.json 200' 'FAIL' "see $httpLog" }

    # ---- install flows ----
    # The installer relaunches the app with NSIS RunAsUser, which needs the user's interactive
    # session; a process started from an SSH session cannot do that (verified: the same installer
    # run in the interactive session relaunches, from SSH it does not). So the hand-over test runs
    # through a transient per-user scheduled task with /it (interactive session) when one exists.
    $script:interactive = $true
    function Sch([string[]]$A) { $ErrorActionPreference = 'Continue'; $null = & schtasks.exe @A 2>&1; return $LASTEXITCODE }
    function Run-InUserSession([string]$Scenario, [string]$Conf, [string]$Out) {
        $cmdFile = Join-Path $work "flow-$Scenario.cmd"
        $done = "$Out.done"
        Remove-Item -Force -ErrorAction SilentlyContinue $Out, $done
        $lines = @('@echo off',
            "set MIKEDOWN_E2E_BASE=$base", "set MIKEDOWN_E2E_CURRENT=$N", "set MIKEDOWN_E2E_EXPECT=$Next",
            "set MIKEDOWN_E2E_WIN_INSTALL_EXE=$installedExe", "set MIKEDOWN_E2E_WIN_SCENARIO=$Scenario")
        if ($Conf) { $lines += "set MIKEDOWN_E2E_LEGACY_CONF=$Conf" }
        $lines += "`"$testExe`" --ignored --exact windows_install_hand_over --nocapture > `"$Out`" 2>&1"
        $lines += "echo EXITCODE=%errorlevel% > `"$done`""
        [System.IO.File]::WriteAllText($cmdFile, ($lines -join "`r`n") + "`r`n")
        if ($script:interactive) {
            $tn = 'mikedown-u4-flow'
            [void](Sch @('/delete', '/tn', $tn, '/f'))
            $user = $env:USERNAME
            $created = Sch @('/create', '/tn', $tn, '/tr', "cmd.exe /c $cmdFile", '/sc', 'once', '/st', '23:59', '/it', '/ru', $user, '/f')
            if ($created -eq 0) {
                [void](Sch @('/run', '/tn', $tn))
                for ($i = 0; $i -lt 360 -and -not (Test-Path $done); $i++) { Start-Sleep -Milliseconds 500 }
                [void](Sch @('/delete', '/tn', $tn, '/f'))
                if (Test-Path $done) {
                    $m = [regex]::Match((Get-Content $done -Raw), 'EXITCODE=(\d+)')
                    return [int]$m.Groups[1].Value
                }
                return -2
            }
            $script:interactive = $false
            Write-Host "note: no interactive-session task could be created (schtasks exit $created); running from this session, relaunch cannot be tested"
        }
        return (Run-Native $env:ComSpec "/c `"$cmdFile`"" "$Out.cmdlog")
    }

    function Invoke-Flow([string]$Name, [string]$Scenario, [string]$Conf, [bool]$ExpectRefusal) {
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $env:APPDATA 'com.interappdev.mikedown\logs')
        Install-N
        $env:MIKEDOWN_E2E_WIN_INSTALL_EXE = $installedExe
        $env:MIKEDOWN_E2E_WIN_SCENARIO = $Scenario
        if ($Conf) { $env:MIKEDOWN_E2E_LEGACY_CONF = $Conf } else { Remove-Item Env:\MIKEDOWN_E2E_LEGACY_CONF -ErrorAction SilentlyContinue }
        $out = Join-Path $work "flow-$Scenario.log"
        $rc = Run-InUserSession $Scenario $Conf $out
        $text = if (Test-Path $out) { Get-Content $out -Raw } else { '' }
        if ($ExpectRefusal) {
            Start-Sleep -Seconds 4
            $v = Get-InstalledVersion
            if ($rc -eq 3 -and $text -match 'pre-install check REFUSED: (.*)' -and $v -eq $N) {
                Add-Result $Name 'PASS' "refused ($($Matches[1].Trim())); installed version stays $N"
            } else { Add-Result $Name 'FAIL' "exit $rc, installed $v, see $out" }
            return
        }
        if ($text -notmatch 'pre-install check passed: (.*)') {
            Add-Result $Name 'FAIL' "pre-install check did not pass, exit $rc, see $out"
            return
        }
        $note = $Matches[1].Trim()
        $deadline = (Get-Date).AddSeconds(120)
        $v = Get-InstalledVersion
        while ($v -ne $Next -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 1; $v = Get-InstalledVersion }
        if ($v -ne $Next) { Add-Result $Name 'FAIL' "installed version is $v after 120 s, expected $Next, see $out"; return }
        $sig = Get-AuthenticodeSignature $installedExe
        Add-Result $Name 'PASS' "$N -> $Next installed ($note); installed exe Authenticode: $($sig.Status)"
        # The installer relaunches the app (/R). Kill it as soon as it shows: the real 0.1.0 has
        # production endpoints baked in and nothing in this harness may touch iadev.net.
        if (-not $script:interactive) {
            Add-Result "$Name (relaunch)" 'SKIP' 'no interactive session on this box: the installer cannot relaunch from an SSH-started process (RunAsUser)'
            return
        }
        $seen = $null
        for ($i = 0; $i -lt 80 -and -not $seen; $i++) {
            $seen = Get-Process -Name 'mikedown-desktop' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($installDir) } | Select-Object -First 1
            if (-not $seen) { Start-Sleep -Milliseconds 250 }
        }
        if ($seen) { Stop-App; Add-Result "$Name (relaunch)" 'PASS' "installer relaunched mikedown-desktop (pid $($seen.Id)); stopped at once" }
        else {
            $any = @(Get-Process -Name 'mikedown-desktop' -ErrorAction SilentlyContinue).Count
            $logFile = Join-Path $env:APPDATA 'com.interappdev.mikedown\logs\updater.log'
            $tail = if (Test-Path $logFile) { ((Get-Content $logFile -Tail 3) -join ' | ') } else { 'no updater.log' }
            Add-Result "$Name (relaunch)" 'FAIL' "no mikedown-desktop process from the install folder within 20 s of the install (processes by that name: $any; updater.log: $tail)"
        }
    }

    Invoke-Flow 'windows: unsigned .exe (update-key signed) refused by the Authenticode pre-check' 'unsigned' '' $true
    Invoke-Flow 'windows: .exe with broken Authenticode (update-key signed) refused by the pre-check' 'badsig' '' $true
    Invoke-Flow 'windows: quiet install N to N+1 (per-target file), N+1 installed and relaunched' 'pertarget' '' $false
    if (Test-Path $legacyConf) {
        Invoke-Flow 'continuity (closest honest equivalent, see header): 0.1.0 updater block, legacy latest.json only, passive install' 'legacy' $legacyConf $false
        $log = Get-Content $httpLog -Raw
        if (($log -match 'GET /legacy/latest.json HTTP/1.1" 200') -and ($log -notmatch 'GET /legacy/latest-')) {
            Add-Result 'server log: 0.1.0 config asked only for latest.json' 'PASS' ''
        } else { Add-Result 'server log: 0.1.0 config asked only for latest.json' 'FAIL' "see $httpLog" }
    } else {
        Add-Result 'continuity: 0.1.0 updater block through legacy latest.json' 'SKIP' 'legacy-0.1.0-updater.json is not in the bundle'
    }
} finally {
    Uninstall-App
    if (-not $Keep -and $server) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}

$p = @($results | Where-Object { $_ -match ': PASS' }).Count
$f = @($results | Where-Object { $_ -match ': FAIL' }).Count
$s = @($results | Where-Object { $_ -match ': SKIP' }).Count
Write-Output "TOTAL: $p PASS, $f FAIL, $s SKIP"
if ($f -gt 0) { exit 1 }
exit 0
