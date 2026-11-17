use super::models::AurHelperInfo;
use std::path::{Path, PathBuf};
use std::process::Command;

const CANDIDATE_HELPERS: &[&str] = &["yay", "paru"];
const STANDARD_BIN_DIRS: &[&str] = &["/usr/bin", "/usr/local/bin", "/bin"];

/// Find path to an AUR helper executable
pub fn find_helper_path(name: &str) -> Option<PathBuf> {
    for dir in STANDARD_BIN_DIRS {
        let p = Path::new(dir).join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    // Also try checking PATH
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let p = dir.join(name);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

/// Detect available AUR helper and get its version string
pub fn detect_helper() -> AurHelperInfo {
    for &helper_name in CANDIDATE_HELPERS {
        if let Some(path) = find_helper_path(helper_name) {
            let version = Command::new(&path)
                .arg("--version")
                .output()
                .ok()
                .and_then(|out| {
                    if out.status.success() {
                        String::from_utf8(out.stdout)
                            .ok()
                            .map(|s| s.lines().next().unwrap_or("").trim().to_string())
                    } else {
                        None
                    }
                });

            return AurHelperInfo {
                helper: helper_name.to_string(),
                path: Some(path.to_string_lossy().into_owned()),
                available: true,
                version,
            };
        }
    }

    AurHelperInfo {
        helper: "none".to_string(),
        path: None,
        available: false,
        version: None,
    }
}
