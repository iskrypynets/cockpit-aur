use alpm::Alpm;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use ts_rs::TS;

use super::rpc::info_aur;
use crate::validation::validate_package_name;

/// Resolved AUR dependency build graph
#[derive(Serialize, Deserialize, Clone, Debug, TS)]
#[ts(export, export_to = "../../src/bindings/index.ts")]
pub struct AurDependencyGraphResponse {
    pub packages: Vec<String>,
    pub total: usize,
}

/// Extract base package name from a dependency spec (e.g. "lib32-libarchive>=3.8.0" -> "lib32-libarchive")
pub fn extract_pkg_name(dep_str: &str) -> &str {
    dep_str
        .split(|c| c == '>' || c == '<' || c == '=' || c == ':')
        .next()
        .unwrap_or(dep_str)
        .trim()
}

/// Resolve the complete topological build graph of AUR packages and their AUR dependencies.
/// Uses ALPM to filter out already-installed packages and repository packages,
/// and AUR RPC to resolve foreign dependencies recursively.
pub fn resolve_aur_build_order(handle: &Alpm, target_pkgs: &[String]) -> Result<Vec<String>> {
    if target_pkgs.is_empty() {
        return Ok(Vec::new());
    }

    let mut aur_packages_map = HashMap::new();
    let mut to_fetch: HashSet<String> = HashSet::new();
    let mut visited_dep_names: HashSet<String> = HashSet::new();

    for target in target_pkgs {
        let name = extract_pkg_name(target);
        if validate_package_name(name).is_ok() {
            to_fetch.insert(name.to_string());
            visited_dep_names.insert(name.to_string());
        }
    }

    // Recursively resolve AUR dependencies
    while !to_fetch.is_empty() {
        let fetch_list: Vec<String> = to_fetch.drain().collect();
        let fetch_refs: Vec<&str> = fetch_list.iter().map(String::as_str).collect();

        let rpc_results = match info_aur(&fetch_refs) {
            Ok(results) => results,
            Err(_) => break, // Network unavailable or RPC error; continue with what we have
        };

        for pkg in rpc_results {
            let mut deps_to_check = Vec::new();
            deps_to_check.extend(pkg.depends.iter().cloned());
            deps_to_check.extend(pkg.make_depends.iter().cloned());

            for dep_spec in deps_to_check {
                let dep_name = extract_pkg_name(&dep_spec);
                if dep_name.is_empty() || visited_dep_names.contains(dep_name) {
                    continue;
                }
                visited_dep_names.insert(dep_name.to_string());

                // Check if satisfied by installed packages or official repositories
                let is_installed = handle.localdb().pkgs().find_satisfier(&*dep_spec).is_some();
                let is_in_repo = handle.syncdbs().find_satisfier(&*dep_spec).is_some();

                if !is_installed && !is_in_repo && validate_package_name(dep_name).is_ok() {
                    // It is a missing AUR dependency!
                    to_fetch.insert(dep_name.to_string());
                }
            }

            aur_packages_map.insert(pkg.name.clone(), pkg);
        }
    }

    // Ensure all target packages are included in the graph even if RPC had partial results
    for target in target_pkgs {
        let name = extract_pkg_name(target);
        if !aur_packages_map.contains_key(name) && validate_package_name(name).is_ok() {
            // Create dummy package entry with no dependencies
            aur_packages_map.insert(
                name.to_string(),
                super::models::AurRpcPackage {
                    id: 0,
                    name: name.to_string(),
                    package_base: name.to_string(),
                    version: String::new(),
                    description: None,
                    url: None,
                    num_votes: 0,
                    popularity: 0.0,
                    out_of_date: None,
                    maintainer: None,
                    first_submitted: None,
                    last_modified: None,
                    depends: Vec::new(),
                    make_depends: Vec::new(),
                    opt_depends: Vec::new(),
                    conflicts: Vec::new(),
                    provides: Vec::new(),
                    license: Vec::new(),
                    keywords: Vec::new(),
                },
            );
        }
    }

    // Build directed acyclic graph (DAG):
    // If package A depends on package B (where B is in aur_packages_map),
    // then B must be built before A (Edge: B -> A).
    let mut in_degree: HashMap<String, usize> = HashMap::new();
    let mut adj: HashMap<String, Vec<String>> = HashMap::new();

    for name in aur_packages_map.keys() {
        in_degree.insert(name.clone(), 0);
        adj.insert(name.clone(), Vec::new());
    }

    for (pkg_name, pkg) in &aur_packages_map {
        let mut all_deps = Vec::new();
        all_deps.extend(pkg.depends.iter().map(|s| extract_pkg_name(s)));
        all_deps.extend(pkg.make_depends.iter().map(|s| extract_pkg_name(s)));

        for dep_name in all_deps {
            if dep_name != pkg_name && aur_packages_map.contains_key(dep_name) {
                // pkg_name depends on dep_name; dep_name unlocks pkg_name
                adj.entry(dep_name.to_string())
                    .or_default()
                    .push(pkg_name.clone());
                *in_degree.entry(pkg_name.clone()).or_insert(0) += 1;
            }
        }
    }

    // Kahn's algorithm for topological sorting
    let mut queue = VecDeque::new();
    for (name, deg) in &in_degree {
        if *deg == 0 {
            queue.push_back(name.clone());
        }
    }

    let mut build_order = Vec::new();
    while let Some(curr) = queue.pop_front() {
        build_order.push(curr.clone());

        if let Some(neighbors) = adj.get(&curr) {
            for neighbor in neighbors {
                if let Some(deg) = in_degree.get_mut(neighbor) {
                    *deg = deg.saturating_sub(1);
                    if *deg == 0 {
                        queue.push_back(neighbor.clone());
                    }
                }
            }
        }
    }

    // If cycle detected, append any remaining nodes to avoid omitting targets
    for name in aur_packages_map.keys() {
        if !build_order.contains(name) {
            build_order.push(name.clone());
        }
    }

    Ok(build_order)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_pkg_name() {
        assert_eq!(
            extract_pkg_name("lib32-libarchive>=3.8.0"),
            "lib32-libarchive"
        );
        assert_eq!(extract_pkg_name("gcc-libs<15"), "gcc-libs");
        assert_eq!(extract_pkg_name("python=3.12"), "python");
        assert_eq!(extract_pkg_name("sh: /bin/sh"), "sh");
        assert_eq!(extract_pkg_name("antigravity"), "antigravity");
    }
}
