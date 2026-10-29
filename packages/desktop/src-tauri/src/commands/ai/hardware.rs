//! This machine's memory, CPU and GPU, for the setup wizard's "can it run
//! models locally" hint (`recommendSetupPath` in core's `ai/setup.ts`). The
//! shape is core's `AiHardwareInfo`.
//!
//! - Total memory and the CPU brand come from `sysinfo`.
//! - Apple Silicon is decided at compile time (macOS on aarch64); its GPU
//!   shares the memory, so it reports as `apple` with the total as VRAM.
//! - An NVIDIA card is read through `nvidia-smi` when it is on the PATH
//!   (Windows and Linux). A missing, failing or slow `nvidia-smi` only means
//!   no GPU is reported; the call never fails for it.
//!
//! Hardware does not change while the app runs: the answer is read once,
//! cached, and logged once per session.

use std::time::Duration;

use serde::Serialize;
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};
use tokio::sync::OnceCell;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    /// `nvidia`, `amd`, `apple` or `other`.
    pub vendor: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vram_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareInfo {
    /// Node's names, as VS Code reports them: `arm64`, `x64`.
    pub arch: String,
    /// Node's names: `darwin`, `win32`, `linux`.
    pub platform: String,
    pub total_memory_bytes: u64,
    pub apple_silicon: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gpu: Option<GpuInfo>,
}

/// `nvidia-smi` gets this long; a driver that hangs costs the hint, not the wizard.
const NVIDIA_SMI_TIMEOUT: Duration = Duration::from_secs(3);

static HARDWARE: OnceCell<HardwareInfo> = OnceCell::const_new();

/// Rust's `std::env::consts` names as Node's (`process.arch`, `process.platform`).
pub fn node_names(arch: &str, os: &str) -> (String, String) {
    let arch = match arch {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        "x86" => "ia32",
        other => other,
    };
    let platform = match os {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    };
    (arch.to_string(), platform.to_string())
}

/// Bytes from an `nvidia-smi` memory field: `24564 MiB`, `24564` (MiB, with
/// `nounits`), `24 GiB`.
fn parse_memory(field: &str) -> Option<u64> {
    let field = field.trim();
    let (number, unit) = match field.find(|c: char| !(c.is_ascii_digit() || c == '.')) {
        Some(at) => (field[..at].trim(), field[at..].trim().to_ascii_lowercase()),
        None => (field, String::new()),
    };
    let value: f64 = number.parse().ok()?;
    let scale = match unit.as_str() {
        "" | "mib" | "mb" => 1024.0 * 1024.0,
        "gib" | "gb" => 1024.0 * 1024.0 * 1024.0,
        "kib" | "kb" => 1024.0,
        _ => return None,
    };
    let bytes = value * scale;
    (bytes > 0.0).then_some(bytes as u64)
}

/// The card with the most memory from `nvidia-smi --query-gpu=name,memory.total
/// --format=csv,noheader` (one line per card: `NVIDIA GeForce RTX 4090, 24564 MiB`).
pub fn parse_nvidia_smi(output: &str) -> Option<GpuInfo> {
    output
        .lines()
        .filter_map(|line| {
            let (name, memory) = line.rsplit_once(',')?;
            let name = name.trim();
            let vram = parse_memory(memory)?;
            Some(GpuInfo { vendor: "nvidia".into(), vram_bytes: Some(vram), name: (!name.is_empty()).then(|| name.to_string()) })
        })
        .max_by_key(|gpu| gpu.vram_bytes.unwrap_or(0))
}

/// Run `nvidia-smi` if it is on the PATH. None when it is absent, fails or
/// does not answer in time.
async fn nvidia_gpu() -> Option<GpuInfo> {
    let run = tauri::async_runtime::spawn_blocking(|| {
        let mut command = std::process::Command::new("nvidia-smi");
        command.args(["--query-gpu=name,memory.total", "--format=csv,noheader"]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW: no console flashes up from a GUI app.
            command.creation_flags(0x0800_0000);
        }
        command.output().ok().filter(|out| out.status.success()).map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
    });
    let output = tokio::time::timeout(NVIDIA_SMI_TIMEOUT, run).await.ok()?.ok()??;
    parse_nvidia_smi(&output)
}

async fn read() -> HardwareInfo {
    let system = System::new_with_specifics(
        RefreshKind::nothing().with_memory(MemoryRefreshKind::nothing().with_ram()).with_cpu(CpuRefreshKind::nothing()),
    );
    let total_memory_bytes = system.total_memory();
    let cpu = system.cpus().first().map(|c| c.brand().trim().to_string()).filter(|b| !b.is_empty());
    let (arch, platform) = node_names(std::env::consts::ARCH, std::env::consts::OS);
    let apple_silicon = cfg!(all(target_os = "macos", target_arch = "aarch64"));
    let gpu = if apple_silicon {
        // Unified memory: the GPU can use what the machine has.
        Some(GpuInfo { vendor: "apple".into(), vram_bytes: Some(total_memory_bytes), name: cpu.clone() })
    } else if cfg!(target_os = "macos") {
        None
    } else {
        nvidia_gpu().await
    };
    HardwareInfo { arch, platform, total_memory_bytes, apple_silicon, cpu, gpu }
}

/// "Hardware: darwin arm64, Apple M2 Max, 32 GB, Apple Silicon".
pub fn log_line(info: &HardwareInfo) -> String {
    let gb = (info.total_memory_bytes as f64 / (1024.0 * 1024.0 * 1024.0)).round() as u64;
    let mut parts = vec![format!("{} {}", info.platform, info.arch)];
    if let Some(cpu) = &info.cpu {
        parts.push(cpu.clone());
    }
    parts.push(format!("{gb} GB"));
    match &info.gpu {
        _ if info.apple_silicon => parts.push("Apple Silicon".into()),
        Some(gpu) => {
            let vram = gpu.vram_bytes.map(|b| format!(" ({} GB)", (b as f64 / (1024.0 * 1024.0 * 1024.0)).round() as u64)).unwrap_or_default();
            parts.push(format!("{}{vram}", gpu.name.as_deref().unwrap_or(&gpu.vendor)));
        }
        None => parts.push("no GPU found".into()),
    }
    format!("Hardware: {}", parts.join(", "))
}

/// The hardware, read on the first call (and logged then), cached after.
pub async fn hardware_info() -> HardwareInfo {
    HARDWARE
        .get_or_init(|| async {
            let info = read().await;
            eprintln!("[mikedown ai] {}", log_line(&info));
            info
        })
        .await
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_names_match_process_arch_and_platform() {
        assert_eq!(node_names("aarch64", "macos"), ("arm64".to_string(), "darwin".to_string()));
        assert_eq!(node_names("x86_64", "windows"), ("x64".to_string(), "win32".to_string()));
        assert_eq!(node_names("x86_64", "linux"), ("x64".to_string(), "linux".to_string()));
    }

    #[test]
    fn nvidia_smi_output_gives_the_largest_card() {
        let out = "NVIDIA GeForce RTX 3060, 12288 MiB\nNVIDIA GeForce RTX 4090, 24564 MiB\n";
        let gpu = parse_nvidia_smi(out).unwrap();
        assert_eq!(gpu.vendor, "nvidia");
        assert_eq!(gpu.name.as_deref(), Some("NVIDIA GeForce RTX 4090"));
        assert_eq!(gpu.vram_bytes, Some(24564 * 1024 * 1024));
    }

    #[test]
    fn nvidia_smi_without_units_or_with_junk_is_handled() {
        assert_eq!(parse_nvidia_smi("Tesla T4, 15360").unwrap().vram_bytes, Some(15360 * 1024 * 1024));
        assert_eq!(parse_nvidia_smi(""), None);
        assert_eq!(parse_nvidia_smi("NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver."), None);
        assert_eq!(parse_nvidia_smi("Some GPU, [N/A]"), None);
    }

    #[test]
    fn serializes_as_core_hardware_info() {
        let info = HardwareInfo {
            arch: "arm64".into(),
            platform: "darwin".into(),
            total_memory_bytes: 32 * 1024 * 1024 * 1024,
            apple_silicon: true,
            cpu: Some("Apple M2 Max".into()),
            gpu: Some(GpuInfo { vendor: "apple".into(), vram_bytes: Some(1), name: None }),
        };
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["totalMemoryBytes"], 34359738368u64);
        assert_eq!(json["appleSilicon"], true);
        assert_eq!(json["gpu"]["vramBytes"], 1);
        assert!(json["gpu"].get("name").is_none());
        assert_eq!(log_line(&info), "Hardware: darwin arm64, Apple M2 Max, 32 GB, Apple Silicon");
    }

    #[tokio::test]
    async fn reads_this_machine_without_failing() {
        let info = read().await;
        assert!(info.total_memory_bytes > 0);
        assert!(!info.platform.is_empty());
    }

    #[test]
    fn the_log_line_names_the_card_or_says_none_was_found() {
        let mut info = HardwareInfo {
            arch: "x64".into(),
            platform: "linux".into(),
            total_memory_bytes: 64 * 1024 * 1024 * 1024,
            apple_silicon: false,
            cpu: Some("AMD Ryzen 9".into()),
            gpu: Some(GpuInfo { vendor: "nvidia".into(), vram_bytes: Some(24 * 1024 * 1024 * 1024), name: Some("NVIDIA GeForce RTX 4090".into()) }),
        };
        assert_eq!(log_line(&info), "Hardware: linux x64, AMD Ryzen 9, 64 GB, NVIDIA GeForce RTX 4090 (24 GB)");
        info.gpu = None;
        info.cpu = None;
        assert_eq!(log_line(&info), "Hardware: linux x64, 64 GB, no GPU found");
    }

    // ── nvidia-smi on the PATH ──────────────────────────────────────────────
    //
    // `PATH` is process-wide and other tests start programs, so each case runs
    // in a copy of this test binary with its own PATH (the parent tests below
    // spawn it); the child test does nothing in a normal run.

    /// The child half: reads the GPU with whatever PATH this process was given and checks the expectation named in the environment.
    #[tokio::test]
    async fn child_reads_nvidia_smi_from_the_path() {
        let Ok(expect) = std::env::var("MIKEDOWN_T1_NVIDIA_EXPECT") else { return };
        let gpu = nvidia_gpu().await;
        match expect.as_str() {
            "none" => assert_eq!(gpu, None),
            "rtx4090" => {
                let gpu = gpu.expect("a card");
                assert_eq!(gpu.vendor, "nvidia");
                assert_eq!(gpu.name.as_deref(), Some("NVIDIA GeForce RTX 4090"));
                assert_eq!(gpu.vram_bytes, Some(24564 * 1024 * 1024));
            }
            other => panic!("unknown expectation {other}"),
        }
    }

    #[cfg(unix)]
    mod with_nvidia_smi {
        use std::os::unix::fs::PermissionsExt;
        use std::path::{Path, PathBuf};
        use std::process::Command;
        use std::time::{Duration, Instant};

        /// A folder to use as the whole PATH, with `nvidia-smi` as `script` (none: the folder is empty).
        fn path_with(tag: &str, script: Option<&str>) -> PathBuf {
            let dir = std::env::temp_dir().join(format!("mikedown-t1-nvidia-{}-{tag}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            if let Some(body) = script {
                let file = dir.join("nvidia-smi");
                std::fs::write(&file, body).unwrap();
                std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            dir
        }

        /// This binary, running only the child test, with `path` as its PATH.
        fn run_child(path: &Path, expect: &str) -> (bool, String, Duration) {
            let started = Instant::now();
            let out = Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "commands::ai::hardware::tests::child_reads_nvidia_smi_from_the_path", "--nocapture", "--test-threads=1"])
                .env("PATH", path)
                .env("MIKEDOWN_T1_NVIDIA_EXPECT", expect)
                .output()
                .unwrap();
            let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
            // "1 passed" proves the child test really ran and was not filtered out.
            (out.status.success() && text.contains("1 passed"), text, started.elapsed())
        }

        /// What `nvidia-smi` prints for two cards, after checking it was called the way `nvidia_gpu` should call it.
        const TWO_CARDS: &str = "#!/bin/sh\n[ \"$1\" = \"--query-gpu=name,memory.total\" ] && [ \"$2\" = \"--format=csv,noheader\" ] || exit 2\necho \"NVIDIA GeForce RTX 3060, 12288 MiB\"\necho \"NVIDIA GeForce RTX 4090, 24564 MiB\"\n";

        #[test]
        fn an_nvidia_smi_on_the_path_is_asked_for_name_and_memory_and_the_largest_card_wins() {
            let (ok, text, _) = run_child(&path_with("present", Some(TWO_CARDS)), "rtx4090");
            assert!(ok, "{text}");
        }

        #[test]
        fn no_nvidia_smi_on_the_path_is_no_gpu_not_an_error() {
            let (ok, text, _) = run_child(&path_with("absent", None), "none");
            assert!(ok, "{text}");
        }

        #[test]
        fn an_nvidia_smi_that_fails_or_prints_junk_is_no_gpu() {
            let failing = "#!/bin/sh\necho \"NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver.\"\nexit 9\n";
            let (ok, text, _) = run_child(&path_with("failing", Some(failing)), "none");
            assert!(ok, "{text}");
            // Exit 0 with nothing it can read.
            let junk = "#!/bin/sh\necho \"No devices were found\"\n";
            let (ok, text, _) = run_child(&path_with("junk", Some(junk)), "none");
            assert!(ok, "{text}");
        }

        #[test]
        fn an_nvidia_smi_that_hangs_costs_the_hint_after_three_seconds_and_nothing_more() {
            let (ok, text, elapsed) = run_child(&path_with("hang", Some("#!/bin/sh\nexec /bin/sleep 20\n")), "none");
            assert!(ok, "{text}");
            assert!(elapsed >= Duration::from_secs(3) && elapsed < Duration::from_secs(15), "took {elapsed:?}");
        }
    }
}
