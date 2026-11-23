use anyhow::{Result, anyhow};
use chrono::{Local, TimeZone};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const MAX_HISTORY_ENTRIES: usize = 100;
const MAX_LOG_FILES: usize = 30;
const TS_FMT: &str = "%Y-%m-%dT%H:%M:%S%z";
const OPERATION_FILE: &str = "/tmp/cockpit-aur-operation.json";
const LOG_FILE: &str = "/tmp/cockpit-aur-upgrade.log";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct AurHistoryEntry {
    pub id: String,
    pub timestamp: String,
    pub operation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(default)]
    pub packages: Vec<String>,
    pub status: String, // "completed", "failed", "cancelled", "interrupted"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_secs: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default)]
    pub has_log: bool,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct AurHistoryData {
    pub entries: Vec<AurHistoryEntry>,
}

#[derive(Serialize)]
pub struct AurHistoryResponse {
    pub entries: Vec<AurHistoryEntry>,
    pub total: usize,
}

#[derive(Serialize)]
pub struct AurHistoryLogResponse {
    pub id: String,
    pub log: String,
}

fn base_dir() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(".cache/cockpit-aur")
    } else {
        PathBuf::from("/tmp/cockpit-aur")
    }
}

fn history_file_path() -> PathBuf {
    base_dir().join("history.json")
}

fn logs_dir_path() -> PathBuf {
    base_dir().join("logs")
}

fn load_history_data() -> AurHistoryData {
    let path = history_file_path();
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(data) = serde_json::from_str::<AurHistoryData>(&content) {
            return data;
        }
    }
    AurHistoryData::default()
}

fn save_history_data(data: &AurHistoryData) -> Result<()> {
    let path = history_file_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    crate::util::write_json_atomic(&path, data)
}

fn cleanup_old_logs(logs_dir: &Path) {
    if let Ok(entries) = fs::read_dir(logs_dir) {
        let mut log_files: Vec<(PathBuf, std::time::SystemTime)> = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "log") {
                if let Ok(meta) = entry.metadata() {
                    let mtime = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
                    log_files.push((path, mtime));
                }
            }
        }
        if log_files.len() > MAX_LOG_FILES {
            log_files.sort_by_key(|(_, mtime)| *mtime);
            let to_remove = log_files.len() - MAX_LOG_FILES;
            for (path, _) in log_files.into_iter().take(to_remove) {
                let _ = fs::remove_file(path);
            }
        }
    }
}

pub fn record_aur_operation(
    status: &str,
    operation: &str,
    target: Option<&str>,
    packages: &[String],
    started_at: u64,
    updated_at: u64,
    exit_code: Option<i32>,
    error: Option<&str>,
) {
    if status == "running" || status == "idle" {
        return;
    }

    let id = format!("aur-{started_at}");
    let timestamp = if started_at > 0 {
        Local
            .timestamp_opt(started_at as i64, 0)
            .single()
            .map(|dt| dt.format(TS_FMT).to_string())
            .unwrap_or_else(|| Local::now().format(TS_FMT).to_string())
    } else {
        Local::now().format(TS_FMT).to_string()
    };

    let duration_secs = if updated_at >= started_at && started_at > 0 {
        Some(updated_at - started_at)
    } else {
        None
    };

    // Save log file
    let logs_dir = logs_dir_path();
    let _ = fs::create_dir_all(&logs_dir);
    let log_dest = logs_dir.join(format!("{id}.log"));
    let mut has_log = false;
    if Path::new(LOG_FILE).exists() {
        if fs::copy(LOG_FILE, &log_dest).is_ok() {
            has_log = true;
        }
    } else if log_dest.exists() {
        has_log = true;
    }
    cleanup_old_logs(&logs_dir);

    let mut data = load_history_data();
    if let Some(existing) = data.entries.iter_mut().find(|e| e.id == id) {
        existing.status = status.to_string();
        existing.exit_code = exit_code;
        existing.duration_secs = duration_secs;
        existing.error = error.map(|s| s.to_string());
        existing.has_log = has_log || existing.has_log;
    } else {
        let entry = AurHistoryEntry {
            id,
            timestamp,
            operation: operation.to_string(),
            target: target.map(|s| s.to_string()),
            packages: packages.to_vec(),
            status: status.to_string(),
            exit_code,
            duration_secs,
            error: error.map(|s| s.to_string()),
            has_log,
        };
        data.entries.insert(0, entry);
    }

    if data.entries.len() > MAX_HISTORY_ENTRIES {
        data.entries.truncate(MAX_HISTORY_ENTRIES);
    }

    let _ = save_history_data(&data);
}

/// Ingest current or recent `/tmp/cockpit-aur-operation.json` if not already archived.
fn ingest_recent_operation(data: &mut AurHistoryData) {
    if let Ok(content) = fs::read_to_string(OPERATION_FILE) {
        if let Ok(status) = serde_json::from_str::<super::runner::AurOperationStatus>(&content) {
            if status.status != "running" && status.status != "idle" {
                let id = format!("aur-{}", status.started_at);
                if !data.entries.iter().any(|e| e.id == id) {
                    record_aur_operation(
                        &status.status,
                        &status.operation,
                        status.target.as_deref(),
                        &status.packages,
                        status.started_at,
                        status.updated_at,
                        status.exit_code,
                        status.error.as_deref(),
                    );
                    *data = load_history_data();
                }
            }
        }
    }
}

pub fn get_aur_history(search: Option<&str>, limit: Option<usize>) -> Result<()> {
    let mut data = load_history_data();
    ingest_recent_operation(&mut data);

    let mut filtered: Vec<AurHistoryEntry> = if let Some(query) = search.map(|q| q.to_lowercase()) {
        data.entries
            .into_iter()
            .filter(|e| {
                e.packages.iter().any(|p| p.to_lowercase().contains(&query))
                    || e.target
                        .as_ref()
                        .is_some_and(|t| t.to_lowercase().contains(&query))
                    || e.operation.to_lowercase().contains(&query)
            })
            .collect()
    } else {
        data.entries
    };

    // Sort by timestamp descending (newest first)
    filtered.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    let total = filtered.len();
    if let Some(lim) = limit {
        if filtered.len() > lim {
            filtered.truncate(lim);
        }
    }

    crate::util::emit_json(&AurHistoryResponse {
        entries: filtered,
        total,
    })
}

pub fn get_aur_history_log(id: &str) -> Result<()> {
    if !id.starts_with("aur-")
        || !id
            .chars()
            .skip(4)
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(anyhow!("Invalid AUR history ID: {id}"));
    }

    let logs_dir = logs_dir_path();
    let log_file = logs_dir.join(format!("{id}.log"));

    let content = if log_file.exists() {
        fs::read_to_string(&log_file).unwrap_or_default()
    } else {
        // Fall back to current /tmp log if ID matches current operation
        if let Ok(op_str) = fs::read_to_string(OPERATION_FILE) {
            if let Ok(op) = serde_json::from_str::<super::runner::AurOperationStatus>(&op_str) {
                if format!("aur-{}", op.started_at) == id {
                    fs::read_to_string(LOG_FILE).unwrap_or_default()
                } else {
                    String::new()
                }
            } else {
                String::new()
            }
        } else {
            String::new()
        }
    };

    crate::util::emit_json(&AurHistoryLogResponse {
        id: id.to_string(),
        log: content,
    })
}
