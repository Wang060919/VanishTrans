//! Lossless recovery for JSON stores. A failed read/backup must never authorize a write.
use serde::de::DeserializeOwned;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) struct LoadSafety {
    pub(crate) warning: Option<String>,
    writable: bool,
}

impl LoadSafety {
    pub(crate) fn ensure_writable(&self) -> Result<(), String> {
        if self.writable {
            Ok(())
        } else {
            Err(self
                .warning
                .clone()
                .unwrap_or_else(|| "持久化写入已禁用".into()))
        }
    }
}

pub(crate) struct LoadedJson<T> {
    pub(crate) value: Option<T>,
    pub(crate) safety: LoadSafety,
}

pub(crate) fn load_json<T: DeserializeOwned>(path: &Path, label: &str) -> LoadedJson<T> {
    load_json_with(path, label, fs::read(path), backup_bytes)
}

// Keep I/O failures injectable so tests never depend on platform permissions or credentials.
pub(crate) fn load_json_with<T: DeserializeOwned>(
    path: &Path,
    label: &str,
    bytes: io::Result<Vec<u8>>,
    backup: impl FnOnce(&Path, &[u8]) -> io::Result<PathBuf>,
) -> LoadedJson<T> {
    let mut safety = LoadSafety {
        warning: None,
        writable: true,
    };
    let value = match bytes {
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => {
            safety.writable = false;
            safety.warning = Some(format!(
                "{label}文件读取失败（{}）：{error}。本次使用临时默认数据并禁止保存；请修复文件访问后重启。",
                path.display()
            ));
            None
        }
        Ok(bytes) => match serde_json::from_slice(&bytes) {
            Ok(value) => Some(value),
            Err(_) => {
                // Do not include parser diagnostics: malformed values can contain secrets.
                safety.warning = Some(match backup(path, &bytes) {
                    Ok(backup) => format!(
                        "{label}文件损坏（{}），原始内容已备份至 {}，本次使用默认数据。",
                        path.display(),
                        backup.display()
                    ),
                    Err(error) => {
                        safety.writable = false;
                        format!(
                            "{label}文件损坏（{}）且备份失败：{error}。原文件未改动，本次使用临时默认数据并禁止保存；请修复后重启。",
                            path.display()
                        )
                    }
                });
                None
            }
        },
    };
    if let Some(warning) = &safety.warning {
        log::warn!("{warning}");
    }
    LoadedJson { value, safety }
}

fn backup_bytes(path: &Path, bytes: &[u8]) -> io::Result<PathBuf> {
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    loop {
        let mut name = path.as_os_str().to_os_string();
        name.push(format!(
            ".corrupt-{timestamp}-{}-{}.bak",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let backup = PathBuf::from(name);
        let mut file = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&backup)
        {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        };
        if let Err(error) = file.write_all(bytes).and_then(|()| file.sync_all()) {
            drop(file);
            // Only remove the incomplete file created by this invocation.
            if let Err(cleanup) = fs::remove_file(&backup) {
                return Err(io::Error::other(format!(
                    "写入备份失败: {error}；不完整备份 {} 清理失败: {cleanup}，请勿用于恢复",
                    backup.display()
                )));
            }
            return Err(error);
        }
        return Ok(backup);
    }
}

#[cfg(test)]
#[path = "persistence_tests.rs"]
mod tests;
