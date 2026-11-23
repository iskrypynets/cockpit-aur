pub mod deps;
pub mod helper;
pub mod history;
pub mod models;
pub mod rpc;
pub mod runner;
pub mod updates;

pub use deps::{resolve_aur_build_order, AurDependencyGraphResponse};
pub use helper::detect_helper;
pub use history::{get_aur_history, get_aur_history_log, record_aur_operation};
pub use models::{AurHelperInfo, AurPackageDetails, AurPkgbuildResponse};
pub use rpc::{clear_aur_cache, fetch_pkgbuild, info_aur, search_aur};
pub use runner::{
    AurOperation, get_operation_log, get_operation_status, run_aur_operation,
};
pub use updates::find_aur_updates;

use crate::alpm::get_handle;
use crate::validation::validate_package_name;
use anyhow::{Result, bail};

/// Get full details of a single AUR package
pub fn get_aur_package_details(name: &str) -> Result<AurPackageDetails> {
    validate_package_name(name)?;
    let mut packages = info_aur(&[name])?;
    if packages.is_empty() {
        bail!("Package '{name}' not found on AUR");
    }
    let pkg = packages.remove(0);

    let handle = get_handle()?;
    let local_pkg = handle.localdb().pkg(name).ok();
    let installed = local_pkg.is_some();
    let installed_version = local_pkg.map(|p| p.version().to_string());

    Ok(AurPackageDetails {
        id: pkg.id,
        name: pkg.name,
        package_base: pkg.package_base,
        version: pkg.version,
        description: pkg.description,
        url: pkg.url,
        num_votes: pkg.num_votes,
        popularity: pkg.popularity,
        out_of_date: pkg.out_of_date,
        maintainer: pkg.maintainer,
        first_submitted: pkg.first_submitted,
        last_modified: pkg.last_modified,
        depends: pkg.depends,
        make_depends: pkg.make_depends,
        opt_depends: pkg.opt_depends,
        conflicts: pkg.conflicts,
        provides: pkg.provides,
        licenses: pkg.license,
        keywords: pkg.keywords,
        installed,
        installed_version,
    })
}
