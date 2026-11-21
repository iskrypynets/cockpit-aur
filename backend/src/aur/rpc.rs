use anyhow::{Context, Result, bail};
use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::models::{AurRpcPackage, AurRpcResponse};

const AUR_BASE_URL: &str = "https://aur.archlinux.org";
const MAX_AUR_RPC_BYTES: usize = 4 * 1024 * 1024; // 4 MB max RPC response
const MAX_PKGBUILD_BYTES: usize = 1024 * 1024; // 1 MB max PKGBUILD script

#[derive(Serialize, Deserialize, Clone)]
pub struct CachedPackage {
    pub package: AurRpcPackage,
    pub fetched_at: u64,
}

#[derive(Serialize, Deserialize, Default)]
pub struct AurRpcCache {
    pub packages: HashMap<String, CachedPackage>,
}

fn cache_path() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        let dir = PathBuf::from(home).join(".cache/cockpit-aur");
        let _ = fs::create_dir_all(&dir);
        dir.join("rpc-cache.json")
    } else {
        PathBuf::from("/tmp/cockpit-aur-rpc-cache.json")
    }
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn load_cache() -> AurRpcCache {
    let path = cache_path();
    if let Ok(data) = fs::read_to_string(&path) {
        if let Ok(cache) = serde_json::from_str::<AurRpcCache>(&data) {
            return cache;
        }
    }
    AurRpcCache::default()
}

fn save_cache(cache: &AurRpcCache) {
    let path = cache_path();
    let _ = crate::util::write_json_atomic(&path, cache);
}

pub fn clear_aur_cache() -> Result<()> {
    let path = cache_path();
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

fn aur_http_client() -> arch_http_client::Client {
    let config = crate::config::AppConfig::load().unwrap_or_default();
    let rpc_timeout = Duration::from_secs(config.aur_rpc_timeout_secs.max(5));
    let connect_timeout = Duration::from_secs(10.min(config.aur_rpc_timeout_secs));
    arch_http_client::Client::new(arch_http_client::Options {
        timeout: rpc_timeout,
        connect_timeout,
        max_body: MAX_AUR_RPC_BYTES,
        user_agent: Some("pacman/7.0.0 (x86_64) cockpit-aur/0.5.3".to_string()),
        ..arch_http_client::Options::default()
    })
}

/// Search packages in the AUR by query string using AUR RPC v5
pub fn search_aur(query: &str) -> Result<Vec<AurRpcPackage>> {
    crate::network::require_network()?;
    crate::validation::validate_search_query(query)?;

    let encoded_query = utf8_percent_encode(query, NON_ALPHANUMERIC).to_string();
    let url = format!("{AUR_BASE_URL}/rpc/v5/search/{encoded_query}");

    let client = aur_http_client();
    let response = client
        .get(&url)
        .with_context(|| format!("Failed to query AUR RPC search for '{query}'"))?;

    let rpc_res: AurRpcResponse = serde_json::from_slice(&response.body)
        .with_context(|| "Failed to parse AUR RPC search response")?;

    if let Some(err) = rpc_res.error {
        bail!("AUR RPC error: {err}");
    }

    Ok(rpc_res.results)
}

/// Fetch package metadata for a batch of package names using AUR RPC v5 with on-disk caching
pub fn info_aur(names: &[&str]) -> Result<Vec<AurRpcPackage>> {
    if names.is_empty() {
        return Ok(Vec::new());
    }

    crate::network::require_network()?;
    let valid_names: Vec<&str> = names
        .iter()
        .copied()
        .filter(|name| crate::validation::validate_package_name(name).is_ok())
        .collect();

    if valid_names.is_empty() {
        return Ok(Vec::new());
    }

    let config = crate::config::AppConfig::load().unwrap_or_default();
    let ttl = config.aur_cache_ttl_secs;
    let now = current_timestamp();

    let mut cache = load_cache();
    let mut all_results = Vec::new();
    let mut missing_names = Vec::new();

    for name in valid_names {
        if let Some(entry) = cache.packages.get(name) {
            if now.saturating_sub(entry.fetched_at) < ttl {
                all_results.push(entry.package.clone());
                continue;
            }
        }
        missing_names.push(name);
    }

    if missing_names.is_empty() {
        return Ok(all_results);
    }

    let client = aur_http_client();
    let mut newly_fetched = false;

    // Batch in chunks of 50 packages to keep URL query strings safely under limits
    for chunk in missing_names.chunks(50) {
        let mut query_params = Vec::new();
        for name in chunk {
            let encoded = utf8_percent_encode(name, NON_ALPHANUMERIC).to_string();
            query_params.push(format!("arg[]={encoded}"));
        }
        let query_string = query_params.join("&");
        let url = format!("{AUR_BASE_URL}/rpc/v5/info?{query_string}");

        let response = client
            .get(&url)
            .with_context(|| "Failed to query AUR RPC info")?;

        let rpc_res: AurRpcResponse = match serde_json::from_slice(&response.body) {
            Ok(res) => res,
            Err(e) => {
                let body_str = String::from_utf8_lossy(&response.body);
                bail!("Failed to parse AUR RPC info response: {e}; body preview: {}", &body_str[..body_str.len().min(300)]);
            }
        };

        if let Some(err) = rpc_res.error {
            bail!("AUR RPC error: {err}");
        }

        for pkg in rpc_res.results {
            cache.packages.insert(
                pkg.name.clone(),
                CachedPackage {
                    package: pkg.clone(),
                    fetched_at: now,
                },
            );
            all_results.push(pkg);
            newly_fetched = true;
        }
    }

    if newly_fetched {
        save_cache(&cache);
    }

    Ok(all_results)
}

/// Fetch raw PKGBUILD script from AUR cgit for security inspection
pub fn fetch_pkgbuild(package_name: &str) -> Result<String> {
    crate::network::require_network()?;
    crate::validation::validate_package_name(package_name)?;

    let encoded_name = utf8_percent_encode(package_name, NON_ALPHANUMERIC).to_string();
    let url = format!("{AUR_BASE_URL}/cgit/aur.git/plain/PKGBUILD?h={encoded_name}");

    let client = arch_http_client::Client::new(arch_http_client::Options {
        timeout: Duration::from_secs(15),
        connect_timeout: Duration::from_secs(10),
        max_body: MAX_PKGBUILD_BYTES,
        ..arch_http_client::Options::default()
    });

    let response = match client.get(&url) {
        Ok(res) => res,
        Err(arch_http_client::Error::Status(404)) => {
            bail!("PKGBUILD for '{package_name}' not found on AUR");
        }
        Err(err) => return Err(err.into()),
    };

    let text = response.text().context("PKGBUILD contains invalid UTF-8")?;
    Ok(text)
}
