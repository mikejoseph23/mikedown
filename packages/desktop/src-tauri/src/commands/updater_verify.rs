//! Pre-install checks for a downloaded update (U1).
//!
//! The plugin already verified the minisign signature and the signed version.
//! These checks add the OS-level code-signing identity, on the same bytes the
//! plugin is about to install, so a payload signed with the update key but not
//! by us as a publisher (or a broken signature) never reaches the installer.
//!
//! - macOS: the plugin extracts and swaps inside `install()`, so the extracted
//!   app is not exposed. This module extracts the verified `.app.tar.gz`
//!   itself (system `tar`) into a temp dir, runs
//!   `codesign --verify --deep --strict`, and requires Team ID `UU626VCLYW`.
//! - Windows: writes the verified installer to a temp file, `WinVerifyTrust`
//!   on it, and requires the signer's organization to be
//!   `Interapp Development, Inc.`.

#[allow(dead_code)]
pub const EXPECTED_TEAM_ID: &str = "UU626VCLYW";
#[allow(dead_code)]
pub const EXPECTED_SIGNER: &str = "Interapp Development, Inc.";

/// Pull `TeamIdentifier=XXXX` out of `codesign -dv` output.
#[allow(dead_code)]
pub fn parse_team_id(codesign_output: &str) -> Option<&str> {
    codesign_output
        .lines()
        .find_map(|l| l.trim().strip_prefix("TeamIdentifier="))
        .map(str::trim)
        .filter(|t| !t.is_empty() && *t != "not set")
}

/// True when a signing certificate's subject is ours: the organization (O)
/// equals the expected name exactly; the common name (CN) is accepted only
/// when the certificate has no organization. Exact, case-sensitive: a name
/// that merely contains ours ("Interapp Development, Inc. Ltd") is refused.
#[allow(dead_code)]
pub fn signer_matches(organization: Option<&str>, common_name: Option<&str>) -> bool {
    match (organization.map(str::trim).filter(|s| !s.is_empty()), common_name.map(str::trim)) {
        (Some(o), _) => o == EXPECTED_SIGNER,
        (None, Some(cn)) => cn == EXPECTED_SIGNER,
        (None, None) => false,
    }
}

/// Run the platform's check on the verified update payload. `Ok` also on
/// platforms with no check (Linux is not shipped).
pub fn preinstall_check(bytes: &[u8]) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        mac::check(bytes)
    }
    #[cfg(windows)]
    {
        win::check(bytes)
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = bytes;
        Ok("no pre-install check on this platform".into())
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use super::{parse_team_id, EXPECTED_TEAM_ID};
    use std::path::{Path, PathBuf};
    use std::process::Command;

    struct TempDir(PathBuf);
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    pub fn check(bytes: &[u8]) -> Result<String, String> {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = TempDir(std::env::temp_dir().join(format!("mikedown-update-check-{}-{stamp}", std::process::id())));
        std::fs::create_dir_all(&dir.0).map_err(|e| format!("temp dir: {e}"))?;
        let archive = dir.0.join("update.tar.gz");
        let out = dir.0.join("x");
        std::fs::write(&archive, bytes).map_err(|e| format!("write archive: {e}"))?;
        std::fs::create_dir_all(&out).map_err(|e| format!("temp dir: {e}"))?;
        let tar = Command::new("tar").arg("-xzf").arg(&archive).arg("-C").arg(&out).output().map_err(|e| format!("tar: {e}"))?;
        if !tar.status.success() {
            return Err(format!("could not unpack the update: {}", String::from_utf8_lossy(&tar.stderr).trim()));
        }
        let app = find_app(&out).ok_or_else(|| "the update contains no .app bundle".to_string())?;
        let verify = Command::new("codesign")
            .args(["--verify", "--deep", "--strict"])
            .arg(&app)
            .output()
            .map_err(|e| format!("codesign: {e}"))?;
        if !verify.status.success() {
            return Err(format!("codesign --verify failed: {}", String::from_utf8_lossy(&verify.stderr).trim()));
        }
        let info = Command::new("codesign").args(["-dv", "--verbose=2"]).arg(&app).output().map_err(|e| format!("codesign: {e}"))?;
        // codesign -d writes to stderr.
        let text = String::from_utf8_lossy(&info.stderr).to_string();
        match parse_team_id(&text) {
            Some(t) if t == EXPECTED_TEAM_ID => Ok(format!("codesign verified, Team ID {t}")),
            Some(t) => Err(format!("unexpected Team ID {t}")),
            None => Err("the update is not signed with a Team ID".into()),
        }
    }

    fn find_app(dir: &Path) -> Option<PathBuf> {
        std::fs::read_dir(dir)
            .ok()?
            .flatten()
            .map(|e| e.path())
            .find(|p| p.extension().is_some_and(|x| x == "app") && p.is_dir())
    }
}

#[cfg(windows)]
mod win {
    use super::{signer_matches, EXPECTED_SIGNER};
    use windows_sys::Win32::Foundation::{HANDLE, HWND, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Security::Cryptography::{CertGetNameStringW, CERT_NAME_ATTR_TYPE};
    use windows_sys::Win32::Security::WinTrust::{
        WTHelperGetProvCertFromChain, WTHelperGetProvSignerFromChain, WTHelperProvDataFromStateData, WinVerifyTrust,
        WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_DATA_0, WINTRUST_FILE_INFO, WTD_CHOICE_FILE,
        WTD_REVOKE_NONE, WTD_STATEACTION_CLOSE, WTD_STATEACTION_VERIFY, WTD_UI_NONE,
    };

    const OID_COMMON_NAME: &[u8] = b"2.5.4.3\0";
    const OID_ORGANIZATION: &[u8] = b"2.5.4.10\0";

    fn wide(s: &std::ffi::OsStr) -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt;
        s.encode_wide().chain(std::iter::once(0)).collect()
    }

    /// One attribute of the certificate's subject, via `CertGetNameStringW`.
    unsafe fn subject_attr(
        cert: *const windows_sys::Win32::Security::Cryptography::CERT_CONTEXT,
        oid: &'static [u8],
    ) -> Option<String> {
        let len = CertGetNameStringW(cert, CERT_NAME_ATTR_TYPE, 0, oid.as_ptr().cast(), std::ptr::null_mut(), 0);
        if len <= 1 {
            return None;
        }
        let mut buf = vec![0u16; len as usize];
        let got = CertGetNameStringW(cert, CERT_NAME_ATTR_TYPE, 0, oid.as_ptr().cast(), buf.as_mut_ptr(), len);
        if got <= 1 {
            return None;
        }
        Some(String::from_utf16_lossy(&buf[..(got as usize - 1)]))
    }

    pub fn check(bytes: &[u8]) -> Result<String, String> {
        // The plugin installs a raw NSIS `-setup.exe` (or an .msi/zip of one).
        // Only a PE is checked here; anything else is refused rather than
        // installed unchecked.
        if !bytes.starts_with(b"MZ") {
            return Err("the update payload is not a Windows installer (.exe)".into());
        }
        let path = std::env::temp_dir().join(format!("mikedown-update-check-{}.exe", std::process::id()));
        std::fs::write(&path, bytes).map_err(|e| format!("write installer: {e}"))?;
        let result = verify_file(&path);
        let _ = std::fs::remove_file(&path);
        result
    }

    fn verify_file(path: &std::path::Path) -> Result<String, String> {
        let wpath = wide(path.as_os_str());
        // SAFETY: plain Win32 calls on structs that live for the whole call;
        // the state handle is always closed before returning.
        unsafe {
            let mut file: WINTRUST_FILE_INFO = std::mem::zeroed();
            file.cbStruct = std::mem::size_of::<WINTRUST_FILE_INFO>() as u32;
            file.pcwszFilePath = wpath.as_ptr();

            let mut data: WINTRUST_DATA = std::mem::zeroed();
            data.cbStruct = std::mem::size_of::<WINTRUST_DATA>() as u32;
            data.dwUIChoice = WTD_UI_NONE;
            data.fdwRevocationChecks = WTD_REVOKE_NONE;
            data.dwUnionChoice = WTD_CHOICE_FILE;
            data.Anonymous = WINTRUST_DATA_0 { pFile: &mut file };
            data.dwStateAction = WTD_STATEACTION_VERIFY;

            let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
            let hwnd = INVALID_HANDLE_VALUE as HWND;
            let status = WinVerifyTrust(hwnd, &mut action, (&mut data as *mut WINTRUST_DATA).cast());

            let outcome = if status != 0 {
                Err(format!("WinVerifyTrust failed (0x{:08X})", status as u32))
            } else {
                signer_of(data.hWVTStateData)
            };

            data.dwStateAction = WTD_STATEACTION_CLOSE;
            WinVerifyTrust(hwnd, &mut action, (&mut data as *mut WINTRUST_DATA).cast());
            outcome
        }
    }

    unsafe fn signer_of(state: HANDLE) -> Result<String, String> {
        let prov = WTHelperProvDataFromStateData(state);
        if prov.is_null() {
            return Err("no signature provider data".into());
        }
        let signer = WTHelperGetProvSignerFromChain(prov, 0, 0, 0);
        if signer.is_null() {
            return Err("no signer in the signature".into());
        }
        let cert = WTHelperGetProvCertFromChain(signer, 0);
        if cert.is_null() || (*cert).pCert.is_null() {
            return Err("no signing certificate".into());
        }
        let org = subject_attr((*cert).pCert, OID_ORGANIZATION);
        let cn = subject_attr((*cert).pCert, OID_COMMON_NAME);
        if signer_matches(org.as_deref(), cn.as_deref()) {
            Ok(format!("WinVerifyTrust OK, signer {EXPECTED_SIGNER}"))
        } else {
            Err(format!("unexpected signer (O={:?}, CN={:?})", org, cn))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signer_exact_org_match() {
        assert!(signer_matches(Some("Interapp Development, Inc."), Some("Interapp Development, Inc.")));
        assert!(signer_matches(Some(" Interapp Development, Inc. "), None));
    }

    #[test]
    fn signer_rejects_lookalikes() {
        assert!(!signer_matches(Some("Interapp Development, Inc. Ltd"), None));
        assert!(!signer_matches(Some("interapp development, inc."), None));
        assert!(!signer_matches(Some("Evil Corp"), Some("Interapp Development, Inc.")));
        assert!(!signer_matches(None, None));
        assert!(!signer_matches(Some(""), Some("Someone Else")));
    }

    #[test]
    fn signer_falls_back_to_cn_without_org() {
        assert!(signer_matches(None, Some("Interapp Development, Inc.")));
        assert!(signer_matches(Some(""), Some("Interapp Development, Inc.")));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn mac_refuses_a_payload_that_is_not_a_signed_app() {
        assert!(preinstall_check(b"not a tarball").is_err());
        // A real gzip tar holding an unsigned fake .app bundle.
        let dir = std::env::temp_dir().join(format!("mikedown-verify-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("Fake.app/Contents")).unwrap();
        std::fs::write(dir.join("Fake.app/Contents/Info.plist"), "x").unwrap();
        let tgz = dir.join("fake.app.tar.gz");
        let ok = std::process::Command::new("tar").arg("-czf").arg(&tgz).arg("-C").arg(&dir).arg("Fake.app").status().unwrap();
        assert!(ok.success());
        let err = preinstall_check(&std::fs::read(&tgz).unwrap()).unwrap_err();
        assert!(err.contains("codesign"), "{err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn team_id_parse() {
        let out = "Identifier=com.interappdev.mikedown\nTeamIdentifier=UU626VCLYW\nSealed Resources version=2";
        assert_eq!(parse_team_id(out), Some("UU626VCLYW"));
        assert_eq!(parse_team_id("TeamIdentifier=not set"), None);
        assert_eq!(parse_team_id("nothing"), None);
    }
}
