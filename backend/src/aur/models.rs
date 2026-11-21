use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Internal raw package object from AUR RPC v5
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct AurRpcPackage {
    #[serde(rename = "ID")]
    pub id: u64,
    pub name: String,
    pub package_base: String,
    pub version: String,
    pub description: Option<String>,
    #[serde(rename = "URL")]
    pub url: Option<String>,
    pub num_votes: u32,
    pub popularity: f64,
    pub out_of_date: Option<i64>,
    pub maintainer: Option<String>,
    pub first_submitted: Option<i64>,
    pub last_modified: Option<i64>,
    #[serde(default)]
    pub depends: Vec<String>,
    #[serde(default)]
    pub make_depends: Vec<String>,
    #[serde(default)]
    pub opt_depends: Vec<String>,
    #[serde(default)]
    pub conflicts: Vec<String>,
    #[serde(default)]
    pub provides: Vec<String>,
    #[serde(default)]
    pub license: Vec<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
}

/// Raw envelope from AUR RPC v5
#[derive(Debug, Deserialize)]
pub struct AurRpcResponse {
    #[serde(default)]
    pub version: Option<u32>,
    #[serde(rename = "type", default)]
    pub response_type: Option<String>,
    #[serde(default)]
    pub resultcount: usize,
    #[serde(default)]
    pub results: Vec<AurRpcPackage>,
    #[serde(default)]
    pub error: Option<String>,
}

/// Detailed AUR package information exposed to Cockpit frontend
#[derive(Serialize, Deserialize, Clone, Debug, TS)]
#[ts(export, export_to = "../../src/bindings/index.ts")]
pub struct AurPackageDetails {
    #[ts(type = "number")]
    pub id: u64,
    pub name: String,
    pub package_base: String,
    pub version: String,
    pub description: Option<String>,
    pub url: Option<String>,
    pub num_votes: u32,
    pub popularity: f64,
    #[ts(type = "number | null")]
    pub out_of_date: Option<i64>,
    pub maintainer: Option<String>,
    #[ts(type = "number | null")]
    pub first_submitted: Option<i64>,
    #[ts(type = "number | null")]
    pub last_modified: Option<i64>,
    pub depends: Vec<String>,
    pub make_depends: Vec<String>,
    pub opt_depends: Vec<String>,
    pub conflicts: Vec<String>,
    pub provides: Vec<String>,
    pub licenses: Vec<String>,
    pub keywords: Vec<String>,
    pub installed: bool,
    pub installed_version: Option<String>,
}

/// Raw PKGBUILD script response for security review
#[derive(Serialize, Deserialize, Clone, Debug, TS)]
#[ts(export, export_to = "../../src/bindings/index.ts")]
pub struct AurPkgbuildResponse {
    pub name: String,
    pub pkgbuild: String,
}

/// Information about installed AUR helper on the host system
#[derive(Serialize, Deserialize, Clone, Debug, TS)]
#[ts(export, export_to = "../../src/bindings/index.ts")]
pub struct AurHelperInfo {
    pub helper: String,
    pub path: Option<String>,
    pub available: bool,
    pub version: Option<String>,
}
