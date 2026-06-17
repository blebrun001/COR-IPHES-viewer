//! Native backend for COR-IPHES Esqueletos Off-linea.
//!
//! The backend owns every operation that must remain outside the browser layer:
//! Dataverse synchronization, SQLite catalog persistence, resumable downloads,
//! checksum validation, and conversion of downloaded files into Tauri asset
//! paths. The frontend should treat the commands exposed here as the source of
//! truth for catalog and storage state.

use chrono::Utc;
use futures_util::StreamExt;
use reqwest::header::{ACCEPT, ACCEPT_ENCODING, CONTENT_LENGTH, RANGE, USER_AGENT};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::{Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

const API_ROOT: &str = "https://dataverse.csuc.cat/api";
const DATAVERSE_ID: &str = "cor-iphes";
const HTTP_USER_AGENT: &str = "COR-IPHES-Esqueletos-Off-linea/0.1.0";
const CATALOG_SEED_JSON: &str = include_str!("../resources/catalog_seed.json");

type CommandResult<T> = Result<T, String>;

#[derive(Clone)]
struct AppState {
    data_dir: PathBuf,
    db_path: PathBuf,
    client: reqwest::Client,
    worker_active: Arc<Mutex<bool>>,
}

impl AppState {
    /// Creates the app-local storage layout, initializes SQLite, imports the
    /// bundled seed catalog on first launch, and makes interrupted downloads
    /// visible as resumable work.
    fn new(data_dir: PathBuf) -> CommandResult<Self> {
        fs::create_dir_all(data_dir.join("assets")).map_err(to_string)?;
        fs::create_dir_all(data_dir.join("tmp")).map_err(to_string)?;
        let db_path = data_dir.join("catalog.sqlite3");
        let state = Self {
            data_dir,
            db_path,
            client: build_http_client()?,
            worker_active: Arc::new(Mutex::new(false)),
        };
        state.init_db()?;
        #[cfg(not(test))]
        state.import_seed_catalog_if_empty()?;
        state.recover_interrupted_downloads()?;
        Ok(state)
    }

    fn connect(&self) -> CommandResult<Connection> {
        let conn = Connection::open(&self.db_path).map_err(to_string)?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(to_string)?;
        Ok(conn)
    }

    fn init_db(&self) -> CommandResult<()> {
        let conn = self.connect()?;
        // The schema keeps remote catalog metadata, model/file relationships,
        // and download queue state in one SQLite database so the UI can recover
        // cleanly after the app restarts offline.
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS catalog_datasets (
              persistent_id TEXT PRIMARY KEY,
              identifier TEXT NOT NULL,
              title TEXT NOT NULL,
              detail_json TEXT NOT NULL,
              specimen_summary_json TEXT,
              taxonomy_path_json TEXT,
              remote_hash TEXT NOT NULL,
              last_seen_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS catalog_files (
              file_id INTEGER PRIMARY KEY,
              dataset_id TEXT NOT NULL,
              label TEXT NOT NULL,
              directory_label TEXT NOT NULL,
              path TEXT NOT NULL,
              content_type TEXT,
              filesize INTEGER,
              checksum_type TEXT,
              checksum_value TEXT,
              download_url TEXT NOT NULL,
              download_state TEXT NOT NULL DEFAULT 'missing',
              storage_hash TEXT,
              storage_path TEXT,
              bytes_downloaded INTEGER NOT NULL DEFAULT 0,
              error TEXT,
              remote_hash TEXT NOT NULL,
              updated_at INTEGER NOT NULL,
              FOREIGN KEY(dataset_id) REFERENCES catalog_datasets(persistent_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS catalog_models (
              id TEXT PRIMARY KEY,
              dataset_id TEXT NOT NULL,
              model_key TEXT NOT NULL,
              display_name TEXT NOT NULL,
              directory TEXT NOT NULL,
              obj_file_id INTEGER NOT NULL,
              mtl_file_id INTEGER,
              download_state TEXT NOT NULL DEFAULT 'missing',
              remote_hash TEXT NOT NULL,
              updated_at INTEGER NOT NULL,
              UNIQUE(dataset_id, model_key),
              FOREIGN KEY(dataset_id) REFERENCES catalog_datasets(persistent_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS catalog_model_files (
              dataset_id TEXT NOT NULL,
              model_key TEXT NOT NULL,
              file_id INTEGER NOT NULL,
              role TEXT NOT NULL,
              discovered_at INTEGER NOT NULL,
              PRIMARY KEY(dataset_id, model_key, file_id),
              FOREIGN KEY(dataset_id, model_key) REFERENCES catalog_models(dataset_id, model_key) ON DELETE CASCADE,
              FOREIGN KEY(file_id) REFERENCES catalog_files(file_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS download_jobs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              file_id INTEGER NOT NULL UNIQUE,
              dataset_id TEXT NOT NULL,
              priority INTEGER NOT NULL DEFAULT 0,
              status TEXT NOT NULL DEFAULT 'queued',
              bytes_downloaded INTEGER NOT NULL DEFAULT 0,
              total_bytes INTEGER,
              error TEXT,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              FOREIGN KEY(file_id) REFERENCES catalog_files(file_id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_catalog_files_dataset ON catalog_files(dataset_id);
            CREATE INDEX IF NOT EXISTS idx_catalog_files_path ON catalog_files(dataset_id, path);
            CREATE INDEX IF NOT EXISTS idx_catalog_models_dataset ON catalog_models(dataset_id);
            CREATE INDEX IF NOT EXISTS idx_catalog_model_files_dataset ON catalog_model_files(dataset_id);
            CREATE INDEX IF NOT EXISTS idx_catalog_model_files_file ON catalog_model_files(file_id);
            CREATE INDEX IF NOT EXISTS idx_download_jobs_status ON download_jobs(status, priority, id);
            "#,
        )
        .map_err(to_string)?;
        conn.execute(
            r#"
            INSERT OR IGNORE INTO catalog_model_files(dataset_id, model_key, file_id, role, discovered_at)
            SELECT dataset_id, model_key, obj_file_id, 'obj', updated_at FROM catalog_models
            "#,
            [],
        )
        .map_err(to_string)?;
        conn.execute(
            r#"
            INSERT OR IGNORE INTO catalog_model_files(dataset_id, model_key, file_id, role, discovered_at)
            SELECT dataset_id, model_key, mtl_file_id, 'mtl', updated_at
            FROM catalog_models
            WHERE mtl_file_id IS NOT NULL
            "#,
            [],
        )
        .map_err(to_string)?;
        conn.execute(
            "INSERT OR REPLACE INTO meta(key, value) VALUES('schema_version', '1')",
            [],
        )
        .map_err(to_string)?;
        Ok(())
    }

    fn import_seed_catalog_if_empty(&self) -> CommandResult<()> {
        let conn = self.connect()?;
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM catalog_datasets", [], |row| {
                row.get(0)
            })
            .map_err(to_string)?;
        if count > 0 {
            return Ok(());
        }
        let seed = CATALOG_SEED_JSON.trim();
        if seed.is_empty() {
            return Ok(());
        }
        let datasets: Vec<RemoteDataset> = serde_json::from_str(seed).map_err(to_string)?;
        for dataset in &datasets {
            upsert_dataset(&conn, dataset, false)?;
        }
        Ok(())
    }

    fn recover_interrupted_downloads(&self) -> CommandResult<()> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE download_jobs SET status = 'paused', updated_at = ?1 WHERE status = 'downloading'",
            [now_ts()],
        )
        .map_err(to_string)?;
        conn.execute(
            "UPDATE catalog_files SET download_state = 'partial' WHERE download_state = 'downloading'",
            [],
        )
        .map_err(to_string)?;
        refresh_model_states(&conn)?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RemoteFile {
    file_id: i64,
    label: String,
    directory_label: String,
    path: String,
    content_type: Option<String>,
    filesize: Option<i64>,
    checksum_type: Option<String>,
    checksum_value: Option<String>,
    download_url: String,
    remote_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RemoteModel {
    model_key: String,
    display_name: String,
    directory: String,
    obj_file_id: i64,
    mtl_file_id: Option<i64>,
    remote_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RemoteDataset {
    persistent_id: String,
    identifier: String,
    title: String,
    detail: Value,
    specimen_summary: Option<Value>,
    taxonomy_path: Option<Value>,
    files: Vec<RemoteFile>,
    models: Vec<RemoteModel>,
    remote_hash: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DatasetInfo {
    label: String,
    value: String,
    identifier: String,
    specimen_summary: Option<Value>,
    taxonomy_path: Option<Value>,
    download_state: String,
    download_stats: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogEntry {
    persistent_id: String,
    title: String,
    detail: Value,
    files: Vec<Value>,
    models: Vec<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncPreview {
    datasets_scanned: usize,
    models_scanned: usize,
    changes: Vec<SyncChange>,
    datasets: Vec<SyncPreviewDataset>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncPreviewDataset {
    persistent_id: String,
    identifier: String,
    title: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SyncChange {
    change_type: String,
    dataset_id: String,
    label: String,
    requires_confirmation: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncDecision {
    dataset_id: String,
    action: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncApplyResult {
    applied: usize,
    skipped: usize,
    changes: Vec<SyncChange>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadEnqueueRequest {
    all: Option<bool>,
    dataset_ids: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadStatus {
    global: Value,
    queued: i64,
    downloading: i64,
    paused: i64,
    downloaded: i64,
    error: i64,
    specimens: Vec<Value>,
    files: Vec<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageUsage {
    bytes: u64,
    files: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetResolution {
    file_id: i64,
    path: String,
}

enum DownloadOutcome {
    Complete,
    Paused,
    Cancelled,
}

fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn error_chain(error: &dyn std::error::Error) -> String {
    let mut messages = vec![error.to_string()];
    let mut source = error.source();
    while let Some(error) = source {
        messages.push(error.to_string());
        source = error.source();
    }
    messages.join(": ")
}

fn now_ts() -> i64 {
    Utc::now().timestamp()
}

fn build_http_client() -> CommandResult<reqwest::Client> {
    reqwest::Client::builder()
        .http1_only()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(120))
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .user_agent(HTTP_USER_AGENT)
        .build()
        .map_err(to_string)
}

fn dataverse_get(client: &reqwest::Client, url: &str) -> reqwest::RequestBuilder {
    client
        .get(url)
        .header(ACCEPT_ENCODING, "identity")
        .header(USER_AGENT, HTTP_USER_AGENT)
}

fn json_hash(value: &Value) -> String {
    let bytes = serde_json::to_vec(value).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn string_hash(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hex::encode(hasher.finalize())
}

fn normalize_slashes(value: &str) -> String {
    value.replace('\\', "/")
}

fn normalize_dataset_path(directory: &str, label: &str) -> String {
    let dir = normalize_slashes(directory)
        .trim()
        .trim_matches('/')
        .to_string();
    let name = normalize_slashes(label)
        .trim()
        .trim_matches('/')
        .to_string();
    if dir.is_empty() {
        name
    } else {
        format!("{dir}/{name}")
    }
}

fn extension(value: &str) -> String {
    Path::new(value)
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn basename_without_ext(value: &str) -> String {
    let file_name = Path::new(value)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| value.to_string());
    match file_name.rfind('.') {
        Some(index) => file_name[..index].to_string(),
        None => file_name,
    }
}

fn directory_parts(value: &str) -> Vec<String> {
    normalize_slashes(value)
        .split('/')
        .map(|part| part.trim().to_string())
        .filter(|part| !part.is_empty())
        .collect()
}

fn display_from_file(directory: &str, label: &str) -> String {
    let parts = directory_parts(directory);
    if let Some(first) = parts.first() {
        return first.clone();
    }
    basename_without_ext(label)
}

fn extract_title(detail: &Value, fallback: &str) -> String {
    let fields = detail
        .pointer("/data/latestVersion/metadataBlocks/citation/fields")
        .and_then(Value::as_array);
    let Some(fields) = fields else {
        return fallback.to_string();
    };
    for field in fields {
        if field.get("typeName").and_then(Value::as_str) != Some("title") {
            continue;
        }
        let Some(value) = field.get("value") else {
            continue;
        };
        if let Some(text) = value.as_str() {
            return text.to_string();
        }
        if let Some(items) = value.as_array() {
            if let Some(text) = items.iter().find_map(Value::as_str) {
                return text.to_string();
            }
            if let Some(text) = items
                .iter()
                .find_map(|item| item.get("value").and_then(Value::as_str))
            {
                return text.to_string();
            }
        }
    }
    fallback.to_string()
}

fn normalize_field_token(value: &str) -> String {
    value
        .chars()
        .filter(|char| char.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn flatten_field_values(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Null => {}
        Value::Array(items) => items
            .iter()
            .for_each(|item| flatten_field_values(item, out)),
        Value::Object(map) => {
            if let Some(inner) = map.get("value") {
                flatten_field_values(inner, out);
            } else {
                map.values()
                    .for_each(|item| flatten_field_values(item, out));
            }
        }
        Value::String(text) => {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                out.push(trimmed.to_string());
            }
        }
        other => {
            let text = other.to_string();
            if !text.is_empty() {
                out.push(text);
            }
        }
    }
}

fn collect_field_values(fields: &[Value], candidates: &[&str], split: bool) -> Vec<String> {
    let targets: Vec<String> = candidates
        .iter()
        .map(|value| normalize_field_token(value))
        .collect();
    let Some(field) = fields.iter().find(|field| {
        let type_token = field
            .get("typeName")
            .and_then(Value::as_str)
            .map(normalize_field_token)
            .unwrap_or_default();
        let display_token = field
            .get("displayName")
            .and_then(Value::as_str)
            .map(normalize_field_token)
            .unwrap_or_default();
        targets.contains(&type_token) || targets.contains(&display_token)
    }) else {
        return vec![];
    };

    let mut values = vec![];
    if let Some(value) = field.get("value") {
        flatten_field_values(value, &mut values);
    }

    let mut final_values = vec![];
    for value in values {
        if split {
            for segment in value.split(|char| matches!(char, ';' | ',' | '|' | '\r' | '\n')) {
                let trimmed = segment.trim();
                if !trimmed.is_empty() {
                    final_values.push(trimmed.to_string());
                }
            }
        } else {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                final_values.push(trimmed.to_string());
            }
        }
    }
    final_values
}

fn humanize_metadata_value(value: &str) -> Option<String> {
    let normalized = value
        .replace('_', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    if normalized.is_empty() {
        None
    } else {
        let mut chars = normalized.chars();
        let first = chars.next()?.to_uppercase().collect::<String>();
        Some(format!("{first}{}", chars.collect::<String>()))
    }
}

fn extract_specimen_summary(detail: &Value) -> Option<Value> {
    let fields = detail
        .pointer("/data/latestVersion/metadataBlocks/darwincore/fields")
        .and_then(Value::as_array)?;

    let sex = collect_field_values(fields, &["dwcSex", "dwc:sex", "sex"], false)
        .iter()
        .find_map(|value| humanize_metadata_value(value));
    let life_stage = collect_field_values(
        fields,
        &["dwcLifeStage", "dwc:lifeStage", "lifeStage"],
        false,
    )
    .iter()
    .find_map(|value| humanize_metadata_value(value));
    let age_class =
        collect_field_values(fields, &["dwcAgeClass", "dwc:ageClass", "ageClass"], false)
            .iter()
            .find_map(|value| humanize_metadata_value(value));
    let catalog_number = collect_field_values(
        fields,
        &["dwcCatalogNumber", "dwc:catalogNumber", "catalogNumber"],
        false,
    )
    .into_iter()
    .find(|value| !value.is_empty());
    let other_catalog_numbers = collect_field_values(
        fields,
        &[
            "dwcOtherCatalogNumbers",
            "dwc:otherCatalogNumbers",
            "otherCatalogNumbers",
        ],
        true,
    );
    let individual_id = collect_field_values(
        fields,
        &["dwcIndividualID", "dwc:individualID", "individualID"],
        false,
    )
    .into_iter()
    .find(|value| !value.is_empty());

    let mut summary = serde_json::Map::new();
    if let Some(value) = sex {
        summary.insert("sex".to_string(), json!(value));
    }
    if let Some(value) = life_stage {
        summary.insert("lifeStage".to_string(), json!(value));
    }
    if let Some(value) = age_class {
        summary.insert("ageClass".to_string(), json!(value));
    }
    if let Some(value) = catalog_number.clone() {
        summary.insert("catalogNumber".to_string(), json!(value));
    }
    if !other_catalog_numbers.is_empty() {
        let mut seen = HashSet::new();
        let values: Vec<String> = other_catalog_numbers
            .into_iter()
            .filter(|value| seen.insert(value.to_lowercase()))
            .collect();
        summary.insert("otherCatalogNumbers".to_string(), json!(values));
    }
    if let Some(value) = individual_id.clone() {
        summary.insert("individualId".to_string(), json!(value));
    }

    let primary_id = catalog_number.or(individual_id);
    if let Some(value) = primary_id {
        summary.insert("primaryId".to_string(), json!(value));
    }

    if summary.is_empty() {
        None
    } else {
        Some(Value::Object(summary))
    }
}

fn extract_taxonomy_path(detail: &Value) -> Option<Value> {
    let fields = detail
        .pointer("/data/latestVersion/metadataBlocks/darwincore/fields")
        .and_then(Value::as_array)?;

    let value_for = |names: &[&str]| -> Option<String> {
        collect_field_values(fields, names, false)
            .iter()
            .find_map(|value| humanize_metadata_value(value))
    };

    let taxonomy = json!({
        "kingdom": value_for(&["dwcKingdom", "dwc:kingdom", "kingdom"]),
        "phylum": value_for(&["dwcPhylum", "dwc:phylum", "phylum"]),
        "class": value_for(&["dwcClass", "dwc:class", "class"]),
        "order": value_for(&["dwcOrder", "dwc:order", "order"]),
        "family": value_for(&["dwcFamily", "dwc:family", "family"]),
        "subfamily": value_for(&["dwcSubfamily", "dwc:subfamily", "subfamily"]),
        "genus": value_for(&["dwcGenus", "dwc:genus", "genus"]),
        "species": value_for(&[
            "dwcScientificName",
            "dwc:scientificName",
            "dwcSpecies",
            "dwc:species",
            "dwcSpecificEpithet",
            "dwc:specificEpithet",
            "scientificName",
            "species"
        ])
    });

    if taxonomy
        .as_object()
        .map(|map| map.values().any(|value| !value.is_null()))
        .unwrap_or(false)
    {
        Some(taxonomy)
    } else {
        None
    }
}

fn remote_file_from_value(value: &Value) -> Option<RemoteFile> {
    let data_file = value.get("dataFile")?;
    let file_id = data_file.get("id")?.as_i64()?;
    let label = value
        .get("label")
        .and_then(Value::as_str)
        .or_else(|| data_file.get("filename").and_then(Value::as_str))
        .unwrap_or("")
        .trim()
        .to_string();
    if label.is_empty() {
        return None;
    }
    let directory_label = value
        .get("directoryLabel")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    let path = normalize_dataset_path(&directory_label, &label);
    let checksum = data_file.get("checksum");
    let checksum_type = checksum
        .and_then(|checksum| checksum.get("type"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let checksum_value = checksum
        .and_then(|checksum| checksum.get("value"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let content_type = data_file
        .get("contentType")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let filesize = data_file
        .get("filesize")
        .and_then(Value::as_i64)
        .or_else(|| {
            data_file
                .get("filesize")
                .and_then(Value::as_u64)
                .map(|value| value as i64)
        });
    let download_url = format!("{API_ROOT}/access/datafile/{file_id}?format=original");
    let remote_hash = string_hash(&format!(
        "{file_id}|{label}|{directory_label}|{}|{}|{}",
        filesize.unwrap_or_default(),
        checksum_type.clone().unwrap_or_default(),
        checksum_value.clone().unwrap_or_default()
    ));

    Some(RemoteFile {
        file_id,
        label,
        directory_label,
        path,
        content_type,
        filesize,
        checksum_type,
        checksum_value,
        download_url,
        remote_hash,
    })
}

fn build_model_index(files: &[RemoteFile]) -> Vec<RemoteModel> {
    let mut mtl_by_expected_path: HashMap<String, i64> = HashMap::new();
    let mut mtl_by_dir_base: HashMap<String, i64> = HashMap::new();
    let mut mtl_by_base: HashMap<String, Vec<(String, i64)>> = HashMap::new();
    for file in files {
        if extension(&file.label) != "mtl" {
            continue;
        }
        let base = basename_without_ext(&file.label).to_lowercase();
        let directory = normalize_slashes(&file.directory_label).to_lowercase();
        mtl_by_expected_path.insert(file.path.to_lowercase(), file.file_id);
        mtl_by_dir_base.insert(format!("{directory}||{base}"), file.file_id);
        mtl_by_base
            .entry(base)
            .or_default()
            .push((directory, file.file_id));
    }

    let mut models = vec![];
    for file in files {
        if extension(&file.label) != "obj" {
            continue;
        }
        let expected_mtl_path = format!(
            "{}.mtl",
            file.path
                .strip_suffix(".obj")
                .or_else(|| file.path.strip_suffix(".OBJ"))
                .unwrap_or(&file.path)
        )
        .to_lowercase();
        let base = basename_without_ext(&file.label).to_lowercase();
        let obj_directory = normalize_slashes(&file.directory_label).to_lowercase();
        let mtl_file_id = mtl_by_expected_path
            .get(&expected_mtl_path)
            .copied()
            .or_else(|| {
                mtl_by_dir_base
                    .get(&format!("{}||{base}", obj_directory))
                    .copied()
            })
            .or_else(|| {
                let candidates = mtl_by_base.get(&base)?;
                candidates
                    .iter()
                    .find(|(directory, _)| {
                        directory.starts_with(&format!("{obj_directory}/"))
                            && (directory.contains("material") || directory.contains("mtl"))
                    })
                    .map(|(_, file_id)| *file_id)
            });
        let directory = normalize_slashes(&file.directory_label);
        let display_name = display_from_file(&directory, &file.label);
        let remote_hash = string_hash(&format!(
            "{}|{}|{}|{}",
            file.file_id,
            mtl_file_id.unwrap_or_default(),
            display_name,
            directory
        ));
        models.push(RemoteModel {
            model_key: file.file_id.to_string(),
            display_name,
            directory,
            obj_file_id: file.file_id,
            mtl_file_id,
            remote_hash,
        });
    }

    models.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
    models
}

fn is_texture_file(file: &RemoteFile) -> bool {
    let ext = extension(&file.label);
    matches!(
        ext.as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "tif" | "tiff" | "bmp" | "gif" | "exr" | "tga"
    ) || file
        .content_type
        .as_deref()
        .is_some_and(|content_type| content_type.to_lowercase().starts_with("image/"))
}

fn likely_model_texture_ids(files: &[RemoteFile], model_directory: &str) -> Vec<i64> {
    let model_dir = normalize_slashes(model_directory)
        .trim()
        .trim_matches('/')
        .to_lowercase();
    let texture_dir_prefix = if model_dir.is_empty() {
        String::new()
    } else {
        format!("{model_dir}/")
    };

    files
        .iter()
        .filter(|file| is_texture_file(file))
        .filter(|file| {
            let file_dir = normalize_slashes(&file.directory_label)
                .trim()
                .trim_matches('/')
                .to_lowercase();
            file_dir == model_dir
                || (file_dir.starts_with(&texture_dir_prefix) && file_dir.contains("texture"))
                || file_dir == "textures"
        })
        .map(|file| file.file_id)
        .collect()
}

/// Fetches Dataverse metadata and converts it into the local catalog shape used
/// by sync diffing, SQLite persistence, and specimen download planning.
async fn fetch_remote_catalog(state: &AppState) -> CommandResult<Vec<RemoteDataset>> {
    let contents_url = format!("{API_ROOT}/dataverses/{DATAVERSE_ID}/contents");
    let contents = fetch_dataverse_json(state, &contents_url).await?;
    let datasets = contents
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut catalog = vec![];
    for item in datasets {
        if item.get("type").and_then(Value::as_str) != Some("dataset") {
            continue;
        }
        let protocol = item
            .get("protocol")
            .and_then(Value::as_str)
            .unwrap_or("doi");
        let Some(authority) = item.get("authority").and_then(Value::as_str) else {
            continue;
        };
        let Some(identifier) = item.get("identifier").and_then(Value::as_str) else {
            continue;
        };
        let persistent_id = format!("{protocol}:{authority}/{identifier}");
        let detail_url = format!(
            "{API_ROOT}/datasets/:persistentId/?persistentId={}",
            percent_encode(&persistent_id)
        );
        let detail = match fetch_dataverse_json(state, &detail_url).await {
            Ok(value) => value,
            Err(error) => {
                eprintln!("[catalog] skipping {persistent_id}: {error}");
                continue;
            }
        };
        let title = extract_title(&detail, identifier);
        let raw_files = detail
            .pointer("/data/latestVersion/files")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let files: Vec<RemoteFile> = raw_files
            .iter()
            .filter_map(remote_file_from_value)
            .collect();
        let models = build_model_index(&files);
        if models.is_empty() {
            continue;
        }
        let remote_hash = json_hash(&json!({
            "persistentId": persistent_id,
            "title": title,
            "models": models.iter().map(|model| &model.remote_hash).collect::<Vec<_>>(),
            "files": files.iter().map(|file| &file.remote_hash).collect::<Vec<_>>()
        }));
        catalog.push(RemoteDataset {
            persistent_id,
            identifier: identifier.to_string(),
            title,
            detail: detail.clone(),
            specimen_summary: extract_specimen_summary(&detail),
            taxonomy_path: extract_taxonomy_path(&detail),
            files,
            models,
            remote_hash,
        });
    }
    catalog.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(catalog)
}

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

fn response_snippet(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .chars()
        .take(240)
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

async fn fetch_dataverse_json(state: &AppState, url: &str) -> CommandResult<Value> {
    let response = dataverse_get(&state.client, url)
        .header(ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| {
            format!(
                "Dataverse request failed for {url}: {}",
                error_chain(&error)
            )
        })?;
    let status = response.status();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("unknown")
        .to_string();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Dataverse response body could not be read for {url}: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "Dataverse returned {status} for {url}: {}",
            response_snippet(&bytes)
        ));
    }

    serde_json::from_slice(&bytes).map_err(|error| {
        format!(
            "Dataverse returned invalid JSON for {url} ({content_type}): {error}. Body starts with: {}",
            response_snippet(&bytes)
        )
    })
}

fn upsert_dataset(
    conn: &Connection,
    dataset: &RemoteDataset,
    replace_downloaded: bool,
) -> CommandResult<()> {
    let ts = now_ts();
    conn.execute(
        r#"
        INSERT INTO catalog_datasets(
          persistent_id, identifier, title, detail_json, specimen_summary_json,
          taxonomy_path_json, remote_hash, last_seen_at
        ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(persistent_id) DO UPDATE SET
          identifier = excluded.identifier,
          title = excluded.title,
          detail_json = excluded.detail_json,
          specimen_summary_json = excluded.specimen_summary_json,
          taxonomy_path_json = excluded.taxonomy_path_json,
          remote_hash = excluded.remote_hash,
          last_seen_at = excluded.last_seen_at
        "#,
        params![
            dataset.persistent_id,
            dataset.identifier,
            dataset.title,
            dataset.detail.to_string(),
            dataset.specimen_summary.as_ref().map(Value::to_string),
            dataset.taxonomy_path.as_ref().map(Value::to_string),
            dataset.remote_hash,
            ts
        ],
    )
    .map_err(to_string)?;

    for file in &dataset.files {
        let existing: Option<(String, Option<String>, Option<String>)> = conn
            .query_row(
                "SELECT download_state, storage_hash, remote_hash FROM catalog_files WHERE file_id = ?1",
                [file.file_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(to_string)?;
        let next_state = match existing {
            Some((state, storage_hash, Some(remote_hash)))
                if state == "downloaded"
                    && storage_hash.is_some()
                    && remote_hash != file.remote_hash =>
            {
                if replace_downloaded {
                    "missing".to_string()
                } else {
                    "update_available".to_string()
                }
            }
            Some((state, _, _)) => state,
            None => "missing".to_string(),
        };

        conn.execute(
            r#"
            INSERT INTO catalog_files(
              file_id, dataset_id, label, directory_label, path, content_type,
              filesize, checksum_type, checksum_value, download_url,
              download_state, remote_hash, updated_at
            ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            ON CONFLICT(file_id) DO UPDATE SET
              dataset_id = excluded.dataset_id,
              label = excluded.label,
              directory_label = excluded.directory_label,
              path = excluded.path,
              content_type = excluded.content_type,
              filesize = excluded.filesize,
              checksum_type = excluded.checksum_type,
              checksum_value = excluded.checksum_value,
              download_url = excluded.download_url,
              download_state = CASE
                WHEN excluded.download_state = 'missing' THEN 'missing'
                ELSE catalog_files.download_state
              END,
              remote_hash = excluded.remote_hash,
              updated_at = excluded.updated_at
            "#,
            params![
                file.file_id,
                dataset.persistent_id,
                file.label,
                file.directory_label,
                file.path,
                file.content_type,
                file.filesize,
                file.checksum_type,
                file.checksum_value,
                file.download_url,
                next_state,
                file.remote_hash,
                ts
            ],
        )
        .map_err(to_string)?;

        if next_state == "update_available" {
            conn.execute(
                "UPDATE catalog_files SET download_state = 'update_available' WHERE file_id = ?1",
                [file.file_id],
            )
            .map_err(to_string)?;
        }
    }

    for model in &dataset.models {
        let model_id = format!("{}::{}", dataset.persistent_id, model.model_key);
        conn.execute(
            r#"
            INSERT INTO catalog_models(
              id, dataset_id, model_key, display_name, directory, obj_file_id,
              mtl_file_id, remote_hash, updated_at
            ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(dataset_id, model_key) DO UPDATE SET
              display_name = excluded.display_name,
              directory = excluded.directory,
              obj_file_id = excluded.obj_file_id,
              mtl_file_id = excluded.mtl_file_id,
              remote_hash = excluded.remote_hash,
              updated_at = excluded.updated_at
            "#,
            params![
                model_id,
                dataset.persistent_id,
                model.model_key,
                model.display_name,
                model.directory,
                model.obj_file_id,
                model.mtl_file_id,
                model.remote_hash,
                ts
            ],
        )
        .map_err(to_string)?;
        upsert_model_file_dependency(
            conn,
            &dataset.persistent_id,
            &model.model_key,
            model.obj_file_id,
            "obj",
        )?;
        if let Some(file_id) = model.mtl_file_id {
            upsert_model_file_dependency(
                conn,
                &dataset.persistent_id,
                &model.model_key,
                file_id,
                "mtl",
            )?;
        }
        for file_id in likely_model_texture_ids(&dataset.files, &model.directory) {
            upsert_model_file_dependency(
                conn,
                &dataset.persistent_id,
                &model.model_key,
                file_id,
                "texture",
            )?;
        }
    }

    refresh_model_states(conn)?;
    Ok(())
}

fn upsert_model_file_dependency(
    conn: &Connection,
    dataset_id: &str,
    model_key: &str,
    file_id: i64,
    role: &str,
) -> CommandResult<()> {
    conn.execute(
        r#"
        INSERT OR IGNORE INTO catalog_model_files(dataset_id, model_key, file_id, role, discovered_at)
        VALUES(?1, ?2, ?3, ?4, ?5)
        "#,
        params![dataset_id, model_key, file_id, role, now_ts()],
    )
    .map_err(to_string)?;
    Ok(())
}

fn refresh_model_states(conn: &Connection) -> CommandResult<()> {
    let mut stmt = conn
        .prepare("SELECT dataset_id, model_key FROM catalog_models")
        .map_err(to_string)?;
    let models: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_string)?;

    for (dataset_id, model_key) in models {
        let file_ids = model_file_ids(conn, &dataset_id, &model_key)?;
        if file_ids.is_empty() {
            continue;
        }
        let states = file_states(conn, &file_ids)?;
        let state = summarize_states(&states);
        conn.execute(
            "UPDATE catalog_models SET download_state = ?1 WHERE dataset_id = ?2 AND model_key = ?3",
            params![state, dataset_id, model_key],
        )
        .map_err(to_string)?;
    }
    Ok(())
}

fn summarize_states(states: &[String]) -> String {
    if states.is_empty() {
        "missing".to_string()
    } else if states.iter().all(|state| state == "downloaded") {
        "downloaded".to_string()
    } else if states
        .iter()
        .all(|state| state == "downloaded" || state == "update_available")
    {
        "update_available".to_string()
    } else if states.iter().any(|state| state == "error") {
        "error".to_string()
    } else if states.iter().any(|state| state == "downloading") {
        "downloading".to_string()
    } else if states.iter().any(|state| state == "paused") {
        "paused".to_string()
    } else if states.iter().any(|state| state == "update_available") {
        "update_available".to_string()
    } else if states.iter().any(|state| state == "queued") {
        "queued".to_string()
    } else if states
        .iter()
        .any(|state| state == "partial" || state == "downloaded")
    {
        "partial".to_string()
    } else {
        "missing".to_string()
    }
}

fn file_states(conn: &Connection, file_ids: &[i64]) -> CommandResult<Vec<String>> {
    let mut states = vec![];
    for file_id in file_ids {
        if let Some(state) = conn
            .query_row(
                "SELECT download_state FROM catalog_files WHERE file_id = ?1",
                [file_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(to_string)?
        {
            states.push(state);
        }
    }
    Ok(states)
}

fn model_file_ids(conn: &Connection, dataset_id: &str, model_key: &str) -> CommandResult<Vec<i64>> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT file_id
            FROM catalog_model_files
            WHERE dataset_id = ?1 AND model_key = ?2
            ORDER BY
              CASE role WHEN 'obj' THEN 0 WHEN 'mtl' THEN 1 ELSE 2 END,
              file_id
            "#,
        )
        .map_err(to_string)?;
    let ids = stmt
        .query_map(params![dataset_id, model_key], |row| row.get::<_, i64>(0))
        .map_err(to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_string)?;
    if !ids.is_empty() {
        return Ok(ids);
    }

    let model: Option<(i64, Option<i64>)> = conn
        .query_row(
            "SELECT obj_file_id, mtl_file_id FROM catalog_models WHERE dataset_id = ?1 AND model_key = ?2",
            params![dataset_id, model_key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(to_string)?;
    let Some((obj_file_id, mtl_file_id)) = model else {
        return Ok(vec![]);
    };

    let mut ids = HashSet::new();
    ids.insert(obj_file_id);
    if let Some(file_id) = mtl_file_id {
        ids.insert(file_id);
    }

    Ok(ids.into_iter().collect())
}

fn diff_catalog(conn: &Connection, remote: &[RemoteDataset]) -> CommandResult<Vec<SyncChange>> {
    let mut changes = vec![];
    let mut seen_datasets = HashSet::new();

    for dataset in remote {
        seen_datasets.insert(dataset.persistent_id.clone());
        let local_hash: Option<String> = conn
            .query_row(
                "SELECT remote_hash FROM catalog_datasets WHERE persistent_id = ?1",
                [dataset.persistent_id.as_str()],
                |row| row.get(0),
            )
            .optional()
            .map_err(to_string)?;
        match local_hash {
            None => changes.push(SyncChange {
                change_type: "new_specimen".to_string(),
                dataset_id: dataset.persistent_id.clone(),
                label: dataset.title.clone(),
                requires_confirmation: false,
            }),
            Some(hash) if hash != dataset.remote_hash => changes.push(SyncChange {
                change_type: "changed_specimen".to_string(),
                dataset_id: dataset.persistent_id.clone(),
                label: dataset.title.clone(),
                requires_confirmation: dataset_has_downloaded_assets(conn, &dataset.persistent_id)?,
            }),
            _ => {}
        }
    }

    let mut stmt = conn
        .prepare("SELECT persistent_id, title FROM catalog_datasets")
        .map_err(to_string)?;
    let local_datasets = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(to_string)?;
    for row in local_datasets {
        let (persistent_id, title) = row.map_err(to_string)?;
        if !seen_datasets.contains(&persistent_id) {
            changes.push(SyncChange {
                change_type: "removed_remote".to_string(),
                dataset_id: persistent_id,
                label: title,
                requires_confirmation: false,
            });
        }
    }

    Ok(changes)
}

fn dataset_has_downloaded_assets(conn: &Connection, dataset_id: &str) -> CommandResult<bool> {
    let count: i64 = conn
        .query_row(
            r#"
            SELECT COUNT(*)
            FROM catalog_files
            WHERE dataset_id = ?1
              AND download_state IN ('downloaded', 'update_available')
              AND storage_path IS NOT NULL
            "#,
            [dataset_id],
            |row| row.get(0),
        )
        .map_err(to_string)?;
    Ok(count > 0)
}

fn required_file_ids_for_dataset(conn: &Connection, dataset_id: &str) -> CommandResult<Vec<i64>> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT DISTINCT file_id
            FROM catalog_model_files
            WHERE dataset_id = ?1
            ORDER BY file_id
            "#,
        )
        .map_err(to_string)?;
    let ids = stmt
        .query_map([dataset_id], |row| row.get::<_, i64>(0))
        .map_err(to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_string)?;
    Ok(ids)
}

fn all_required_file_ids(conn: &Connection) -> CommandResult<Vec<i64>> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT DISTINCT file_id
            FROM catalog_model_files
            ORDER BY file_id
            "#,
        )
        .map_err(to_string)?;
    let ids = stmt
        .query_map([], |row| row.get::<_, i64>(0))
        .map_err(to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_string)?;
    Ok(ids)
}

fn dataset_infos(conn: &Connection, include_incomplete: bool) -> CommandResult<Vec<DatasetInfo>> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT persistent_id, identifier, title, specimen_summary_json, taxonomy_path_json
            FROM catalog_datasets
            ORDER BY title COLLATE NOCASE
            "#,
        )
        .map_err(to_string)?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(to_string)?;

    let mut output = vec![];
    for row in rows {
        let (persistent_id, identifier, title, summary, taxonomy) = row.map_err(to_string)?;
        let stats = dataset_download_stats(conn, &persistent_id)?;
        let state = stats
            .get("state")
            .and_then(Value::as_str)
            .unwrap_or("missing")
            .to_string();
        if !include_incomplete && state != "downloaded" && state != "update_available" {
            continue;
        }
        output.push(DatasetInfo {
            label: title,
            value: persistent_id,
            identifier,
            specimen_summary: summary
                .as_deref()
                .and_then(|value| serde_json::from_str(value).ok()),
            taxonomy_path: taxonomy
                .as_deref()
                .and_then(|value| serde_json::from_str(value).ok()),
            download_state: state,
            download_stats: stats,
        });
    }
    Ok(output)
}

fn dataset_download_stats(conn: &Connection, dataset_id: &str) -> CommandResult<Value> {
    let mut counts = serde_json::Map::new();
    let mut states = vec![];
    let mut files_total = 0i64;
    let mut files_done = 0i64;
    let mut bytes_total = 0i64;
    let mut bytes_downloaded = 0i64;
    for file_id in required_file_ids_for_dataset(conn, dataset_id)? {
        let (state, filesize, downloaded): (String, Option<i64>, i64) = conn
            .query_row(
                "SELECT download_state, filesize, bytes_downloaded FROM catalog_files WHERE file_id = ?1",
                [file_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(to_string)?;
        states.push(state.clone());
        files_total += 1;
        bytes_total += filesize.unwrap_or(0);
        bytes_downloaded += if state == "downloaded" || state == "update_available" {
            if downloaded > 0 {
                downloaded
            } else {
                filesize.unwrap_or(0)
            }
        } else {
            downloaded
        };
        if state == "downloaded" || state == "update_available" {
            files_done += 1;
        }
        let count = counts.get(&state).and_then(Value::as_i64).unwrap_or(0) + 1;
        counts.insert(state, json!(count));
    }
    let state = summarize_states(&states);
    counts.insert("state".to_string(), json!(state));
    counts.insert("filesTotal".to_string(), json!(files_total));
    counts.insert("filesDone".to_string(), json!(files_done));
    counts.insert("bytesTotal".to_string(), json!(bytes_total));
    counts.insert("bytesDownloaded".to_string(), json!(bytes_downloaded));
    Ok(Value::Object(counts))
}

fn file_entry_json(
    file_id: i64,
    label: String,
    directory_label: String,
    path: String,
    filesize: Option<i64>,
    download_state: String,
) -> Value {
    json!({
        "dataFile": {
            "id": file_id,
            "filesize": filesize
        },
        "label": label,
        "directoryLabel": directory_label,
        "path": path,
        "downloadState": download_state
    })
}

fn catalog_entry(conn: &Connection, persistent_id: &str) -> CommandResult<Option<CatalogEntry>> {
    let dataset: Option<(String, String)> = conn
        .query_row(
            "SELECT title, detail_json FROM catalog_datasets WHERE persistent_id = ?1",
            [persistent_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(to_string)?;
    let Some((title, detail_json)) = dataset else {
        return Ok(None);
    };

    let mut file_stmt = conn
        .prepare(
            "SELECT file_id, label, directory_label, path, filesize, download_state FROM catalog_files WHERE dataset_id = ?1",
        )
        .map_err(to_string)?;
    let file_rows = file_stmt
        .query_map([persistent_id], |row| {
            Ok(file_entry_json(
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        })
        .map_err(to_string)?;
    let files = file_rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_string)?;

    let mut model_stmt = conn
        .prepare(
            r#"
            SELECT
              cm.model_key,
              cm.display_name,
              cm.directory,
              cm.obj_file_id,
              cm.mtl_file_id,
              cm.download_state,
              mtl.directory_label
            FROM catalog_models cm
            LEFT JOIN catalog_files mtl ON mtl.file_id = cm.mtl_file_id
            WHERE cm.dataset_id = ?1
            ORDER BY cm.display_name COLLATE NOCASE
            "#,
        )
        .map_err(to_string)?;
    let model_rows = model_stmt
        .query_map([persistent_id], |row| {
            let model_key: String = row.get(0)?;
            let display_name: String = row.get(1)?;
            let directory: String = row.get(2)?;
            let obj_file_id: i64 = row.get(3)?;
            let mtl_file_id: Option<i64> = row.get(4)?;
            let download_state: String = row.get(5)?;
            let mtl_directory: Option<String> = row.get(6)?;
            Ok(json!({
                "key": model_key,
                "displayName": display_name,
                "directory": directory.clone(),
                "downloadState": download_state,
                "objEntry": {
                    "file": { "dataFile": { "id": obj_file_id } },
                    "directory": directory.clone()
                },
                "mtlEntry": mtl_file_id.map(|id| json!({
                    "file": { "dataFile": { "id": id } },
                    "directory": mtl_directory.unwrap_or_else(|| directory.clone())
                }))
            }))
        })
        .map_err(to_string)?;
    let models = model_rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_string)?;
    let detail = serde_json::from_str(&detail_json).map_err(to_string)?;

    Ok(Some(CatalogEntry {
        persistent_id: persistent_id.to_string(),
        title,
        detail,
        files,
        models,
    }))
}

fn enqueue_file(conn: &Connection, file_id: i64, priority: i64) -> CommandResult<()> {
    let dataset_id: String = conn
        .query_row(
            "SELECT dataset_id FROM catalog_files WHERE file_id = ?1",
            [file_id],
            |row| row.get(0),
        )
        .map_err(to_string)?;
    let ts = now_ts();
    conn.execute(
        r#"
        INSERT INTO download_jobs(file_id, dataset_id, priority, status, created_at, updated_at)
        VALUES(?1, ?2, ?3, 'queued', ?4, ?4)
        ON CONFLICT(file_id) DO UPDATE SET
          priority = MAX(download_jobs.priority, excluded.priority),
          status = CASE
            WHEN download_jobs.status IN ('downloaded', 'downloading') THEN download_jobs.status
            ELSE 'queued'
          END,
          error = NULL,
          updated_at = excluded.updated_at
        "#,
        params![file_id, dataset_id, priority, ts],
    )
    .map_err(to_string)?;
    conn.execute(
        "UPDATE catalog_files SET download_state = 'queued', error = NULL WHERE file_id = ?1 AND download_state != 'downloaded'",
        [file_id],
    )
    .map_err(to_string)?;
    Ok(())
}

fn collect_request_file_ids(
    conn: &Connection,
    request: &DownloadEnqueueRequest,
) -> CommandResult<HashSet<i64>> {
    let mut files = HashSet::new();
    if request.all.unwrap_or(false) {
        for dataset_id in all_dataset_ids(conn)? {
            let pending_objs = downloaded_objs_with_unknown_mtls(conn, &dataset_id)?;
            for file_id in pending_objs {
                discover_obj_dependencies(conn, file_id, true)?;
            }
            let pending_mtls = downloaded_mtls_with_unknown_textures(conn, &dataset_id)?;
            for file_id in pending_mtls {
                discover_mtl_dependencies(conn, file_id, true)?;
            }
        }
        for file_id in all_required_file_ids(conn)? {
            let state: String = conn
                .query_row(
                    "SELECT download_state FROM catalog_files WHERE file_id = ?1",
                    [file_id],
                    |row| row.get(0),
                )
                .map_err(to_string)?;
            if state != "downloaded" && state != "update_available" {
                files.insert(file_id);
            }
        }
    }

    if let Some(dataset_ids) = &request.dataset_ids {
        for dataset_id in dataset_ids {
            let pending_objs = downloaded_objs_with_unknown_mtls(conn, dataset_id)?;
            for file_id in pending_objs {
                discover_obj_dependencies(conn, file_id, true)?;
            }
            for file_id in required_file_ids_for_dataset(conn, dataset_id)? {
                let state: String = conn
                    .query_row(
                        "SELECT download_state FROM catalog_files WHERE file_id = ?1",
                        [file_id],
                        |row| row.get(0),
                    )
                    .map_err(to_string)?;
                if state != "downloaded" && state != "update_available" {
                    files.insert(file_id);
                }
            }
            let pending_mtls = downloaded_mtls_with_unknown_textures(conn, dataset_id)?;
            for file_id in pending_mtls {
                discover_mtl_dependencies(conn, file_id, true)?;
                for required_id in required_file_ids_for_dataset(conn, dataset_id)? {
                    let state: String = conn
                        .query_row(
                            "SELECT download_state FROM catalog_files WHERE file_id = ?1",
                            [required_id],
                            |row| row.get(0),
                        )
                        .map_err(to_string)?;
                    if state != "downloaded" && state != "update_available" {
                        files.insert(required_id);
                    }
                }
            }
        }
    }

    Ok(files)
}

fn all_dataset_ids(conn: &Connection) -> CommandResult<Vec<String>> {
    let mut stmt = conn
        .prepare("SELECT persistent_id FROM catalog_datasets ORDER BY persistent_id")
        .map_err(to_string)?;
    let ids = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_string)?;
    Ok(ids)
}

fn downloaded_objs_with_unknown_mtls(
    conn: &Connection,
    dataset_id: &str,
) -> CommandResult<Vec<i64>> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT DISTINCT cm.obj_file_id
            FROM catalog_models cm
            JOIN catalog_files f ON f.file_id = cm.obj_file_id
            WHERE cm.dataset_id = ?1
              AND cm.mtl_file_id IS NULL
              AND f.download_state IN ('downloaded', 'update_available')
              AND f.storage_path IS NOT NULL
            "#,
        )
        .map_err(to_string)?;
    let ids = stmt
        .query_map([dataset_id], |row| row.get::<_, i64>(0))
        .map_err(to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_string)?;
    Ok(ids)
}

fn downloaded_mtls_with_unknown_textures(
    conn: &Connection,
    dataset_id: &str,
) -> CommandResult<Vec<i64>> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT DISTINCT cm.mtl_file_id
            FROM catalog_models cm
            JOIN catalog_files f ON f.file_id = cm.mtl_file_id
            WHERE cm.dataset_id = ?1
              AND cm.mtl_file_id IS NOT NULL
              AND f.download_state IN ('downloaded', 'update_available')
              AND f.storage_path IS NOT NULL
              AND NOT EXISTS (
                SELECT 1
                FROM catalog_model_files cmf
                WHERE cmf.dataset_id = cm.dataset_id
                  AND cmf.model_key = cm.model_key
                  AND cmf.role = 'texture'
              )
            "#,
        )
        .map_err(to_string)?;
    let ids = stmt
        .query_map([dataset_id], |row| row.get::<_, i64>(0))
        .map_err(to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_string)?;
    Ok(ids)
}

fn normalize_relative_path(base_dir: &str, relative_path: &str) -> String {
    let mut stack = directory_parts(base_dir);
    for segment in normalize_slashes(relative_path).split('/') {
        let trimmed = segment.trim();
        if trimmed.is_empty() || trimmed == "." {
            continue;
        }
        if trimmed == ".." {
            stack.pop();
        } else {
            stack.push(trimmed.to_string());
        }
    }
    stack.join("/")
}

fn strip_mtl_token_quotes(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string()
}

fn split_material_tokens(value: &str) -> Vec<String> {
    let mut tokens = vec![];
    let mut current = String::new();
    let mut quote: Option<char> = None;

    for char in value.chars() {
        if quote == Some(char) {
            quote = None;
            continue;
        }
        if quote.is_none() && (char == '"' || char == '\'') {
            quote = Some(char);
            continue;
        }
        if quote.is_none() && char.is_whitespace() {
            if !current.is_empty() {
                tokens.push(current.clone());
                current.clear();
            }
            continue;
        }
        current.push(char);
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

fn parse_obj_material_library_references(contents: &str) -> Vec<String> {
    let mut references = vec![];
    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let mut parts = trimmed.splitn(2, char::is_whitespace);
        let Some(key) = parts.next() else {
            continue;
        };
        if key.to_lowercase() != "mtllib" {
            continue;
        }
        let rest = parts.next().unwrap_or("").trim();
        if rest.is_empty() {
            continue;
        }
        references.push(strip_mtl_token_quotes(rest));
        for token in split_material_tokens(rest) {
            references.push(strip_mtl_token_quotes(&token));
        }
    }
    references.retain(|reference| !reference.is_empty());
    references.sort();
    references.dedup();
    references
}

fn parse_mtl_texture_references(contents: &str) -> Vec<String> {
    let texture_keys = HashSet::from([
        "map_ka",
        "map_kd",
        "map_ks",
        "map_ke",
        "map_ns",
        "map_d",
        "map_bump",
        "map_normal",
        "map_tangentspacenormal",
        "map_roughness",
        "map_pr",
        "map_ao",
        "bump",
        "disp",
        "decal",
        "refl",
        "norm",
    ]);
    let option_args = HashSet::from([
        "-blendu", "-blendv", "-boost", "-mm", "-o", "-s", "-t", "-texres", "-clamp", "-bm",
        "-imfchan", "-type",
    ]);
    let mut references = vec![];
    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let mut parts = trimmed.splitn(2, char::is_whitespace);
        let Some(key) = parts.next() else {
            continue;
        };
        if !texture_keys.contains(key.to_lowercase().as_str()) {
            continue;
        }
        let rest = split_material_tokens(parts.next().unwrap_or(""));
        let mut candidates = vec![];
        let mut index = 0usize;
        while index < rest.len() {
            let token = rest[index].as_str();
            let lowered = token.to_lowercase();
            if option_args.contains(lowered.as_str()) {
                index += match lowered.as_str() {
                    "-mm" | "-o" | "-s" | "-t" => 4,
                    "-type" => 2,
                    _ => 2,
                };
                continue;
            }
            if token.starts_with('-') {
                index += 1;
                continue;
            }
            candidates.push(strip_mtl_token_quotes(&rest[index..].join(" ")));
            break;
        }
        if let Some(reference) = candidates.last() {
            if !reference.is_empty() {
                references.push(reference.clone());
            }
        }
    }
    references.sort();
    references.dedup();
    references
}

fn file_by_path(conn: &Connection, dataset_id: &str, path: &str) -> CommandResult<Option<i64>> {
    let normalized = normalize_slashes(path).trim().trim_matches('/').to_string();
    if normalized.is_empty() {
        return Ok(None);
    }
    let direct = conn
        .query_row(
            "SELECT file_id FROM catalog_files WHERE dataset_id = ?1 AND lower(path) = lower(?2)",
            params![dataset_id, normalized],
            |row| row.get(0),
        )
        .optional()
        .map_err(to_string)?;
    if direct.is_some() {
        return Ok(direct);
    }
    let filename = normalized
        .split('/')
        .next_back()
        .unwrap_or(&normalized)
        .to_lowercase();
    conn.query_row(
        "SELECT file_id FROM catalog_files WHERE dataset_id = ?1 AND lower(label) = ?2 ORDER BY file_id LIMIT 1",
        params![dataset_id, filename],
        |row| row.get(0),
    )
    .optional()
    .map_err(to_string)
}

fn discover_mtl_dependencies(
    conn: &Connection,
    mtl_file_id: i64,
    enqueue_discovered: bool,
) -> CommandResult<usize> {
    let mtl: Option<(String, String, String)> = conn
        .query_row(
            r#"
            SELECT dataset_id, directory_label, storage_path
            FROM catalog_files
            WHERE file_id = ?1
              AND download_state IN ('downloaded', 'update_available')
              AND storage_path IS NOT NULL
            "#,
            [mtl_file_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(to_string)?;
    let Some((dataset_id, mtl_directory, storage_path)) = mtl else {
        return Ok(0);
    };
    let contents = fs::read_to_string(conn_path_from_storage(conn, &storage_path)?)
        .unwrap_or_else(|_| String::new());
    if contents.is_empty() {
        return Ok(0);
    }
    let model_keys = model_keys_for_mtl(conn, mtl_file_id)?;
    let mut added = 0usize;
    for reference in parse_mtl_texture_references(&contents) {
        if reference.starts_with("http://") || reference.starts_with("https://") {
            continue;
        }
        let path = normalize_relative_path(&mtl_directory, &reference);
        let Some(texture_file_id) = file_by_path(conn, &dataset_id, &path)? else {
            eprintln!(
                "[downloads] MTL file {mtl_file_id} references missing catalog texture: {reference}"
            );
            continue;
        };
        for model_key in &model_keys {
            upsert_model_file_dependency(conn, &dataset_id, model_key, texture_file_id, "texture")?;
        }
        if enqueue_discovered {
            let state: String = conn
                .query_row(
                    "SELECT download_state FROM catalog_files WHERE file_id = ?1",
                    [texture_file_id],
                    |row| row.get(0),
                )
                .map_err(to_string)?;
            if state != "downloaded" && state != "update_available" {
                enqueue_file(conn, texture_file_id, 0)?;
                added += 1;
            }
        }
    }
    Ok(added)
}

fn discover_obj_dependencies(
    conn: &Connection,
    obj_file_id: i64,
    enqueue_discovered: bool,
) -> CommandResult<usize> {
    let obj: Option<(String, String, String)> = conn
        .query_row(
            r#"
            SELECT dataset_id, directory_label, storage_path
            FROM catalog_files
            WHERE file_id = ?1
              AND download_state IN ('downloaded', 'update_available')
              AND storage_path IS NOT NULL
            "#,
            [obj_file_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(to_string)?;
    let Some((dataset_id, obj_directory, storage_path)) = obj else {
        return Ok(0);
    };
    let contents = fs::read_to_string(conn_path_from_storage(conn, &storage_path)?)
        .unwrap_or_else(|_| String::new());
    if contents.is_empty() {
        return Ok(0);
    }

    let model_keys = model_keys_for_obj(conn, obj_file_id)?;
    let mut added = 0usize;
    for reference in parse_obj_material_library_references(&contents) {
        if reference.starts_with("http://") || reference.starts_with("https://") {
            continue;
        }
        let path = normalize_relative_path(&obj_directory, &reference);
        let Some(mtl_file_id) = file_by_path(conn, &dataset_id, &path)? else {
            eprintln!(
                "[downloads] OBJ file {obj_file_id} references missing catalog material library: {reference}"
            );
            continue;
        };
        for model_key in &model_keys {
            upsert_model_file_dependency(conn, &dataset_id, model_key, mtl_file_id, "mtl")?;
            conn.execute(
                r#"
                UPDATE catalog_models
                SET mtl_file_id = COALESCE(mtl_file_id, ?1), updated_at = ?2
                WHERE dataset_id = ?3 AND model_key = ?4
                "#,
                params![mtl_file_id, now_ts(), dataset_id, model_key],
            )
            .map_err(to_string)?;
        }

        let state: String = conn
            .query_row(
                "SELECT download_state FROM catalog_files WHERE file_id = ?1",
                [mtl_file_id],
                |row| row.get(0),
            )
            .map_err(to_string)?;
        if state == "downloaded" || state == "update_available" {
            added += discover_mtl_dependencies(conn, mtl_file_id, enqueue_discovered)?;
        } else if enqueue_discovered {
            enqueue_file(conn, mtl_file_id, 0)?;
            added += 1;
        }
    }
    Ok(added)
}

fn conn_path_from_storage(conn: &Connection, storage_path: &str) -> CommandResult<PathBuf> {
    let db_path = conn
        .path()
        .ok_or_else(|| "Database path unavailable".to_string())?;
    let db_path = PathBuf::from(db_path);
    let data_dir = db_path
        .parent()
        .ok_or_else(|| "Database directory unavailable".to_string())?;
    Ok(data_dir.join(storage_path))
}

fn model_keys_for_obj(conn: &Connection, obj_file_id: i64) -> CommandResult<Vec<String>> {
    let mut stmt = conn
        .prepare("SELECT model_key FROM catalog_models WHERE obj_file_id = ?1")
        .map_err(to_string)?;
    let keys = stmt
        .query_map([obj_file_id], |row| row.get::<_, String>(0))
        .map_err(to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_string)?;
    Ok(keys)
}

fn model_keys_for_mtl(conn: &Connection, mtl_file_id: i64) -> CommandResult<Vec<String>> {
    let mut stmt = conn
        .prepare("SELECT model_key FROM catalog_models WHERE mtl_file_id = ?1")
        .map_err(to_string)?;
    let keys = stmt
        .query_map([mtl_file_id], |row| row.get::<_, String>(0))
        .map_err(to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_string)?;
    Ok(keys)
}

/// Starts one background worker per process to drain queued file downloads.
/// The worker exits when the queue is empty and can be started again by enqueue
/// or resume commands.
async fn ensure_worker(state: AppState) {
    let mut active = state.worker_active.lock().await;
    if *active {
        return;
    }
    *active = true;
    drop(active);

    tauri::async_runtime::spawn(async move {
        loop {
            let next_job = match next_download_job(&state) {
                Ok(value) => value,
                Err(error) => {
                    eprintln!("[downloads] failed to read next job: {error}");
                    break;
                }
            };
            let Some((job_id, file_id)) = next_job else {
                break;
            };

            match download_one(&state, job_id, file_id).await {
                Ok(DownloadOutcome::Complete) => {
                    let _ = mark_job_complete(&state, job_id, file_id);
                }
                Ok(DownloadOutcome::Paused) => {
                    let _ = mark_job_paused(&state, job_id, file_id);
                }
                Ok(DownloadOutcome::Cancelled) => {
                    let _ = mark_job_cancelled(&state, job_id, file_id);
                }
                Err(error) => {
                    let _ = mark_job_error(&state, job_id, file_id, &error);
                }
            }
        }
        let mut active = state.worker_active.lock().await;
        *active = false;
    });
}

fn next_download_job(state: &AppState) -> CommandResult<Option<(i64, i64)>> {
    let conn = state.connect()?;
    conn.query_row(
        r#"
        SELECT id, file_id
        FROM download_jobs
        WHERE status = 'queued'
        ORDER BY priority DESC, id ASC
        LIMIT 1
        "#,
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(to_string)
}

#[allow(clippy::type_complexity)]
fn file_download_info(
    state: &AppState,
    file_id: i64,
) -> CommandResult<(String, Option<i64>, String, Option<String>, Option<String>)> {
    let conn = state.connect()?;
    conn.query_row(
        "SELECT download_url, filesize, label, checksum_type, checksum_value FROM catalog_files WHERE file_id = ?1",
        [file_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
    )
    .map_err(to_string)
}

async fn download_one(
    state: &AppState,
    job_id: i64,
    file_id: i64,
) -> CommandResult<DownloadOutcome> {
    let (url, expected_size, label, checksum_type, checksum_value) =
        file_download_info(state, file_id)?;
    {
        let conn = state.connect()?;
        conn.execute(
            "UPDATE download_jobs SET status = 'downloading', updated_at = ?1 WHERE id = ?2",
            params![now_ts(), job_id],
        )
        .map_err(to_string)?;
        conn.execute(
            "UPDATE catalog_files SET download_state = 'downloading', error = NULL WHERE file_id = ?1",
            [file_id],
        )
        .map_err(to_string)?;
    }

    let tmp_path = state.data_dir.join("tmp").join(format!("{file_id}.part"));
    let mut existing_len = tokio::fs::metadata(&tmp_path)
        .await
        .map(|metadata| metadata.len())
        .unwrap_or(0);

    let mut request = dataverse_get(&state.client, &url);
    if existing_len > 0 {
        request = request.header(RANGE, format!("bytes={existing_len}-"));
    }
    let response = request
        .send()
        .await
        .map_err(|error| error_chain(&error))?
        .error_for_status()
        .map_err(|error| error_chain(&error))?;
    if existing_len > 0 && response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        existing_len = 0;
    }

    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(existing_len > 0)
        .write(true)
        .truncate(existing_len == 0)
        .open(&tmp_path)
        .await
        .map_err(to_string)?;
    let mut downloaded = existing_len;
    let total = expected_size.map(|value| value as u64).or_else(|| {
        response
            .headers()
            .get(CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
            .map(|value| value + existing_len)
    });

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error_chain(&error))?;
        file.write_all(&chunk).await.map_err(to_string)?;
        downloaded += chunk.len() as u64;
        update_download_progress(state, job_id, file_id, downloaded, total)?;

        let status = current_job_status(state, job_id)?;
        if status == "paused" {
            return Ok(DownloadOutcome::Paused);
        }
        if status == "cancelled" {
            return Ok(DownloadOutcome::Cancelled);
        }
    }
    file.flush().await.map_err(to_string)?;
    drop(file);

    if let Some(expected) = expected_size {
        let actual = tokio::fs::metadata(&tmp_path)
            .await
            .map_err(to_string)?
            .len() as i64;
        if actual != expected {
            return Err(format!(
                "Downloaded size mismatch for file {file_id}: expected {expected}, got {actual}"
            ));
        }
    }

    if checksum_type.as_deref().map(str::to_lowercase).as_deref() == Some("md5") {
        if let Some(expected_md5) = checksum_value.as_deref() {
            let actual_md5 = md5_file(&tmp_path).await?;
            if actual_md5 != expected_md5.to_lowercase() {
                return Err(format!(
                    "Downloaded checksum mismatch for file {file_id}: expected {expected_md5}, got {actual_md5}"
                ));
            }
        }
    }

    let sha = sha256_file(&tmp_path).await?;
    let blob_rel = format!("assets/{}/{}", &sha[..2], sha);
    let blob_path = state.data_dir.join(&blob_rel);
    if let Some(parent) = blob_path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(to_string)?;
    }
    tokio::fs::rename(&tmp_path, &blob_path)
        .await
        .map_err(to_string)?;

    let conn = state.connect()?;
    conn.execute(
        r#"
        UPDATE catalog_files
        SET download_state = 'downloaded',
            storage_hash = ?1,
            storage_path = ?2,
            bytes_downloaded = ?3,
            error = NULL,
            updated_at = ?4
        WHERE file_id = ?5
        "#,
        params![sha, blob_rel, downloaded as i64, now_ts(), file_id],
    )
    .map_err(to_string)?;
    match extension(&label).as_str() {
        "obj" => {
            let _ = discover_obj_dependencies(&conn, file_id, true)?;
        }
        "mtl" => {
            let _ = discover_mtl_dependencies(&conn, file_id, true)?;
        }
        _ => {}
    }
    refresh_model_states(&conn)?;
    Ok(DownloadOutcome::Complete)
}

async fn sha256_file(path: &Path) -> CommandResult<String> {
    let mut file = tokio::fs::File::open(path).await.map_err(to_string)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let bytes = file.read(&mut buffer).await.map_err(to_string)?;
        if bytes == 0 {
            break;
        }
        hasher.update(&buffer[..bytes]);
    }
    Ok(hex::encode(hasher.finalize()))
}

async fn md5_file(path: &Path) -> CommandResult<String> {
    let mut file = tokio::fs::File::open(path).await.map_err(to_string)?;
    let mut context = md5::Context::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let bytes = file.read(&mut buffer).await.map_err(to_string)?;
        if bytes == 0 {
            break;
        }
        context.consume(&buffer[..bytes]);
    }
    Ok(format!("{:x}", context.compute()))
}

fn update_download_progress(
    state: &AppState,
    job_id: i64,
    file_id: i64,
    downloaded: u64,
    total: Option<u64>,
) -> CommandResult<()> {
    let conn = state.connect()?;
    conn.execute(
        r#"
        UPDATE download_jobs
        SET bytes_downloaded = ?1, total_bytes = ?2, updated_at = ?3
        WHERE id = ?4
        "#,
        params![
            downloaded as i64,
            total.map(|value| value as i64),
            now_ts(),
            job_id
        ],
    )
    .map_err(to_string)?;
    conn.execute(
        "UPDATE catalog_files SET bytes_downloaded = ?1 WHERE file_id = ?2",
        params![downloaded as i64, file_id],
    )
    .map_err(to_string)?;
    Ok(())
}

fn current_job_status(state: &AppState, job_id: i64) -> CommandResult<String> {
    let conn = state.connect()?;
    conn.query_row(
        "SELECT status FROM download_jobs WHERE id = ?1",
        [job_id],
        |row| row.get(0),
    )
    .map_err(to_string)
}

fn mark_job_complete(state: &AppState, job_id: i64, _file_id: i64) -> CommandResult<()> {
    let conn = state.connect()?;
    conn.execute(
        "UPDATE download_jobs SET status = 'downloaded', updated_at = ?1 WHERE id = ?2",
        params![now_ts(), job_id],
    )
    .map_err(to_string)?;
    Ok(())
}

fn mark_job_paused(state: &AppState, job_id: i64, file_id: i64) -> CommandResult<()> {
    let conn = state.connect()?;
    conn.execute(
        "UPDATE download_jobs SET status = 'paused', updated_at = ?1 WHERE id = ?2",
        params![now_ts(), job_id],
    )
    .map_err(to_string)?;
    conn.execute(
        "UPDATE catalog_files SET download_state = 'paused' WHERE file_id = ?1",
        [file_id],
    )
    .map_err(to_string)?;
    refresh_model_states(&conn)?;
    Ok(())
}

fn mark_job_cancelled(state: &AppState, job_id: i64, file_id: i64) -> CommandResult<()> {
    let conn = state.connect()?;
    conn.execute("DELETE FROM download_jobs WHERE id = ?1", [job_id])
        .map_err(to_string)?;
    conn.execute(
        "UPDATE catalog_files SET download_state = 'missing' WHERE file_id = ?1 AND download_state != 'downloaded'",
        [file_id],
    )
    .map_err(to_string)?;
    refresh_model_states(&conn)?;
    Ok(())
}

fn mark_job_error(state: &AppState, job_id: i64, file_id: i64, error: &str) -> CommandResult<()> {
    let conn = state.connect()?;
    conn.execute(
        "UPDATE download_jobs SET status = 'error', error = ?1, updated_at = ?2 WHERE id = ?3",
        params![error, now_ts(), job_id],
    )
    .map_err(to_string)?;
    conn.execute(
        "UPDATE catalog_files SET download_state = 'error', error = ?1 WHERE file_id = ?2",
        params![error, file_id],
    )
    .map_err(to_string)?;
    refresh_model_states(&conn)?;
    Ok(())
}

// Tauri command surface consumed by the frontend data clients. The commands
// intentionally return serializable DTOs instead of exposing SQLite details.
#[tauri::command]
async fn network_status(state: State<'_, AppState>) -> CommandResult<Value> {
    let url = format!("{API_ROOT}/dataverses/{DATAVERSE_ID}/contents");
    let online = dataverse_get(&state.client, &url)
        .send()
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false);
    Ok(json!({ "online": online }))
}

#[tauri::command]
fn catalog_list(
    state: State<'_, AppState>,
    include_incomplete: Option<bool>,
) -> CommandResult<Vec<DatasetInfo>> {
    let conn = state.connect()?;
    dataset_infos(&conn, include_incomplete.unwrap_or(false))
}

#[tauri::command]
fn catalog_entry_command(
    state: State<'_, AppState>,
    persistent_id: String,
) -> CommandResult<Option<CatalogEntry>> {
    let conn = state.connect()?;
    catalog_entry(&conn, &persistent_id)
}

#[tauri::command]
async fn sync_preview(state: State<'_, AppState>) -> CommandResult<SyncPreview> {
    let remote = fetch_remote_catalog(&state).await?;
    let conn = state.connect()?;
    let changes = diff_catalog(&conn, &remote)?;
    let models_scanned = remote.iter().map(|dataset| dataset.models.len()).sum();
    Ok(SyncPreview {
        datasets_scanned: remote.len(),
        models_scanned,
        changes,
        datasets: remote
            .iter()
            .map(|dataset| SyncPreviewDataset {
                persistent_id: dataset.persistent_id.clone(),
                identifier: dataset.identifier.clone(),
                title: dataset.title.clone(),
            })
            .collect(),
    })
}

#[tauri::command]
async fn sync_apply(
    state: State<'_, AppState>,
    decisions: Option<Vec<SyncDecision>>,
) -> CommandResult<SyncApplyResult> {
    let remote = fetch_remote_catalog(&state).await?;
    let conn = state.connect()?;
    let changes = diff_catalog(&conn, &remote)?;
    let mut applied = 0usize;
    let mut skipped = 0usize;
    let replace_set: HashSet<String> = decisions
        .unwrap_or_default()
        .into_iter()
        .filter(|decision| decision.action == "replace")
        .map(|decision| decision.dataset_id)
        .collect();

    for dataset in &remote {
        let dataset_has_confirmation = changes.iter().any(|change| {
            change.dataset_id == dataset.persistent_id && change.requires_confirmation
        });
        let replace_dataset = replace_set.contains(&dataset.persistent_id);
        if dataset_has_confirmation && !replace_dataset {
            skipped += 1;
            continue;
        }
        upsert_dataset(&conn, dataset, replace_dataset)?;
        applied += 1;
    }

    Ok(SyncApplyResult {
        applied,
        skipped,
        changes,
    })
}

#[tauri::command]
async fn download_enqueue(
    state: State<'_, AppState>,
    request: DownloadEnqueueRequest,
) -> CommandResult<usize> {
    let count = {
        let conn = state.connect()?;
        let mut files = collect_request_file_ids(&conn, &request)?;
        if files.is_empty() && request_targets_remote_catalog(&request) {
            let remote = fetch_remote_catalog(state.inner()).await?;
            import_remote_catalog_for_request(&conn, &remote, &request)?;
            files = collect_request_file_ids(&conn, &request)?;
        }
        for file_id in &files {
            enqueue_file(&conn, *file_id, 0)?;
        }
        refresh_model_states(&conn)?;
        files.len()
    };
    ensure_worker(state.inner().clone()).await;
    Ok(count)
}

fn request_targets_remote_catalog(request: &DownloadEnqueueRequest) -> bool {
    request.all.unwrap_or(false)
        || request
            .dataset_ids
            .as_ref()
            .is_some_and(|dataset_ids| !dataset_ids.is_empty())
}

fn import_remote_catalog_for_request(
    conn: &Connection,
    remote: &[RemoteDataset],
    request: &DownloadEnqueueRequest,
) -> CommandResult<()> {
    let mut selected = HashSet::new();
    if request.all.unwrap_or(false) {
        for dataset in remote {
            selected.insert(dataset.persistent_id.clone());
        }
    }
    if let Some(dataset_ids) = &request.dataset_ids {
        for dataset_id in dataset_ids {
            selected.insert(dataset_id.clone());
        }
    }

    for dataset in remote {
        if selected.contains(&dataset.persistent_id) {
            upsert_dataset(conn, dataset, false)?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn download_resume(
    state: State<'_, AppState>,
    dataset_id: Option<String>,
) -> CommandResult<()> {
    {
        let conn = state.connect()?;
        if let Some(dataset_id) = dataset_id.as_deref() {
            conn.execute(
                r#"
                UPDATE download_jobs
                SET status = 'queued', updated_at = ?1
                WHERE dataset_id = ?2 AND status IN ('paused', 'error')
                "#,
                params![now_ts(), dataset_id],
            )
            .map_err(to_string)?;
            conn.execute(
                r#"
                UPDATE catalog_files
                SET download_state = 'queued'
                WHERE dataset_id = ?1 AND download_state IN ('paused', 'partial', 'error')
                "#,
                [dataset_id],
            )
            .map_err(to_string)?;
        } else {
            conn.execute(
                "UPDATE download_jobs SET status = 'queued', updated_at = ?1 WHERE status IN ('paused', 'error')",
                [now_ts()],
            )
            .map_err(to_string)?;
            conn.execute(
                "UPDATE catalog_files SET download_state = 'queued' WHERE download_state IN ('paused', 'partial', 'error')",
                [],
            )
            .map_err(to_string)?;
        }
        refresh_model_states(&conn)?;
    }
    ensure_worker(state.inner().clone()).await;
    Ok(())
}

#[tauri::command]
fn download_pause(state: State<'_, AppState>, dataset_id: Option<String>) -> CommandResult<()> {
    let conn = state.connect()?;
    if let Some(dataset_id) = dataset_id.as_deref() {
        conn.execute(
            r#"
            UPDATE download_jobs
            SET status = 'paused', updated_at = ?1
            WHERE dataset_id = ?2 AND status IN ('queued', 'downloading')
            "#,
            params![now_ts(), dataset_id],
        )
        .map_err(to_string)?;
        conn.execute(
            r#"
            UPDATE catalog_files
            SET download_state = 'paused'
            WHERE dataset_id = ?1 AND download_state IN ('queued', 'downloading')
            "#,
            [dataset_id],
        )
        .map_err(to_string)?;
    } else {
        conn.execute(
            "UPDATE download_jobs SET status = 'paused', updated_at = ?1 WHERE status IN ('queued', 'downloading')",
            [now_ts()],
        )
        .map_err(to_string)?;
        conn.execute(
            "UPDATE catalog_files SET download_state = 'paused' WHERE download_state IN ('queued', 'downloading')",
            [],
        )
        .map_err(to_string)?;
    }
    refresh_model_states(&conn)?;
    Ok(())
}

#[tauri::command]
fn download_cancel(state: State<'_, AppState>, dataset_id: Option<String>) -> CommandResult<()> {
    let conn = state.connect()?;
    if let Some(dataset_id) = dataset_id.as_deref() {
        conn.execute(
            r#"
            UPDATE download_jobs
            SET status = 'cancelled', updated_at = ?1
            WHERE dataset_id = ?2 AND status = 'downloading'
            "#,
            params![now_ts(), dataset_id],
        )
        .map_err(to_string)?;
        conn.execute(
            "DELETE FROM download_jobs WHERE dataset_id = ?1 AND status IN ('queued', 'paused', 'error')",
            [dataset_id],
        )
        .map_err(to_string)?;
        conn.execute(
            r#"
            UPDATE catalog_files
            SET download_state = 'missing'
            WHERE dataset_id = ?1 AND download_state IN ('queued', 'downloading', 'paused', 'partial', 'error')
            "#,
            [dataset_id],
        )
        .map_err(to_string)?;
    } else {
        conn.execute(
            "UPDATE download_jobs SET status = 'cancelled', updated_at = ?1 WHERE status = 'downloading'",
            [now_ts()],
        )
        .map_err(to_string)?;
        conn.execute(
            "DELETE FROM download_jobs WHERE status IN ('queued', 'paused', 'error')",
            [],
        )
        .map_err(to_string)?;
        conn.execute(
            "UPDATE catalog_files SET download_state = 'missing' WHERE download_state IN ('queued', 'downloading', 'paused', 'partial', 'error')",
            [],
        )
        .map_err(to_string)?;
    }
    refresh_model_states(&conn)?;
    Ok(())
}

fn download_status_for_state(state: &AppState) -> CommandResult<DownloadStatus> {
    let conn = state.connect()?;
    let count = |status: &str| -> CommandResult<i64> {
        conn.query_row(
            "SELECT COUNT(*) FROM download_jobs WHERE status = ?1",
            [status],
            |row| row.get(0),
        )
        .map_err(to_string)
    };
    let global = download_global_stats(&conn)?;
    let specimens = download_specimen_statuses(&conn)?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT j.id, j.file_id, j.dataset_id, d.title, f.label, f.path, j.status,
                   j.bytes_downloaded, COALESCE(j.total_bytes, f.filesize), j.error
            FROM download_jobs j
            JOIN catalog_files f ON f.file_id = j.file_id
            JOIN catalog_datasets d ON d.persistent_id = j.dataset_id
            WHERE j.status IN ('queued', 'downloading', 'paused', 'error')
            ORDER BY j.status = 'downloading' DESC, j.priority DESC, j.id ASC
            LIMIT 250
            "#,
        )
        .map_err(to_string)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(json!({
                "id": row.get::<_, i64>(0)?,
                "fileId": row.get::<_, i64>(1)?,
                "datasetId": row.get::<_, String>(2)?,
                "datasetLabel": row.get::<_, String>(3)?,
                "label": row.get::<_, String>(4)?,
                "path": row.get::<_, String>(5)?,
                "status": row.get::<_, String>(6)?,
                "bytesDownloaded": row.get::<_, i64>(7)?,
                "totalBytes": row.get::<_, Option<i64>>(8)?,
                "error": row.get::<_, Option<String>>(9)?
            }))
        })
        .map_err(to_string)?;

    Ok(DownloadStatus {
        global,
        queued: count("queued")?,
        downloading: count("downloading")?,
        paused: count("paused")?,
        downloaded: count("downloaded")?,
        error: count("error")?,
        specimens,
        files: rows.collect::<Result<Vec<_>, _>>().map_err(to_string)?,
    })
}

fn download_global_stats(conn: &Connection) -> CommandResult<Value> {
    let mut states = vec![];
    let mut files_total = 0i64;
    let mut files_done = 0i64;
    let mut bytes_total = 0i64;
    let mut bytes_downloaded = 0i64;
    for file_id in all_required_file_ids(conn)? {
        let (state, filesize, downloaded): (String, Option<i64>, i64) = conn
            .query_row(
                "SELECT download_state, filesize, bytes_downloaded FROM catalog_files WHERE file_id = ?1",
                [file_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(to_string)?;
        states.push(state.clone());
        files_total += 1;
        bytes_total += filesize.unwrap_or(0);
        bytes_downloaded += if state == "downloaded" || state == "update_available" {
            if downloaded > 0 {
                downloaded
            } else {
                filesize.unwrap_or(0)
            }
        } else {
            downloaded
        };
        if state == "downloaded" || state == "update_available" {
            files_done += 1;
        }
    }
    Ok(json!({
        "state": summarize_states(&states),
        "filesTotal": files_total,
        "filesDone": files_done,
        "bytesTotal": bytes_total,
        "bytesDownloaded": bytes_downloaded
    }))
}

fn active_files_for_dataset(conn: &Connection, dataset_id: &str) -> CommandResult<Vec<Value>> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT j.file_id, f.label, f.path, j.status, j.bytes_downloaded,
                   COALESCE(j.total_bytes, f.filesize), j.error
            FROM download_jobs j
            JOIN catalog_files f ON f.file_id = j.file_id
            WHERE j.dataset_id = ?1
              AND j.status IN ('queued', 'downloading', 'paused', 'error')
            ORDER BY j.status = 'downloading' DESC, j.priority DESC, j.id ASC
            LIMIT 8
            "#,
        )
        .map_err(to_string)?;
    let rows = stmt
        .query_map([dataset_id], |row| {
            Ok(json!({
                "fileId": row.get::<_, i64>(0)?,
                "label": row.get::<_, String>(1)?,
                "path": row.get::<_, String>(2)?,
                "status": row.get::<_, String>(3)?,
                "bytesDownloaded": row.get::<_, i64>(4)?,
                "totalBytes": row.get::<_, Option<i64>>(5)?,
                "error": row.get::<_, Option<String>>(6)?
            }))
        })
        .map_err(to_string)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(to_string)
}

fn dataset_error(conn: &Connection, dataset_id: &str) -> CommandResult<Option<String>> {
    conn.query_row(
        r#"
        SELECT error
        FROM catalog_files
        WHERE dataset_id = ?1 AND error IS NOT NULL AND error != ''
        ORDER BY updated_at DESC
        LIMIT 1
        "#,
        [dataset_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(to_string)
}

fn download_specimen_statuses(conn: &Connection) -> CommandResult<Vec<Value>> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT persistent_id, title
            FROM catalog_datasets
            ORDER BY title COLLATE NOCASE
            "#,
        )
        .map_err(to_string)?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(to_string)?;
    let mut specimens = vec![];
    for row in rows {
        let (dataset_id, label) = row.map_err(to_string)?;
        let stats = dataset_download_stats(conn, &dataset_id)?;
        let state = stats
            .get("state")
            .and_then(Value::as_str)
            .unwrap_or("missing")
            .to_string();
        let files_total = stats.get("filesTotal").and_then(Value::as_i64).unwrap_or(0);
        let files_done = stats.get("filesDone").and_then(Value::as_i64).unwrap_or(0);
        let bytes_total = stats.get("bytesTotal").and_then(Value::as_i64).unwrap_or(0);
        let bytes_downloaded = stats
            .get("bytesDownloaded")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        specimens.push(json!({
            "datasetId": dataset_id,
            "label": label,
            "state": state,
            "filesTotal": files_total,
            "filesDone": files_done,
            "bytesTotal": bytes_total,
            "bytesDownloaded": bytes_downloaded,
            "counts": stats,
            "currentFiles": active_files_for_dataset(conn, &dataset_id)?,
            "error": dataset_error(conn, &dataset_id)?
        }));
    }
    Ok(specimens)
}

#[tauri::command]
fn download_status(state: State<'_, AppState>) -> CommandResult<DownloadStatus> {
    download_status_for_state(&state)
}

#[tauri::command]
fn storage_usage(state: State<'_, AppState>) -> CommandResult<StorageUsage> {
    fn walk(path: &Path, files: &mut usize, bytes: &mut u64) -> CommandResult<()> {
        if !path.exists() {
            return Ok(());
        }
        for entry in fs::read_dir(path).map_err(to_string)? {
            let entry = entry.map_err(to_string)?;
            let metadata = entry.metadata().map_err(to_string)?;
            if metadata.is_dir() {
                walk(&entry.path(), files, bytes)?;
            } else {
                *files += 1;
                *bytes += metadata.len();
            }
        }
        Ok(())
    }
    let mut files = 0usize;
    let mut bytes = 0u64;
    walk(&state.data_dir.join("assets"), &mut files, &mut bytes)?;
    Ok(StorageUsage { bytes, files })
}

#[tauri::command]
fn storage_delete(state: State<'_, AppState>, dataset_id: Option<String>) -> CommandResult<usize> {
    let conn = state.connect()?;
    let file_ids = if let Some(dataset_id) = dataset_id.as_deref() {
        let mut stmt = conn
            .prepare("SELECT file_id FROM catalog_files WHERE dataset_id = ?1")
            .map_err(to_string)?;
        let ids = stmt
            .query_map([dataset_id], |row| row.get::<_, i64>(0))
            .map_err(to_string)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(to_string)?;
        ids
    } else {
        let mut stmt = conn
            .prepare("SELECT file_id FROM catalog_files")
            .map_err(to_string)?;
        let ids = stmt
            .query_map([], |row| row.get::<_, i64>(0))
            .map_err(to_string)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(to_string)?;
        ids
    };

    let mut deleted = 0usize;
    for file_id in file_ids {
        let storage_path: Option<String> = conn
            .query_row(
                "SELECT storage_path FROM catalog_files WHERE file_id = ?1",
                [file_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(to_string)?
            .flatten();
        if let Some(storage_path) = storage_path {
            let path = state.data_dir.join(storage_path);
            if path.exists() {
                let _ = fs::remove_file(path);
            }
        }
        conn.execute(
            r#"
            UPDATE catalog_files
            SET download_state = 'missing', storage_hash = NULL, storage_path = NULL,
                bytes_downloaded = 0, error = NULL
            WHERE file_id = ?1
            "#,
            [file_id],
        )
        .map_err(to_string)?;
        conn.execute("DELETE FROM download_jobs WHERE file_id = ?1", [file_id])
            .map_err(to_string)?;
        deleted += 1;
    }
    refresh_model_states(&conn)?;
    Ok(deleted)
}

#[tauri::command]
fn asset_resolve(
    state: State<'_, AppState>,
    file_id: i64,
) -> CommandResult<Option<AssetResolution>> {
    asset_resolve_for_state(&state, file_id)
}

fn asset_resolve_for_state(
    state: &AppState,
    file_id: i64,
) -> CommandResult<Option<AssetResolution>> {
    let conn = state.connect()?;
    let storage_path: Option<String> = conn
        .query_row(
            "SELECT storage_path FROM catalog_files WHERE file_id = ?1 AND download_state IN ('downloaded', 'update_available')",
            [file_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(to_string)?
        .flatten();
    let Some(storage_path) = storage_path else {
        return Ok(None);
    };
    let path = state.data_dir.join(storage_path);
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(AssetResolution {
        file_id,
        path: path.to_string_lossy().to_string(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_test_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        std::env::temp_dir().join(format!("cor-iphes-{label}-{nanos}"))
    }

    fn test_state(label: &str) -> AppState {
        AppState::new(unique_test_dir(label)).expect("test app state")
    }

    fn sample_remote_dataset() -> RemoteDataset {
        let files = vec![
            RemoteFile {
                file_id: 1,
                label: "humerus.obj".to_string(),
                directory_label: "Húmero izquierdo".to_string(),
                path: "Húmero izquierdo/humerus.obj".to_string(),
                content_type: Some("application/octet-stream".to_string()),
                filesize: Some(1024),
                checksum_type: None,
                checksum_value: None,
                download_url: "https://example.test/humerus.obj".to_string(),
                remote_hash: "obj-hash".to_string(),
            },
            RemoteFile {
                file_id: 2,
                label: "humerus.mtl".to_string(),
                directory_label: "Húmero izquierdo".to_string(),
                path: "Húmero izquierdo/humerus.mtl".to_string(),
                content_type: Some("application/octet-stream".to_string()),
                filesize: Some(128),
                checksum_type: None,
                checksum_value: None,
                download_url: "https://example.test/humerus.mtl".to_string(),
                remote_hash: "mtl-hash".to_string(),
            },
            RemoteFile {
                file_id: 3,
                label: "albedo.jpg".to_string(),
                directory_label: "Húmero izquierdo".to_string(),
                path: "Húmero izquierdo/albedo.jpg".to_string(),
                content_type: Some("image/jpeg".to_string()),
                filesize: Some(256),
                checksum_type: None,
                checksum_value: None,
                download_url: "https://example.test/albedo.jpg".to_string(),
                remote_hash: "texture-hash".to_string(),
            },
            RemoteFile {
                file_id: 4,
                label: "photogrammetry.zip".to_string(),
                directory_label: "Húmero izquierdo/photos".to_string(),
                path: "Húmero izquierdo/photos/photogrammetry.zip".to_string(),
                content_type: Some("application/zip".to_string()),
                filesize: Some(4096),
                checksum_type: None,
                checksum_value: None,
                download_url: "https://example.test/photogrammetry.zip".to_string(),
                remote_hash: "zip-hash".to_string(),
            },
            RemoteFile {
                file_id: 5,
                label: "source-photo.jpg".to_string(),
                directory_label: "Húmero izquierdo/photos".to_string(),
                path: "Húmero izquierdo/photos/source-photo.jpg".to_string(),
                content_type: Some("image/jpeg".to_string()),
                filesize: Some(2048),
                checksum_type: None,
                checksum_value: None,
                download_url: "https://example.test/source-photo.jpg".to_string(),
                remote_hash: "photo-hash".to_string(),
            },
        ];
        let models = build_model_index(&files);
        RemoteDataset {
            persistent_id: "doi:10.34810/test".to_string(),
            identifier: "test".to_string(),
            title: "Specimen Z".to_string(),
            detail: json!({
                "data": {
                    "latestVersion": {
                        "metadataBlocks": {
                            "citation": {
                                "fields": [
                                    { "typeName": "title", "value": "Specimen Z" }
                                ]
                            }
                        }
                    }
                }
            }),
            specimen_summary: Some(json!({ "sex": "Female", "primaryId": "IPHES-Z" })),
            taxonomy_path: Some(json!({ "species": "Capra pyrenaica" })),
            files,
            models,
            remote_hash: "dataset-hash".to_string(),
        }
    }

    #[test]
    fn dataverse_requests_identity_encoded_bodies() {
        let client = build_http_client().expect("http client");
        let request = dataverse_get(
            &client,
            "https://dataverse.csuc.cat/api/dataverses/cor-iphes/contents",
        )
        .header(ACCEPT, "application/json")
        .build()
        .expect("request");

        assert_eq!(request.headers().get(ACCEPT_ENCODING).unwrap(), "identity");
        assert_eq!(request.headers().get(USER_AGENT).unwrap(), HTTP_USER_AGENT);
    }

    #[test]
    fn percent_encode_handles_persistent_ids() {
        assert_eq!(
            percent_encode("doi:10.34810/data123"),
            "doi%3A10.34810%2Fdata123"
        );
    }

    #[test]
    fn response_snippet_is_compact_and_lossy_safe() {
        let snippet = response_snippet(b"  first\n\nsecond\tthird  ");
        assert_eq!(snippet, "first second third");
    }

    #[test]
    fn model_index_preserves_display_name_from_catalog_directory() {
        let files = vec![
            RemoteFile {
                file_id: 10,
                label: "mesh.obj".to_string(),
                directory_label: "Humerus esquerre/Model".to_string(),
                path: "Humerus esquerre/Model/mesh.obj".to_string(),
                content_type: None,
                filesize: None,
                checksum_type: None,
                checksum_value: None,
                download_url: "https://example.test/obj".to_string(),
                remote_hash: "obj".to_string(),
            },
            RemoteFile {
                file_id: 11,
                label: "mesh.mtl".to_string(),
                directory_label: "Humerus esquerre/Model".to_string(),
                path: "Humerus esquerre/Model/mesh.mtl".to_string(),
                content_type: None,
                filesize: None,
                checksum_type: None,
                checksum_value: None,
                download_url: "https://example.test/mtl".to_string(),
                remote_hash: "mtl".to_string(),
            },
        ];

        let models = build_model_index(&files);

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].display_name, "Humerus esquerre");
        assert_eq!(models[0].mtl_file_id, Some(11));
    }

    #[test]
    fn mtl_texture_parser_extracts_texture_paths_and_ignores_options() {
        let refs = parse_mtl_texture_references(
            r#"
            newmtl bone
            map_Kd -s 1 1 1 -o 0 0 0 textures/albedo.jpg
            bump -bm 0.2 ../normal.png
            map_Ks missing/specular.jpg
            map_Pr roughness.jpg
            map_AO ao.jpg
            map_TangentSpaceNormal tangent-normal.png
            "#,
        );

        assert_eq!(
            refs,
            vec![
                "../normal.png".to_string(),
                "ao.jpg".to_string(),
                "missing/specular.jpg".to_string(),
                "roughness.jpg".to_string(),
                "tangent-normal.png".to_string(),
                "textures/albedo.jpg".to_string(),
            ]
        );
    }

    #[test]
    fn mtl_texture_parser_preserves_quoted_and_unquoted_spaces() {
        let refs = parse_mtl_texture_references(
            r#"
            newmtl bone
            map_Kd "textures/albedo final.jpg"
            map_Normal -bm 0.2 ../normal maps/bone normal.png
            "#,
        );

        assert_eq!(
            refs,
            vec![
                "../normal maps/bone normal.png".to_string(),
                "textures/albedo final.jpg".to_string(),
            ]
        );
    }

    #[test]
    fn obj_material_parser_preserves_space_containing_library_names() {
        let refs = parse_obj_material_library_references(
            r#"
            mtllib "materials/bone material.mtl"
            mtllib fallback.mtl
            "#,
        );

        assert_eq!(
            refs,
            vec![
                "fallback.mtl".to_string(),
                "materials/bone material.mtl".to_string(),
            ]
        );
    }

    #[test]
    fn catalog_entry_preserves_material_library_directory() {
        let state = test_state("catalog-entry-mtl-dir");
        let conn = state.connect().expect("db connection");
        let files = vec![
            RemoteFile {
                file_id: 10,
                label: "mesh.obj".to_string(),
                directory_label: "Bone/Model".to_string(),
                path: "Bone/Model/mesh.obj".to_string(),
                content_type: None,
                filesize: None,
                checksum_type: None,
                checksum_value: None,
                download_url: "https://example.test/mesh.obj".to_string(),
                remote_hash: "obj".to_string(),
            },
            RemoteFile {
                file_id: 11,
                label: "mesh.mtl".to_string(),
                directory_label: "Bone/Model/materials".to_string(),
                path: "Bone/Model/materials/mesh.mtl".to_string(),
                content_type: None,
                filesize: None,
                checksum_type: None,
                checksum_value: None,
                download_url: "https://example.test/mesh.mtl".to_string(),
                remote_hash: "mtl".to_string(),
            },
            RemoteFile {
                file_id: 12,
                label: "albedo.jpg".to_string(),
                directory_label: "Bone/Model/textures".to_string(),
                path: "Bone/Model/textures/albedo.jpg".to_string(),
                content_type: Some("image/jpeg".to_string()),
                filesize: None,
                checksum_type: None,
                checksum_value: None,
                download_url: "https://example.test/albedo.jpg".to_string(),
                remote_hash: "texture".to_string(),
            },
        ];
        let dataset = RemoteDataset {
            persistent_id: "doi:10.34810/mtldir".to_string(),
            identifier: "mtldir".to_string(),
            title: "Material directory specimen".to_string(),
            detail: json!({ "data": { "latestVersion": {} } }),
            specimen_summary: None,
            taxonomy_path: None,
            models: build_model_index(&files),
            files,
            remote_hash: "dataset".to_string(),
        };

        upsert_dataset(&conn, &dataset, false).expect("upsert dataset");
        let entry = catalog_entry(&conn, &dataset.persistent_id)
            .expect("catalog entry")
            .expect("entry exists");

        assert_eq!(entry.models.len(), 1);
        assert_eq!(entry.models[0]["objEntry"]["directory"], "Bone/Model");
        assert_eq!(
            entry.models[0]["mtlEntry"]["directory"],
            "Bone/Model/materials"
        );

        if std::env::var_os("COR_IPHES_KEEP_LIVE_DOWNLOAD").is_none() {
            let _ = fs::remove_dir_all(&state.data_dir);
        }
    }

    #[test]
    fn seed_catalog_import_populates_empty_database() {
        let state = test_state("seed-catalog");
        state
            .import_seed_catalog_if_empty()
            .expect("seed catalog import");
        let conn = state.connect().expect("db connection");
        let listed = dataset_infos(&conn, true).expect("seed dataset list");

        assert!(!listed.is_empty());
        assert!(listed
            .iter()
            .any(|dataset| dataset.value == "doi:10.34810/data1785"));

        if std::env::var_os("COR_IPHES_KEEP_LIVE_DOWNLOAD").is_none() {
            let _ = fs::remove_dir_all(&state.data_dir);
        }
    }

    #[test]
    fn synchronized_catalog_lists_specimen_and_queues_required_model_assets_only() {
        let state = test_state("catalog-download-flow");
        let conn = state.connect().expect("db connection");
        let dataset = sample_remote_dataset();

        upsert_dataset(&conn, &dataset, false).expect("upsert dataset");

        let listed = dataset_infos(&conn, true).expect("dataset list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].label, "Specimen Z");
        assert_eq!(listed[0].value, "doi:10.34810/test");
        assert_eq!(listed[0].download_state, "missing");
        assert_eq!(
            listed[0].taxonomy_path.as_ref().unwrap()["species"],
            "Capra pyrenaica"
        );

        let entry = catalog_entry(&conn, "doi:10.34810/test")
            .expect("catalog entry")
            .expect("entry exists");
        assert_eq!(entry.models.len(), 1);
        assert_eq!(entry.models[0]["displayName"], "Húmero izquierdo");
        assert_eq!(entry.models[0]["downloadState"], "missing");

        let request = DownloadEnqueueRequest {
            all: None,
            dataset_ids: Some(vec!["doi:10.34810/test".to_string()]),
        };
        let file_ids = collect_request_file_ids(&conn, &request).expect("selected file ids");
        assert_eq!(file_ids.len(), 3);
        assert!(file_ids.contains(&1));
        assert!(file_ids.contains(&2));
        assert!(file_ids.contains(&3));
        assert!(!file_ids.contains(&4));
        assert!(!file_ids.contains(&5));

        for file_id in &file_ids {
            enqueue_file(&conn, *file_id, 0).expect("enqueue file");
        }
        refresh_model_states(&conn).expect("refresh model states");

        let queued_entry = catalog_entry(&conn, "doi:10.34810/test")
            .expect("queued catalog entry")
            .expect("entry exists");
        assert_eq!(queued_entry.models[0]["downloadState"], "queued");

        let status = download_status_for_state(&state).expect("download status");
        assert_eq!(status.queued, 3);
        assert_eq!(status.files.len(), 3);
        assert_eq!(status.global["filesTotal"], 3);
        assert_eq!(status.global["bytesTotal"], 1408);
        assert_eq!(status.specimens.len(), 1);
        assert_eq!(status.specimens[0]["datasetId"], "doi:10.34810/test");
        assert_eq!(status.specimens[0]["state"], "queued");
        assert_eq!(status.specimens[0]["filesTotal"], 3);

        if std::env::var_os("COR_IPHES_KEEP_LIVE_DOWNLOAD").is_none() {
            let _ = fs::remove_dir_all(&state.data_dir);
        }
    }

    #[test]
    fn catalog_list_hides_incomplete_specimens_unless_requested() {
        let state = test_state("catalog-list-complete-only");
        let conn = state.connect().expect("db connection");
        let dataset = sample_remote_dataset();

        upsert_dataset(&conn, &dataset, false).expect("upsert dataset");

        for hidden_state in ["missing", "queued", "partial", "paused", "error"] {
            conn.execute(
                "UPDATE catalog_files SET download_state = ?1 WHERE dataset_id = ?2",
                params![hidden_state, &dataset.persistent_id],
            )
            .expect("set hidden state");
            refresh_model_states(&conn).expect("refresh model states");

            let default_list = dataset_infos(&conn, false).expect("default catalog list");
            assert!(
                default_list.is_empty(),
                "state {hidden_state} must be hidden from the main viewer"
            );

            let management_list = dataset_infos(&conn, true).expect("management catalog list");
            assert_eq!(management_list.len(), 1);
            assert_eq!(management_list[0].download_state, hidden_state);
        }

        for visible_state in ["downloaded", "update_available"] {
            conn.execute(
                "UPDATE catalog_files SET download_state = ?1 WHERE dataset_id = ?2",
                params![visible_state, &dataset.persistent_id],
            )
            .expect("set visible state");
            refresh_model_states(&conn).expect("refresh model states");

            let default_list = dataset_infos(&conn, false).expect("default catalog list");
            assert_eq!(default_list.len(), 1);
            assert_eq!(default_list[0].download_state, visible_state);
        }

        if std::env::var_os("COR_IPHES_KEEP_LIVE_DOWNLOAD").is_none() {
            let _ = fs::remove_dir_all(&state.data_dir);
        }
    }

    #[test]
    fn catalog_list_shows_specimen_when_required_model_assets_are_downloaded() {
        let state = test_state("catalog-list-required-assets");
        let conn = state.connect().expect("db connection");
        let dataset = sample_remote_dataset();

        upsert_dataset(&conn, &dataset, false).expect("upsert dataset");
        conn.execute(
            "UPDATE catalog_files SET download_state = 'downloaded', storage_path = 'assets/test' WHERE file_id IN (1, 2, 3)",
            [],
        )
        .expect("mark required assets downloaded");
        conn.execute(
            "UPDATE catalog_files SET download_state = 'missing', storage_path = NULL WHERE file_id IN (4, 5)",
            [],
        )
        .expect("mark optional files missing");
        refresh_model_states(&conn).expect("refresh model states");

        let default_list = dataset_infos(&conn, false).expect("default catalog list");
        let management_list = dataset_infos(&conn, true).expect("management catalog list");

        assert_eq!(default_list.len(), 1);
        assert_eq!(default_list[0].download_state, "downloaded");
        assert_eq!(default_list[0].download_stats["filesTotal"], 3);
        assert_eq!(management_list[0].download_stats["filesTotal"], 3);

        if std::env::var_os("COR_IPHES_KEEP_LIVE_DOWNLOAD").is_none() {
            let _ = fs::remove_dir_all(&state.data_dir);
        }
    }

    #[test]
    fn startup_recovers_interrupted_downloads_as_paused_partial_specimens() {
        let state = test_state("recover-interrupted-download");
        let data_dir = state.data_dir.clone();
        let conn = state.connect().expect("db connection");
        let dataset = sample_remote_dataset();

        upsert_dataset(&conn, &dataset, false).expect("upsert dataset");
        enqueue_file(&conn, 1, 0).expect("enqueue file");
        conn.execute(
            "UPDATE download_jobs SET status = 'downloading', bytes_downloaded = 512 WHERE file_id = 1",
            [],
        )
        .expect("mark job as interrupted");
        conn.execute(
            "UPDATE catalog_files SET download_state = 'downloading', bytes_downloaded = 512 WHERE file_id = 1",
            [],
        )
        .expect("mark file as interrupted");
        drop(conn);
        drop(state);

        let restarted = AppState::new(data_dir.clone()).expect("restart app state");
        let conn = restarted.connect().expect("db connection");
        let job_status: String = conn
            .query_row(
                "SELECT status FROM download_jobs WHERE file_id = 1",
                [],
                |row| row.get(0),
            )
            .expect("job status");
        let file_state: String = conn
            .query_row(
                "SELECT download_state FROM catalog_files WHERE file_id = 1",
                [],
                |row| row.get(0),
            )
            .expect("file state");
        let entry = catalog_entry(&conn, "doi:10.34810/test")
            .expect("catalog entry")
            .expect("entry exists");
        let management_list = dataset_infos(&conn, true).expect("management catalog list");
        let main_list = dataset_infos(&conn, false).expect("main catalog list");

        assert_eq!(job_status, "paused");
        assert_eq!(file_state, "partial");
        assert_eq!(entry.models[0]["downloadState"], "partial");
        assert_eq!(management_list[0].download_state, "partial");
        assert!(main_list.is_empty());

        if std::env::var_os("COR_IPHES_KEEP_LIVE_DOWNLOAD").is_none() {
            let _ = fs::remove_dir_all(&data_dir);
        }
    }

    async fn serve_test_files(files: HashMap<String, Vec<u8>>, request_count: usize) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind local http server");
        let addr = listener.local_addr().expect("local addr");
        tokio::spawn(async move {
            for _ in 0..request_count {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                let mut buffer = vec![0u8; 4096];
                let Ok(bytes_read) = socket.read(&mut buffer).await else {
                    continue;
                };
                let request = String::from_utf8_lossy(&buffer[..bytes_read]);
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("/");
                let body = files.get(path).cloned().unwrap_or_default();
                let status = if body.is_empty() {
                    "404 Not Found"
                } else {
                    "200 OK"
                };
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.write_all(&body).await;
            }
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn downloads_queued_model_files_and_marks_model_downloaded() {
        let obj_bytes = b"o humerus\nv 0 0 0\nv 1 0 0\n".to_vec();
        let mtl_bytes = b"newmtl bone\nKd 1 1 1\n".to_vec();
        let base_url = serve_test_files(
            HashMap::from([
                ("/humerus.obj".to_string(), obj_bytes.clone()),
                ("/humerus.mtl".to_string(), mtl_bytes.clone()),
            ]),
            2,
        )
        .await;
        let state = test_state("http-download-flow");
        let conn = state.connect().expect("db connection");
        let mut dataset = sample_remote_dataset();
        dataset
            .files
            .retain(|file| file.file_id == 1 || file.file_id == 2);
        dataset.files[0].filesize = Some(obj_bytes.len() as i64);
        dataset.files[0].download_url = format!("{base_url}/humerus.obj");
        dataset.files[1].filesize = Some(mtl_bytes.len() as i64);
        dataset.files[1].download_url = format!("{base_url}/humerus.mtl");
        dataset.models = build_model_index(&dataset.files);
        upsert_dataset(&conn, &dataset, false).expect("upsert dataset");
        enqueue_file(&conn, 1, 0).expect("enqueue obj");
        enqueue_file(&conn, 2, 0).expect("enqueue mtl");
        refresh_model_states(&conn).expect("refresh queued model");
        drop(conn);

        while let Some((job_id, file_id)) = next_download_job(&state).expect("next job") {
            let outcome = download_one(&state, job_id, file_id)
                .await
                .expect("download one");
            assert!(matches!(outcome, DownloadOutcome::Complete));
            mark_job_complete(&state, job_id, file_id).expect("mark complete");
        }

        let status = download_status_for_state(&state).expect("download status");
        assert_eq!(status.downloaded, 2);
        assert_eq!(status.queued, 0);
        assert_eq!(status.error, 0);

        let conn = state.connect().expect("db connection");
        let entry = catalog_entry(&conn, "doi:10.34810/test")
            .expect("catalog entry")
            .expect("entry exists");
        assert_eq!(entry.models[0]["downloadState"], "downloaded");

        let downloaded_files: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM catalog_files WHERE download_state = 'downloaded' AND storage_path IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .expect("downloaded files");
        assert_eq!(downloaded_files, 2);

        if std::env::var_os("COR_IPHES_KEEP_LIVE_DOWNLOAD").is_none() {
            let _ = fs::remove_dir_all(&state.data_dir);
        }
    }

    #[tokio::test]
    async fn downloaded_specimen_survives_restart_and_resolves_assets_offline() {
        let obj_bytes = b"o humerus\nv 0 0 0\nv 1 0 0\n".to_vec();
        let mtl_bytes = b"newmtl bone\nKd 1 1 1\nmap_Kd albedo.jpg\n".to_vec();
        let texture_bytes = b"fake jpeg bytes".to_vec();
        let base_url = serve_test_files(
            HashMap::from([
                ("/humerus.obj".to_string(), obj_bytes.clone()),
                ("/humerus.mtl".to_string(), mtl_bytes.clone()),
                ("/albedo.jpg".to_string(), texture_bytes.clone()),
            ]),
            3,
        )
        .await;
        let state = test_state("offline-relaunch-flow");
        let data_dir = state.data_dir.clone();
        let conn = state.connect().expect("db connection");
        let mut dataset = sample_remote_dataset();
        dataset.files[0].filesize = Some(obj_bytes.len() as i64);
        dataset.files[0].download_url = format!("{base_url}/humerus.obj");
        dataset.files[1].filesize = Some(mtl_bytes.len() as i64);
        dataset.files[1].download_url = format!("{base_url}/humerus.mtl");
        dataset.files[2].filesize = Some(texture_bytes.len() as i64);
        dataset.files[2].download_url = format!("{base_url}/albedo.jpg");
        dataset.models = build_model_index(&dataset.files);
        upsert_dataset(&conn, &dataset, false).expect("upsert dataset");
        let request = DownloadEnqueueRequest {
            all: None,
            dataset_ids: Some(vec![dataset.persistent_id.clone()]),
        };
        let initial_file_ids = collect_request_file_ids(&conn, &request).expect("selected files");
        assert_eq!(initial_file_ids.len(), 3);
        assert!(initial_file_ids.contains(&1));
        assert!(initial_file_ids.contains(&2));
        assert!(initial_file_ids.contains(&3));
        assert!(!initial_file_ids.contains(&4));
        assert!(!initial_file_ids.contains(&5));
        for file_id in &initial_file_ids {
            enqueue_file(&conn, *file_id, 0).expect("enqueue file");
        }
        refresh_model_states(&conn).expect("refresh queued model");
        drop(conn);

        while let Some((job_id, file_id)) = next_download_job(&state).expect("next job") {
            let outcome = download_one(&state, job_id, file_id)
                .await
                .expect("download one");
            assert!(matches!(outcome, DownloadOutcome::Complete));
            mark_job_complete(&state, job_id, file_id).expect("mark complete");
        }
        drop(state);

        let restarted = AppState::new(data_dir.clone()).expect("restart app state");
        let conn = restarted.connect().expect("db connection");
        let main_list = dataset_infos(&conn, false).expect("main catalog list");
        let management_list = dataset_infos(&conn, true).expect("management catalog list");
        let entry = catalog_entry(&conn, "doi:10.34810/test")
            .expect("catalog entry")
            .expect("entry exists");
        let required_ids = required_file_ids_for_dataset(&conn, "doi:10.34810/test")
            .expect("required ids after mtl discovery");
        drop(conn);

        assert_eq!(main_list.len(), 1);
        assert_eq!(main_list[0].download_state, "downloaded");
        assert_eq!(management_list[0].download_state, "downloaded");
        assert_eq!(entry.models[0]["downloadState"], "downloaded");
        assert_eq!(required_ids.len(), 3);
        assert!(required_ids.contains(&1));
        assert!(required_ids.contains(&2));
        assert!(required_ids.contains(&3));
        assert!(!required_ids.contains(&4));
        assert!(!required_ids.contains(&5));

        for file_id in [1, 2, 3] {
            let resolution = asset_resolve_for_state(&restarted, file_id)
                .expect("asset resolve")
                .expect("downloaded asset path");
            assert!(Path::new(&resolution.path).exists());
        }

        if std::env::var_os("COR_IPHES_KEEP_LIVE_DOWNLOAD").is_none() {
            let _ = fs::remove_dir_all(&data_dir);
        }
    }

    #[tokio::test]
    async fn obj_download_discovers_material_library_and_space_named_texture() {
        let obj_bytes =
            b"mtllib materials/bone material.mtl\no humerus\nv 0 0 0\nv 1 0 0\n".to_vec();
        let mtl_bytes = b"newmtl bone\nKd 1 1 1\nmap_Kd ../textures/albedo final.jpg\n".to_vec();
        let texture_bytes = b"fake jpeg bytes".to_vec();
        let base_url = serve_test_files(
            HashMap::from([
                ("/mesh.obj".to_string(), obj_bytes.clone()),
                ("/bone-material.mtl".to_string(), mtl_bytes.clone()),
                ("/albedo-final.jpg".to_string(), texture_bytes.clone()),
            ]),
            3,
        )
        .await;
        let state = test_state("obj-discovers-mtl-texture");
        let conn = state.connect().expect("db connection");
        let files = vec![
            RemoteFile {
                file_id: 10,
                label: "mesh.obj".to_string(),
                directory_label: "Bone/Model".to_string(),
                path: "Bone/Model/mesh.obj".to_string(),
                content_type: Some("application/octet-stream".to_string()),
                filesize: Some(obj_bytes.len() as i64),
                checksum_type: None,
                checksum_value: None,
                download_url: format!("{base_url}/mesh.obj"),
                remote_hash: "obj".to_string(),
            },
            RemoteFile {
                file_id: 11,
                label: "bone material.mtl".to_string(),
                directory_label: "Bone/Model/materials".to_string(),
                path: "Bone/Model/materials/bone material.mtl".to_string(),
                content_type: Some("application/octet-stream".to_string()),
                filesize: Some(mtl_bytes.len() as i64),
                checksum_type: None,
                checksum_value: None,
                download_url: format!("{base_url}/bone-material.mtl"),
                remote_hash: "mtl".to_string(),
            },
            RemoteFile {
                file_id: 12,
                label: "albedo final.jpg".to_string(),
                directory_label: "Bone/Model/textures".to_string(),
                path: "Bone/Model/textures/albedo final.jpg".to_string(),
                content_type: Some("image/jpeg".to_string()),
                filesize: Some(texture_bytes.len() as i64),
                checksum_type: None,
                checksum_value: None,
                download_url: format!("{base_url}/albedo-final.jpg"),
                remote_hash: "texture".to_string(),
            },
        ];
        let dataset = RemoteDataset {
            persistent_id: "doi:10.34810/discovery".to_string(),
            identifier: "discovery".to_string(),
            title: "Discovery specimen".to_string(),
            detail: json!({ "data": { "latestVersion": {} } }),
            specimen_summary: None,
            taxonomy_path: None,
            models: build_model_index(&files),
            files,
            remote_hash: "dataset".to_string(),
        };
        upsert_dataset(&conn, &dataset, false).expect("upsert dataset");
        assert_eq!(dataset.models[0].mtl_file_id, None);
        enqueue_file(&conn, 10, 0).expect("enqueue obj only");
        drop(conn);

        while let Some((job_id, file_id)) = next_download_job(&state).expect("next job") {
            let outcome = download_one(&state, job_id, file_id)
                .await
                .expect("download one");
            assert!(matches!(outcome, DownloadOutcome::Complete));
            mark_job_complete(&state, job_id, file_id).expect("mark complete");
        }

        let conn = state.connect().expect("db connection");
        let entry = catalog_entry(&conn, "doi:10.34810/discovery")
            .expect("catalog entry")
            .expect("entry exists");
        let required_ids =
            required_file_ids_for_dataset(&conn, "doi:10.34810/discovery").expect("required ids");

        assert_eq!(entry.models[0]["mtlEntry"]["file"]["dataFile"]["id"], 11);
        assert_eq!(entry.models[0]["downloadState"], "downloaded");
        assert_eq!(required_ids.len(), 3);
        assert!(required_ids.contains(&10));
        assert!(required_ids.contains(&11));
        assert!(required_ids.contains(&12));

        if std::env::var_os("COR_IPHES_KEEP_LIVE_DOWNLOAD").is_none() {
            let _ = fs::remove_dir_all(&state.data_dir);
        }
    }

    #[tokio::test]
    #[ignore = "performs live Dataverse HTTP catalog requests"]
    async fn live_dataverse_catalog_preview_returns_specimens_and_models() {
        let state = test_state("live-preview");
        let remote = fetch_remote_catalog(&state).await.expect("remote catalog");

        assert!(
            remote.len() >= 50,
            "expected the COR-IPHES catalog to contain many specimens"
        );
        assert!(remote
            .iter()
            .all(|dataset| !dataset.title.trim().is_empty()));
        assert!(remote.iter().all(|dataset| !dataset.models.is_empty()));
        assert!(remote
            .iter()
            .any(|dataset| dataset.persistent_id == "doi:10.34810/data1785"));

        let _ = fs::remove_dir_all(&state.data_dir);
    }

    #[tokio::test]
    #[ignore = "downloads a small live Dataverse model (~6.4 MB)"]
    async fn live_download_small_dataverse_model_completes_and_updates_catalog_state() {
        let state = test_state("live-download");
        if std::env::var_os("COR_IPHES_KEEP_LIVE_DOWNLOAD").is_some() {
            eprintln!("live download test data dir: {}", state.data_dir.display());
        }
        let conn = state.connect().expect("db connection");
        let files = vec![
            RemoteFile {
                file_id: 136547,
                label: "posterior_left_large_sesamoid_medial.obj".to_string(),
                directory_label: "posterior_left_large_sesamoid_medial".to_string(),
                path:
                    "posterior_left_large_sesamoid_medial/posterior_left_large_sesamoid_medial.obj"
                        .to_string(),
                content_type: Some("application/octet-stream".to_string()),
                filesize: Some(6_340_225),
                checksum_type: None,
                checksum_value: None,
                download_url: format!("{API_ROOT}/access/datafile/136547?format=original"),
                remote_hash: "live-obj".to_string(),
            },
            RemoteFile {
                file_id: 136937,
                label: "posterior_left_large_sesamoid_medial.mtl".to_string(),
                directory_label: "posterior_left_large_sesamoid_medial".to_string(),
                path:
                    "posterior_left_large_sesamoid_medial/posterior_left_large_sesamoid_medial.mtl"
                        .to_string(),
                content_type: Some("application/octet-stream".to_string()),
                filesize: Some(435),
                checksum_type: None,
                checksum_value: None,
                download_url: format!("{API_ROOT}/access/datafile/136937?format=original"),
                remote_hash: "live-mtl".to_string(),
            },
        ];
        let models = build_model_index(&files);
        let dataset = RemoteDataset {
            persistent_id: "doi:10.34810/data1785".to_string(),
            identifier: "data1785".to_string(),
            title: "Equus ferus przewalskii 374".to_string(),
            detail: json!({ "data": { "latestVersion": { "files": [] } } }),
            specimen_summary: None,
            taxonomy_path: None,
            files,
            models,
            remote_hash: "live-dataset".to_string(),
        };
        upsert_dataset(&conn, &dataset, false).expect("upsert live dataset");
        enqueue_file(&conn, 136547, 0).expect("enqueue obj");
        enqueue_file(&conn, 136937, 0).expect("enqueue mtl");
        drop(conn);

        while let Some((job_id, file_id)) = next_download_job(&state).expect("next job") {
            let outcome = download_one(&state, job_id, file_id)
                .await
                .expect("download one");
            assert!(matches!(outcome, DownloadOutcome::Complete));
            mark_job_complete(&state, job_id, file_id).expect("mark complete");
        }

        let status = download_status_for_state(&state).expect("download status");
        assert_eq!(status.downloaded, 2);
        assert_eq!(status.queued, 0);
        assert_eq!(status.error, 0);

        let conn = state.connect().expect("db connection");
        let entry = catalog_entry(&conn, "doi:10.34810/data1785")
            .expect("catalog entry")
            .expect("entry exists");
        assert_eq!(entry.models[0]["downloadState"], "downloaded");

        let downloaded_bytes: i64 = conn
            .query_row(
                "SELECT SUM(bytes_downloaded) FROM catalog_files WHERE dataset_id = ?1",
                ["doi:10.34810/data1785"],
                |row| row.get(0),
            )
            .expect("downloaded bytes");
        assert!(downloaded_bytes >= 6_340_660);

        if std::env::var_os("COR_IPHES_KEEP_LIVE_DOWNLOAD").is_none() {
            let _ = fs::remove_dir_all(&state.data_dir);
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_local_data_dir()
                .map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            let state = AppState::new(data_dir)
                .map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            asset_resolve,
            catalog_entry_command,
            catalog_list,
            download_cancel,
            download_enqueue,
            download_pause,
            download_resume,
            download_status,
            network_status,
            storage_delete,
            storage_usage,
            sync_apply,
            sync_preview
        ])
        .run(tauri::generate_context!())
        .expect("error while running COR-IPHES Esqueletos Off-linea");
}
