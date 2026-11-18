use anyhow::{anyhow, Context, Result};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::models::StreamEvent;
use crate::util::{
    emit_event, is_cancelled, setup_signal_handler, spawn_cancel_listener,
};
use crate::validation::validate_package_name;
use super::helper::{detect_helper, find_helper_path};

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
                let err_msg = "No supported AUR helper (yay or paru) was found installed on the system.".to_string();
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

    emit_event(&StreamEvent::Log {
        level: "info".to_string(),
        message: op_description,
    });

    let mut cmd = if is_root {
        let user = match sudo_user.as_deref() {
            Some(u) => u,
            None => {
                let msg = "Cannot run AUR helper as root without a non-root user (SUDO_USER/PKEXEC_UID)";
                emit_event(&StreamEvent::Log {
                    level: "error".to_string(),
                    message: msg.to_string(),
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
                "--nodiffmenu",
                "--noeditmenu",
                "--nocleanmenu",
                "--nouseask",
            ]);
        }
        ("yay", AurOperation::Upgrade) => {
            cmd.args([
                "-Su",
                "--aur",
                "--noconfirm",
                "--nodiffmenu",
                "--noeditmenu",
                "--nocleanmenu",
                "--nouseask",
            ]);
        }
        ("paru", AurOperation::Install(pkg)) => {
            cmd.args([
                "-S",
                pkg,
                "--noconfirm",
                "--skipreview",
            ]);
        }
        ("paru", AurOperation::Upgrade) => {
            cmd.args([
                "-Sua",
                "--noconfirm",
                "--skipreview",
            ]);
        }
        _ => return Err(anyhow!("Unsupported AUR helper '{helper_name}'")),
    }

    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().with_context(|| format!("Failed to spawn {helper_name}"))?;

    let stdout = child.stdout.take().context("Failed to open child stdout")?;
    let stderr = child.stderr.take().context("Failed to open child stderr")?;

    let stdout_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for l in reader.lines().map_while(Result::ok) {
            emit_event(&StreamEvent::Log {
                level: "info".to_string(),
                message: l,
            });
        }
    });

    let stderr_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for l in reader.lines().map_while(Result::ok) {
            emit_event(&StreamEvent::Log {
                level: "warn".to_string(),
                message: l,
            });
        }
    });

    let timeout_duration = Duration::from_secs(timeout_secs.unwrap_or(1800));
    let start_time = Instant::now();

    loop {
        if is_cancelled() {
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
            return Err(anyhow!("AUR operation was cancelled"));
        }

        if start_time.elapsed() > timeout_duration {
            let _ = child.kill();
            emit_event(&StreamEvent::Complete {
                success: false,
                message: Some(format!("Operation timed out after {} seconds", timeout_duration.as_secs())),
                code: Some("timeout".to_string()),
                details: None,
            });
            let _ = child.wait();
            let _ = stdout_handle.join();
            let _ = stderr_handle.join();
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
                return Err(e).context("Error waiting for child process");
            }
        }
    }
}
