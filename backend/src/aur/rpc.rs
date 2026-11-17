use anyhow::{Context, Result, bail};
use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use std::time::Duration;

use super::models::{AurRpcPackage, AurRpcResponse};

const AUR_BASE_URL: &str = "https://aur.archlinux.org";
const MAX_AUR_RPC_BYTES: usize = 4 * 1024 * 1024; // 4 MB max RPC response
const MAX_PKGBUILD_BYTES: usize = 1024 * 1024; // 1 MB max PKGBUILD script

fn aur_http_client() -> arch_http_client::Client {
    arch_http_client::Client::new(arch_http_client::Options {
        timeout: Duration::from_secs(20),
        connect_timeout: Duration::from_secs(10),
        max_body: MAX_AUR_RPC_BYTES,
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

/// Fetch package metadata for a batch of package names using AUR RPC v5
pub fn info_aur(names: &[&str]) -> Result<Vec<AurRpcPackage>> {
    if names.is_empty() {
        return Ok(Vec::new());
    }

    crate::network::require_network()?;
    for name in names {
        crate::validation::validate_package_name(name)?;
    }

    let client = aur_http_client();
    let mut all_results = Vec::new();

    // Batch in chunks of 100 packages to keep URL query strings safely under limits
    for chunk in names.chunks(100) {
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

        let rpc_res: AurRpcResponse = serde_json::from_slice(&response.body)
            .with_context(|| "Failed to parse AUR RPC info response")?;

        if let Some(err) = rpc_res.error {
            bail!("AUR RPC error: {err}");
        }

        all_results.extend(rpc_res.results);
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
