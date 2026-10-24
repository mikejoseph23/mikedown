; NSIS hooks for the MikeDown installer (tauri.windows.conf.json,
; bundle.windows.nsis.installerHooks). ASCII only.
;
; Minimum OS: Windows 10 1809 (build 17763), the WebView2 baseline the app is
; tested against. Older builds get a plain message and the installer stops
; before it writes anything. Silent and passive runs (the updater) abort the
; same way without the message box.

!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
  ${If} $0 == ""
    ; Unknown build: let it through rather than block a working system.
  ${ElseIf} $0 < 17763
    IfSilent +2
      MessageBox MB_OK|MB_ICONSTOP "MikeDown needs Windows 10 version 1809 or later (this PC is build $0)."
    Abort
  ${EndIf}
!macroend
