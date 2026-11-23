mod callbacks;
mod sysupgrade;
mod transaction;

pub use callbacks::{Verbosity, setup_dl_cb, setup_log_cb};
pub(crate) use sysupgrade::check_approved_removals;
pub use sysupgrade::{InterventionFlags, SysupgradeOutcome, run_sysupgrade};
pub use transaction::TransactionGuard;

use alpm::{Alpm, LogLevel, Package, Progress, Usage};
use alpm_utils::alpm_with_conf;
use anyhow::{Context, Result};
use pacman_key::KeyValidity;
use pacmanconf::Config;
use std::collections::{HashMap, HashSet};

use crate::models::UpdateInfo;

pub fn get_handle() -> Result<Alpm> {
    let conf = Config::new().context("Failed to parse pacman.conf")?;
    let mut handle = alpm_with_conf(&conf).context("Failed to initialize alpm handle")?;

    // Workaround: alpm_utils uses set_hookdirs() which replaces the system hookdir
    // (/usr/share/libalpm/hooks/) that alpm_initialize() sets by default. Pacman
    // avoids this by using add_hookdir() instead. Re-add the system hookdir so
    // post-transaction hooks (mkinitcpio, depmod, systemd, etc.) are found.
    // https://github.com/archlinux/alpm.rs/issues/65
    handle
        .add_hookdir("/usr/share/libalpm/hooks/")
        .context("Failed to add system hookdir")?;

    Ok(handle)
}

/// Returns an ALPM handle for checking available updates safely.
///
/// To safely query remote mirrors without altering the host's `/var/lib/pacman/sync/`
/// or risking partial upgrades (and allowing unprivileged users in Cockpit to check updates),
/// this initializes an isolated check database directory (matching the standard Arch `checkupdates`
/// convention: `${CHECKUPDATES_DB:-${TMPDIR:-/tmp}/checkup-db-${UID}/}`) with a symlink to the
/// system's local installed database (`local -> /var/lib/pacman/local`).
/// When online, it refreshes the mirror databases into this directory using conditional GET (`update(false)`).
pub fn get_check_handle() -> Result<Alpm> {
    let conf = Config::new().context("Failed to parse pacman.conf")?;
    let uid = unsafe { libc::getuid() };

    let check_db = std::env::var_os("CHECKUPDATES_DB")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join(format!("checkup-db-{}", uid)));

    let mut check_conf = conf.clone();
    let mut using_check_db = false;

    if std::fs::create_dir_all(&check_db).is_ok() {
        let local_symlink = check_db.join("local");
        let sys_local = std::path::Path::new(&conf.db_path).join("local");
        if !local_symlink.exists() && sys_local.exists() {
            let _ = std::os::unix::fs::symlink(&sys_local, &local_symlink);
        }
        if local_symlink.exists() {
            // Clean up any stale db.lck in our isolated check database directory
            // (e.g. if a previous check was aborted or killed by timeout).
            let _ = std::fs::remove_file(check_db.join("db.lck"));

            // Also clean up any lingering 0-byte or corrupted .part files in sync/
            let sync_dir = check_db.join("sync");
            if let Ok(entries) = std::fs::read_dir(&sync_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|e| e.to_str()) == Some("part") {
                        let _ = std::fs::remove_file(path);
                    }
                }
            }

            check_conf.db_path = check_db.display().to_string();
            using_check_db = true;
        }
    }

    let mut handle =
        alpm_with_conf(&check_conf).context("Failed to initialize check alpm handle")?;
    handle
        .add_hookdir("/usr/share/libalpm/hooks/")
        .context("Failed to add system hookdir")?;

    if using_check_db && crate::network::require_network().is_ok() {
        let _ = handle.syncdbs_mut().update(false);
    }

    // If the check databases have no packages (e.g. freshly created offline), fall back to system databases.
    if using_check_db && handle.syncdbs().iter().all(|db| db.pkgs().is_empty()) {
        if let Ok(sys_handle) = get_handle() {
            if !sys_handle.syncdbs().iter().all(|db| db.pkgs().is_empty()) {
                return Ok(sys_handle);
            }
        }
    }

    Ok(handle)
}

pub fn sync_databases(handle: &mut Alpm, force: bool) -> Result<()> {
    crate::network::require_network()?;
    let result = handle.syncdbs_mut().update(force);
    crate::handlers::log::log_sync_result(handle, &result);
    result?;
    Ok(())
}

pub fn resolve_file_owners(handle: &Alpm, wanted: &HashSet<String>) -> HashMap<String, String> {
    let mut owners = HashMap::new();
    if wanted.is_empty() {
        return owners;
    }

    let by_relative: HashMap<Vec<u8>, &str> = wanted
        .iter()
        .map(|path| {
            (
                path.strip_prefix('/').unwrap_or(path).as_bytes().to_vec(),
                path.as_str(),
            )
        })
        .collect();

    // Most file entries sit outside the wanted top-level directories; skip them before hashing.
    let mut prefixes: Vec<&[u8]> = by_relative.keys().map(|path| top_level(path)).collect();
    prefixes.sort_unstable();
    prefixes.dedup();

    for pkg in handle.localdb().pkgs() {
        for file in pkg.files().files() {
            if !prefixes
                .iter()
                .any(|prefix| file.name().starts_with(prefix))
            {
                continue;
            }
            if let Some(absolute) = by_relative.get(file.name())
                && !owners.contains_key(*absolute)
            {
                owners.insert((*absolute).to_string(), pkg.name().to_string());
            }
        }
        if owners.len() == wanted.len() {
            break;
        }
    }
    owners
}

fn top_level(path: &[u8]) -> &[u8] {
    path.iter()
        .position(|byte| *byte == b'/')
        .map_or(path, |end| &path[..=end])
}

pub fn find_upgrade_candidate<'a>(handle: &'a Alpm, name: &str) -> Option<&'a Package> {
    handle
        .syncdbs()
        .iter()
        .filter(|db| db.usage().is_ok_and(|usage| usage.contains(Usage::UPGRADE)))
        .find_map(|db| db.pkg(name).ok())
}

pub fn find_available_updates(handle: &Alpm, extra_ignored: &[String]) -> Vec<UpdateInfo> {
    let localdb = handle.localdb();
    let mut updates = Vec::new();

    for pkg in localdb.pkgs() {
        if let Some(syncpkg) = find_upgrade_candidate(handle, pkg.name())
            && syncpkg.version() > pkg.version()
            && let Some(syncdb) = syncpkg.db()
        {
            let ignored = handle.ignorepkgs().iter().any(|n| n == pkg.name())
                || handle.ignoregroups().iter().any(|g| {
                    handle.syncdbs().iter().any(|db| {
                        db.group(g)
                            .map(|grp| grp.packages().iter().any(|p| p.name() == pkg.name()))
                            .unwrap_or(false)
                    })
                })
                || extra_ignored.iter().any(|n| n == pkg.name());
            updates.push(UpdateInfo {
                name: pkg.name().to_string(),
                current_version: pkg.version().to_string(),
                new_version: syncpkg.version().to_string(),
                download_size: syncpkg.download_size(),
                current_size: pkg.isize(),
                new_size: syncpkg.isize(),
                repository: syncdb.name().to_string(),
                ignored,
            });
        }
    }

    updates
}

pub fn progress_to_string(progress: Progress) -> &'static str {
    match progress {
        Progress::AddStart => "add_start",
        Progress::UpgradeStart => "upgrade_start",
        Progress::DowngradeStart => "downgrade_start",
        Progress::ReinstallStart => "reinstall_start",
        Progress::RemoveStart => "remove_start",
        Progress::ConflictsStart => "conflicts_start",
        Progress::DiskspaceStart => "diskspace_start",
        Progress::IntegrityStart => "integrity_start",
        Progress::LoadStart => "load_start",
        Progress::KeyringStart => "keyring_start",
    }
}

pub fn reason_to_string(reason: alpm::PackageReason) -> &'static str {
    match reason {
        alpm::PackageReason::Explicit => "explicit",
        alpm::PackageReason::Depend => "dependency",
    }
}

pub fn validity_to_string(v: &KeyValidity) -> &'static str {
    match v {
        KeyValidity::Unknown => "unknown",
        KeyValidity::Undefined => "undefined",
        KeyValidity::Never => "never",
        KeyValidity::Marginal => "marginal",
        KeyValidity::Full => "full",
        KeyValidity::Ultimate => "ultimate",
        KeyValidity::Expired => "expired",
        KeyValidity::Revoked => "revoked",
        _ => "unknown",
    }
}

pub fn log_level_to_string(level: LogLevel) -> &'static str {
    match level {
        LogLevel::ERROR => "error",
        LogLevel::WARNING => "warning",
        LogLevel::DEBUG => "debug",
        LogLevel::FUNCTION => "function",
        _ => "info",
    }
}

#[cfg(test)]
mod candidate_tests;
