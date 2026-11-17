use alpm::Alpm;
use anyhow::Result;
use std::collections::HashMap;

use super::rpc::info_aur;
use crate::models::UpdateInfo;

/// Detect available updates for foreign (AUR) installed packages
pub fn find_aur_updates(handle: &Alpm, extra_ignored: &[String]) -> Result<Vec<UpdateInfo>> {
    let localdb = handle.localdb();
    let syncdbs = handle.syncdbs();

    // 1. Identify foreign packages (installed packages not in any sync database)
    let mut foreign_pkgs = HashMap::new();
    for pkg in localdb.pkgs() {
        let is_in_syncdb = syncdbs.iter().any(|db| db.pkg(pkg.name()).is_ok());
        if !is_in_syncdb {
            foreign_pkgs.insert(pkg.name().to_string(), (pkg.version().to_string(), pkg.isize()));
        }
    }

    if foreign_pkgs.is_empty() {
        return Ok(Vec::new());
    }

    // 2. Query AUR RPC for metadata of all foreign packages
    let names: Vec<&str> = foreign_pkgs.keys().map(String::as_str).collect();
    let aur_packages = info_aur(&names)?;

    // 3. Compare versions using alpm::vercmp
    let mut updates = Vec::new();
    for aur_pkg in aur_packages {
        if let Some((local_ver, local_size)) = foreign_pkgs.get(&aur_pkg.name) {
            let ordering = alpm::vercmp(aur_pkg.version.as_str(), local_ver.as_str());
            if ordering == std::cmp::Ordering::Greater {
                let ignored = handle.ignorepkgs().iter().any(|n| n == &aur_pkg.name)
                    || extra_ignored.iter().any(|n| n == &aur_pkg.name);

                updates.push(UpdateInfo {
                    name: aur_pkg.name,
                    current_version: local_ver.clone(),
                    new_version: aur_pkg.version,
                    download_size: 0,
                    current_size: *local_size,
                    new_size: *local_size,
                    repository: "aur".to_string(),
                    ignored,
                });
            }
        }
    }

    Ok(updates)
}
