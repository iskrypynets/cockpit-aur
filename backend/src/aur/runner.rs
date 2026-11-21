use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use super::helper::{detect_helper, find_helper_path};
use crate::models::StreamEvent;
use crate::util::{emit_event, is_explicit_cancel, setup_signal_handler, spawn_cancel_listener};
use crate::validation::validate_package_name;

const OPERATION_FILE: &str = "/tmp/cockpit-aur-operation.json";
const LOG_FILE: &str = "/tmp/cockpit-aur-upgrade.log";

#[derive(Serialize, Deserialize, Clone)]
pub struct AurOperationStatus {
    pub status: String, // "idle", "running", "completed", "failed", "cancelled"
    pub operation: String,
    pub target: Option<String>,
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
    pid: Option<u32>,
    started_at: u64,
    exit_code: Option<i32>,
    error: Option<&str>,
) {
    let op_status = AurOperationStatus {
        status: status.to_string(),
        operation: operation.to_string(),
        target: target.map(|s| s.to_string()),
        pid,
        started_at,
        updated_at: current_timestamp(),
        exit_code,
        error: error.map(|s| s.to_string()),
    };
    let _ = crate::util::write_json_atomic(std::path::Path::new(OPERATION_FILE), &op_status);
}

pub fn get_operation_status() -> Result<()> {
    if let Ok(content) = std::fs::read_to_string(OPERATION_FILE) {
        if let Ok(mut status) = serde_json::from_str::<AurOperationStatus>(&content) {
            // If marked as running, verify if the process is actually alive
            if status.status == "running" {
                if let Some(pid) = status.pid {
                    let proc_path = format!("/proc/{}", pid);
                    if !std::path::Path::new(&proc_path).exists() {
                        status.status = "interrupted".to_string();
                        status.error = Some("Operation process terminated unexpectedly".to_string());
                        let _ = crate::util::write_json_atomic(std::path::Path::new(OPERATION_FILE), &status);
                    }
                }
            }
            return crate::util::emit_json(&status);
        }
    }
    crate::util::emit_json(&serde_json::json!({
        "status": "idle",
        "operation": "none",
        "started_at": 0,
        "updated_at": 0
    }))
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

#[derive(Clone, Copy)]
pub enum AurOperation<'a> {
    Install(&'a str),
    Upgrade,
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

    let op_description = match op {
        AurOperation::Install(pkg) => format!("Installing AUR package '{pkg}' using {helper_name}"),
        AurOperation::Upgrade => format!("Upgrading AUR packages using {helper_name}"),
    };

    if let Ok(handle) = crate::alpm::get_handle() {
        let log_msg = match op {
            AurOperation::Install(pkg) => {
                format!("Running 'cockpit-aur aur-install {pkg}' (cockpit)\n")
            }
            AurOperation::Upgrade => "Running 'cockpit-aur aur-upgrade' (cockpit)\n".to_string(),
        };
        let _ = handle.log_action("COCKPIT-AUR", log_msg);
    }

    emit_event(&StreamEvent::Log {
        level: "info".to_string(),
        message: format!("[COCKPIT-AUR] {}", op_description),
    });

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
        c.arg("-u").arg(user).arg("--").arg(&helper_path);
        c
    } else {
        Command::new(&helper_path)
    };

    match (helper_name.as_str(), op) {
        ("yay", AurOperation::Install(pkg)) => {
            cmd.args([
                "-S",
                pkg,
                "--noconfirm",
                "--answerclean",
                "None",
                "--answerdiff",
                "None",
                "--answeredit",
                "None",
                "--answerupgrade",
                "None",
            ]);
        }
        ("yay", AurOperation::Upgrade) => {
            cmd.args([
                "-Sua",
                "--noconfirm",
                "--answerclean",
                "None",
                "--answerdiff",
                "None",
                "--answeredit",
                "None",
                "--answerupgrade",
                "None",
            ]);
        }
        ("paru", AurOperation::Install(pkg)) => {
            cmd.args(["-S", pkg, "--noconfirm", "--skipreview"]);
        }
        ("paru", AurOperation::Upgrade) => {
            cmd.args(["-Sua", "--noconfirm", "--skipreview"]);
        }
        _ => return Err(anyhow!("Unsupported AUR helper '{helper_name}'")),
    }

    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .with_context(|| format!("Failed to spawn {helper_name}"))?;

    let (op_name, op_target) = match op {
        AurOperation::Install(pkg) => ("install", Some(pkg)),
        AurOperation::Upgrade => ("upgrade", None),
    };

    let started_at = current_timestamp();
    // Truncate previous log file and record running operation status
    let _ = std::fs::write(LOG_FILE, "");
    append_to_log_file(&format!("[COCKPIT-AUR] {op_description}"));
    write_operation_status(
        "running",
        op_name,
        op_target,
        Some(child.id()),
        started_at,
        None,
        None,
    );

    let stdout = child.stdout.take().context("Failed to open child stdout")?;
    let stderr = child.stderr.take().context("Failed to open child stderr")?;

    let stdout_handle = std::thread::spawn(move || {
        use std::io::Read;
        let mut reader = stdout;
        let mut buf = [0u8; 1024];
        let mut line_buf = Vec::new();
        let mut last_line = String::new();

        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            for &b in &buf[..n] {
                if b == b'\n' || b == b'\r' {
                    if !line_buf.is_empty() {
                        let s = String::from_utf8_lossy(&line_buf).trim().to_string();
                        line_buf.clear();
                        if !s.is_empty() && s != last_line {
                            last_line = s.clone();
                            let formatted = format!("[AUR] {s}");
                            append_to_log_file(&formatted);
                            emit_event(&StreamEvent::Log {
                                level: "info".to_string(),
                                message: formatted,
                            });
                        }
                    }
                } else {
                    line_buf.push(b);
                }
            }
        }
        if !line_buf.is_empty() {
            let s = String::from_utf8_lossy(&line_buf).trim().to_string();
            if !s.is_empty() && s != last_line {
                let formatted = format!("[AUR] {s}");
                append_to_log_file(&formatted);
                emit_event(&StreamEvent::Log {
                    level: "info".to_string(),
                    message: formatted,
                });
            }
        }
    });

    let stderr_handle = std::thread::spawn(move || {
        use std::io::Read;
        let mut reader = stderr;
        let mut buf = [0u8; 1024];
        let mut line_buf = Vec::new();
        let mut last_line = String::new();

        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            for &b in &buf[..n] {
                if b == b'\n' || b == b'\r' {
                    if !line_buf.is_empty() {
                        let s = String::from_utf8_lossy(&line_buf).trim().to_string();
                        line_buf.clear();
                        if !s.is_empty() && s != last_line {
                            last_line = s.clone();
                            let formatted = format!("[AUR] {s}");
                            append_to_log_file(&formatted);
                            emit_event(&StreamEvent::Log {
                                level: "warn".to_string(),
                                message: formatted,
                            });
                        }
                    }
                } else {
                    line_buf.push(b);
                }
            }
        }
        if !line_buf.is_empty() {
            let s = String::from_utf8_lossy(&line_buf).trim().to_string();
            if !s.is_empty() && s != last_line {
                let formatted = format!("[AUR] {s}");
                append_to_log_file(&formatted);
                emit_event(&StreamEvent::Log {
                    level: "warn".to_string(),
                    message: formatted,
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
            emit_event(&StreamEvent::Complete {
                success: false,
                message: Some("Operation cancelled by user".to_string()),
                code: Some("cancelled".to_string()),
                details: None,
            });
            let _ = child.wait();
            let _ = stdout_handle.join();
            let _ = stderr_handle.join();
            write_operation_status(
                "cancelled",
                op_name,
                op_target,
                Some(child.id()),
                started_at,
                Some(-1),
                Some("Operation cancelled by user"),
            );
            return Err(anyhow!("AUR operation was cancelled"));
        }

        if start_time.elapsed() > timeout_duration {
            let _ = child.kill();
            let err_msg = format!(
                "Operation timed out after {} seconds",
                timeout_duration.as_secs()
            );
            emit_event(&StreamEvent::Complete {
                success: false,
                message: Some(err_msg.clone()),
                code: Some("timeout".to_string()),
                details: None,
            });
            let _ = child.wait();
            let _ = stdout_handle.join();
            let _ = stderr_handle.join();
            write_operation_status(
                "failed",
                op_name,
                op_target,
                Some(child.id()),
                started_at,
                Some(-1),
                Some(&err_msg),
            );
            return Err(anyhow!("AUR operation timed out"));
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                let _ = stdout_handle.join();
                let _ = stderr_handle.join();

                if status.success() {
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
                        Some(child.id()),
                        started_at,
                        Some(0),
                        None,
                    );
                    return Ok(());
                } else {
                    let exit_code = status.code().unwrap_or(-1);
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
                        Some(child.id()),
                        started_at,
                        Some(exit_code),
                        Some(&err_msg),
                    );
                    return Err(anyhow!(err_msg));
                }
            }
            Ok(None) => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                let _ = child.kill();
                let _ = stdout_handle.join();
                let _ = stderr_handle.join();
                write_operation_status(
                    "failed",
                    op_name,
                    op_target,
                    Some(child.id()),
                    started_at,
                    Some(-1),
                    Some(&e.to_string()),
                );
                return Err(e).context("Error waiting for child process");
            }
        }
    }
}
