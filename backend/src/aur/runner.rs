use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use super::helper::{detect_helper, find_helper_path};
use crate::models::StreamEvent;
use crate::util::{emit_event, is_explicit_cancel, setup_signal_handler, spawn_cancel_listener};
use crate::validation::validate_package_name;

const OPERATION_FILE: &str = "/tmp/cockpit-aur-operation.json";
const LOG_FILE: &str = "/tmp/cockpit-aur-upgrade.log";
const EXIT_CODE_FILE: &str = "/tmp/cockpit-aur-upgrade.exit";

#[derive(Serialize, Deserialize, Clone)]
pub struct AurOperationStatus {
    pub status: String, // "idle", "running", "completed", "failed", "cancelled", "interrupted"
    pub operation: String,
    pub target: Option<String>,
    #[serde(default)]
    pub packages: Vec<String>,
    #[serde(default)]
    pub total: usize,
    pub pid: Option<u32>,
    pub started_at: u64,
    pub updated_at: u64,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn write_operation_status(
    status: &str,
    operation: &str,
    target: Option<&str>,
    packages: &[String],
    pid: Option<u32>,
    started_at: u64,
    exit_code: Option<i32>,
    error: Option<&str>,
) {
    let op_status = AurOperationStatus {
        status: status.to_string(),
        operation: operation.to_string(),
        target: target.map(|s| s.to_string()),
        packages: packages.to_vec(),
        total: packages.len(),
        pid,
        started_at,
        updated_at: current_timestamp(),
        exit_code,
        error: error.map(|s| s.to_string()),
    };
    let _ = crate::util::write_json_atomic(std::path::Path::new(OPERATION_FILE), &op_status);
    if status != "running" && status != "idle" {
        super::history::record_aur_operation(
            status,
            operation,
            target,
            packages,
            started_at,
            current_timestamp(),
            exit_code,
            error,
        );
    }
}

pub fn get_operation_status() -> Result<()> {
    if let Ok(content) = std::fs::read_to_string(OPERATION_FILE) {
        if let Ok(mut status) = serde_json::from_str::<AurOperationStatus>(&content) {
            // Check if the exit code file exists
            if let Ok(exit_str) = std::fs::read_to_string(EXIT_CODE_FILE) {
                if let Ok(code) = exit_str.trim().parse::<i32>() {
                    if code == 0 {
                        status.status = "completed".to_string();
                        status.exit_code = Some(0);
                        status.error = None;
                    } else {
                        status.status = "failed".to_string();
                        status.exit_code = Some(code);
                        status.error = Some(format!("AUR operation failed with exit code {code}"));
                    }
                    status.updated_at = current_timestamp();
                    let _ = crate::util::write_json_atomic(std::path::Path::new(OPERATION_FILE), &status);
                    return crate::util::emit_json(&status);
                }
            }

            // If marked as running, verify if the process or any AUR helper is actually alive
            if status.status == "running" {
                let pid_alive = match status.pid {
                    Some(pid) => std::path::Path::new(&format!("/proc/{}", pid)).exists(),
                    None => false,
                };
                let helper_alive = is_aur_helper_running();
                if !pid_alive && !helper_alive {
                    status.status = "interrupted".to_string();
                    status.error = Some("Operation process terminated unexpectedly".to_string());
                    let _ = crate::util::write_json_atomic(std::path::Path::new(OPERATION_FILE), &status);
                }
            }
            return crate::util::emit_json(&status);
        }
    }
    crate::util::emit_json(&serde_json::json!({
        "status": "idle",
        "operation": "none",
        "target": null,
        "packages": [],
        "total": 0,
        "pid": null,
        "started_at": 0,
        "updated_at": 0
    }))
}

fn is_aur_helper_running() -> bool {
    for binary in ["yay", "makepkg", "paru", "pacman"] {
        if let Ok(output) = std::process::Command::new("pgrep").args(["-x", binary]).output() {
            if !output.stdout.is_empty() {
                return true;
            }
        }
    }
    false
}

pub fn get_operation_log() -> Result<()> {
    let content = std::fs::read_to_string(LOG_FILE).unwrap_or_default();
    crate::util::emit_json(&serde_json::json!({
        "log": content
    }))
}

fn append_to_log_file(line: &str) {
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(LOG_FILE) {
        let _ = writeln!(f, "{line}");
    }
}

#[derive(Clone)]
pub enum AurOperation<'a> {
    Install(&'a str),
    Upgrade(&'a [String]),
}

pub fn run_aur_operation(
    op: AurOperation,
    preferred_helper: Option<&str>,
    timeout_secs: Option<u64>,
) -> Result<()> {
    setup_signal_handler()?;
    spawn_cancel_listener()?;

    crate::network::require_network()?;

    if let AurOperation::Install(pkg_name) = op {
        validate_package_name(pkg_name)
            .with_context(|| format!("Invalid AUR package name: '{pkg_name}'"))?;
    }

    let is_root = unsafe { libc::geteuid() == 0 };
    let sudo_user = std::env::var("SUDO_USER").ok().filter(|u| u != "root");

    if is_root && sudo_user.is_none() {
        let err_msg = "Running AUR helpers as root is forbidden by makepkg/yay and Cockpit security policy. Please execute as a standard user.".to_string();
        emit_event(&StreamEvent::Complete {
            success: false,
            message: Some(err_msg.clone()),
            code: Some("root_forbidden".to_string()),
            details: None,
        });
        return Err(anyhow!(err_msg));
    }

    let helper_name = match preferred_helper {
        Some(name) if name == "yay" || name == "paru" => name.to_string(),
        _ => {
            let detected = detect_helper();
            if !detected.available {
                let err_msg =
                    "No supported AUR helper (yay or paru) was found installed on the system."
                        .to_string();
                emit_event(&StreamEvent::Complete {
                    success: false,
                    message: Some(err_msg.clone()),
                    code: Some("helper_not_found".to_string()),
                    details: None,
                });
                return Err(anyhow!(err_msg));
            }
            detected.helper
        }
    };

    let helper_path = find_helper_path(&helper_name)
        .ok_or_else(|| anyhow!("Failed to locate helper executable for '{helper_name}'"))?;

    let op_description = match &op {
        AurOperation::Install(pkg) => format!("Installing AUR package '{pkg}' using {helper_name}"),
        AurOperation::Upgrade(pkgs) if !pkgs.is_empty() => {
            format!("Upgrading {} AUR package(s) using {helper_name}", pkgs.len())
        }
        AurOperation::Upgrade(_) => format!("Upgrading AUR packages using {helper_name}"),
    };

    if let Ok(handle) = crate::alpm::get_handle() {
        let log_msg = match &op {
            AurOperation::Install(pkg) => {
                format!("Running 'cockpit-aur aur-install {pkg}' (cockpit)\n")
            }
            AurOperation::Upgrade(_) => "Running 'cockpit-aur aur-upgrade' (cockpit)\n".to_string(),
        };
        let _ = handle.log_action("COCKPIT-AUR", log_msg);
    }

    emit_event(&StreamEvent::Log {
        level: "info".to_string(),
        message: format!("[COCKPIT-AUR] {}", op_description),
    });

    let has_systemd_run = !is_root
        && std::process::Command::new("systemd-run")
            .args(["--user", "--scope", "true"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

    let mut helper_cmd_args: Vec<String> = Vec::new();
    helper_cmd_args.push(helper_path.to_string_lossy().to_string());

    match (&helper_name[..], &op) {
        ("yay", AurOperation::Install(pkg)) => {
            helper_cmd_args.extend([
                "-S".into(),
                pkg.to_string(),
                "--noconfirm".into(),
                "--answerclean".into(),
                "None".into(),
                "--answerdiff".into(),
                "None".into(),
                "--answeredit".into(),
                "None".into(),
                "--answerupgrade".into(),
                "None".into(),
            ]);
        }
        ("yay", AurOperation::Upgrade(_)) => {
            helper_cmd_args.extend([
                "-Sua".into(),
                "--noconfirm".into(),
                "--answerclean".into(),
                "None".into(),
                "--answerdiff".into(),
                "None".into(),
                "--answeredit".into(),
                "None".into(),
                "--answerupgrade".into(),
                "None".into(),
            ]);
        }
        ("paru", AurOperation::Install(pkg)) => {
            helper_cmd_args.extend(["-S".into(), pkg.to_string(), "--noconfirm".into(), "--skipreview".into()]);
        }
        ("paru", AurOperation::Upgrade(_)) => {
            helper_cmd_args.extend(["-Sua".into(), "--noconfirm".into(), "--skipreview".into()]);
        }
        _ => return Err(anyhow!("Unsupported AUR helper '{helper_name}'")),
    }

    // Reset previous exit code file and truncate previous log file
    let _ = std::fs::remove_file(EXIT_CODE_FILE);
    let _ = std::fs::write(LOG_FILE, "");

    append_to_log_file(&format!("[COCKPIT-AUR] {op_description}"));

    // We execute the helper via a shell script wrapper that redirects stdout and stderr
    // directly to LOG_FILE and writes the exit code to EXIT_CODE_FILE.
    // This provides 100% resilience against broken pipes (SIGPIPE) when Cockpit session
    // disconnects, and guarantees the exit code is saved to disk even if the parent dies!
    let shell_script = format!(
        "\"$@\" > '{LOG_FILE}' 2>&1; ret=$?; echo $ret > '{EXIT_CODE_FILE}'; exit $ret"
    );

    let mut cmd = if is_root {
        let user = match sudo_user.as_deref() {
            Some(u) => u,
            None => {
                let msg =
                    "Cannot run AUR helper as root without a non-root user (SUDO_USER/PKEXEC_UID)";
                emit_event(&StreamEvent::Log {
                    level: "error".to_string(),
                    message: format!("[COCKPIT-AUR] error: {msg}"),
                });
                return Err(anyhow!("{msg}"));
            }
        };
        let mut c = Command::new("runuser");
        c.arg("-u").arg(user).arg("--").arg("sh").arg("-c").arg(&shell_script).arg("--");
        c.args(&helper_cmd_args);
        c
    } else if has_systemd_run {
        let mut c = Command::new("systemd-run");
        c.args(["--user", "--scope", "-q", "--", "sh", "-c", &shell_script, "--"]);
        c.args(&helper_cmd_args);
        c
    } else {
        let mut c = Command::new("sh");
        c.args(["-c", &shell_script, "--"]);
        c.args(&helper_cmd_args);
        c
    };

    use std::os::unix::process::CommandExt;

    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    // Put child in its own process group
    cmd.process_group(0);

    let mut child = cmd
        .spawn()
        .with_context(|| format!("Failed to spawn {helper_name}"))?;

    let (op_name, op_target, op_packages) = match &op {
        AurOperation::Install(pkg) => ("install", Some(*pkg), vec![pkg.to_string()]),
        AurOperation::Upgrade(pkgs) => ("upgrade", None, pkgs.to_vec()),
    };

    let started_at = current_timestamp();
    write_operation_status(
        "running",
        op_name,
        op_target,
        &op_packages,
        Some(child.id()),
        started_at,
        None,
        None,
    );

    let is_finished = Arc::new(AtomicBool::new(false));
    let is_finished_clone = Arc::clone(&is_finished);

    let tail_handle = std::thread::spawn(move || {
        use std::io::Read;
        let start_wait = Instant::now();
        let file = loop {
            if let Ok(f) = std::fs::File::open(LOG_FILE) {
                break Some(f);
            }
            if is_finished_clone.load(AtomicOrdering::SeqCst) || start_wait.elapsed() > Duration::from_secs(5) {
                break None;
            }
            std::thread::sleep(Duration::from_millis(50));
        };

        let Some(file) = file else { return };
        let mut reader = std::io::BufReader::new(file);
        let mut last_line = String::new();
        let mut byte_buf = [0u8; 1024];
        let mut line_buf = Vec::new();

        loop {
            match reader.read(&mut byte_buf) {
                Ok(0) => {
                    if is_finished_clone.load(AtomicOrdering::SeqCst) {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                Ok(n) => {
                    for &b in &byte_buf[..n] {
                        if b == b'\n' || b == b'\r' {
                            if !line_buf.is_empty() {
                                let s = String::from_utf8_lossy(&line_buf).trim().to_string();
                                line_buf.clear();
                                if !s.is_empty() && s != last_line {
                                    last_line = s.clone();
                                    emit_event(&StreamEvent::Log {
                                        level: "info".to_string(),
                                        message: format!("[AUR] {s}"),
                                    });
                                }
                            }
                        } else {
                            line_buf.push(b);
                        }
                    }
                }
                Err(_) => break,
            }
        }
        if !line_buf.is_empty() {
            let s = String::from_utf8_lossy(&line_buf).trim().to_string();
            if !s.is_empty() && s != last_line {
                emit_event(&StreamEvent::Log {
                    level: "info".to_string(),
                    message: format!("[AUR] {s}"),
                });
            }
        }
    });

    let config = crate::config::AppConfig::load().unwrap_or_default();
    let timeout_duration =
        Duration::from_secs(timeout_secs.unwrap_or(config.aur_upgrade_timeout_secs));
    let start_time = Instant::now();

    loop {
        // Only kill the child if user explicitly clicked "Cancel" in the UI.
        // Stdin closing (e.g. session lock, tab disconnect) does NOT kill the ongoing upgrade!
        if is_explicit_cancel() {
            let _ = child.kill();
            let _ = std::process::Command::new("pkill").args(["-TERM", "-x", "makepkg"]).status();
            let _ = std::process::Command::new("pkill").args(["-TERM", "-x", "yay"]).status();
            is_finished.store(true, AtomicOrdering::SeqCst);
            let _ = child.wait();
            let _ = tail_handle.join();
            emit_event(&StreamEvent::Complete {
                success: false,
                message: Some("Operation cancelled by user".to_string()),
                code: Some("cancelled".to_string()),
                details: None,
            });
            write_operation_status(
                "cancelled",
                op_name,
                op_target,
                &op_packages,
                Some(child.id()),
                started_at,
                Some(-1),
                Some("Operation cancelled by user"),
            );
            return Err(anyhow!("AUR operation was cancelled"));
        }

        if start_time.elapsed() > timeout_duration {
            let _ = child.kill();
            let _ = std::process::Command::new("pkill").args(["-TERM", "-x", "makepkg"]).status();
            let _ = std::process::Command::new("pkill").args(["-TERM", "-x", "yay"]).status();
            is_finished.store(true, AtomicOrdering::SeqCst);
            let err_msg = format!(
                "Operation timed out after {} seconds",
                timeout_duration.as_secs()
            );
            let _ = child.wait();
            let _ = tail_handle.join();
            emit_event(&StreamEvent::Complete {
                success: false,
                message: Some(err_msg.clone()),
                code: Some("timeout".to_string()),
                details: None,
            });
            write_operation_status(
                "failed",
                op_name,
                op_target,
                &op_packages,
                Some(child.id()),
                started_at,
                Some(-1),
                Some(&err_msg),
            );
            return Err(anyhow!("AUR operation timed out"));
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                is_finished.store(true, AtomicOrdering::SeqCst);
                let _ = tail_handle.join();

                // Check exit code from EXIT_CODE_FILE first, falling back to process status code
                let exit_code = std::fs::read_to_string(EXIT_CODE_FILE)
                    .ok()
                    .and_then(|s| s.trim().parse::<i32>().ok())
                    .unwrap_or_else(|| status.code().unwrap_or(-1));

                if exit_code == 0 {
                    emit_event(&StreamEvent::Complete {
                        success: true,
                        message: Some("AUR operation completed successfully".to_string()),
                        code: None,
                        details: None,
                    });
                    write_operation_status(
                        "completed",
                        op_name,
                        op_target,
                        &op_packages,
                        Some(child.id()),
                        started_at,
                        Some(0),
                        None,
                    );
                    return Ok(());
                } else {
                    let err_msg = format!("AUR operation failed with exit code {exit_code}");
                    emit_event(&StreamEvent::Complete {
                        success: false,
                        message: Some(err_msg.clone()),
                        code: Some("failed".to_string()),
                        details: Some(format!("Exit code: {exit_code}")),
                    });
                    write_operation_status(
                        "failed",
                        op_name,
                        op_target,
                        &op_packages,
                        Some(child.id()),
                        started_at,
                        Some(exit_code),
                        Some(&err_msg),
                    );
                    return Err(anyhow!("{err_msg}"));
                }
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(500)),
            Err(e) => {
                is_finished.store(true, AtomicOrdering::SeqCst);
                let _ = tail_handle.join();
                let err_msg = format!("Error waiting on AUR operation: {e}");
                emit_event(&StreamEvent::Complete {
                    success: false,
                    message: Some(err_msg.clone()),
                    code: Some("failed".to_string()),
                    details: None,
                });
                write_operation_status(
                    "failed",
                    op_name,
                    op_target,
                    &op_packages,
                    Some(child.id()),
                    started_at,
                    Some(-1),
                    Some(&err_msg),
                );
                return Err(anyhow!("{err_msg}"));
            }
        }
    }
}
