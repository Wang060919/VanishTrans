use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
const MAX_MESSAGE_CHARS: usize = 8_192;

struct FileLogger {
    file: Mutex<Option<File>>,
}

static LOGGER: FileLogger = FileLogger {
    file: Mutex::new(None),
};

impl log::Log for FileLogger {
    fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
        metadata.level() <= log::max_level()
    }

    fn log(&self, record: &log::Record<'_>) {
        if !self.enabled(record.metadata()) {
            return;
        }

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let message: String = record
            .args()
            .to_string()
            .chars()
            .take(MAX_MESSAGE_CHARS)
            .collect::<String>()
            .replace(['\r', '\n'], "\\n");
        let line = format!(
            "{timestamp} [{}] [{}] {message}\n",
            record.level(),
            record.target()
        );

        if let Ok(mut guard) = self.file.lock() {
            if let Some(file) = guard.as_mut() {
                let _ = file.write_all(line.as_bytes());
                let _ = file.flush();
            }
        }

        #[cfg(debug_assertions)]
        eprint!("{line}");
    }

    fn flush(&self) {
        if let Ok(mut guard) = self.file.lock() {
            if let Some(file) = guard.as_mut() {
                let _ = file.flush();
            }
        }
    }
}

pub fn init() {
    if log::set_logger(&LOGGER).is_ok() {
        let level = if cfg!(debug_assertions) {
            log::LevelFilter::Debug
        } else {
            log::LevelFilter::Info
        };
        log::set_max_level(level);
    }
}

pub fn configure(config_dir: &Path) -> Result<(), String> {
    let log_dir = config_dir.join("logs");
    std::fs::create_dir_all(&log_dir).map_err(|error| format!("创建日志目录失败: {error}"))?;
    let path = log_dir.join("vanish-trans.log");
    if path.metadata().map(|metadata| metadata.len()).unwrap_or(0) >= MAX_LOG_BYTES {
        let rotated = log_dir.join("vanish-trans.log.1");
        let _ = std::fs::remove_file(&rotated);
        std::fs::rename(&path, &rotated).map_err(|error| format!("轮转日志文件失败: {error}"))?;
    }

    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("打开日志文件失败: {error}"))?;
    *LOGGER.file.lock().map_err(|_| "日志锁已损坏".to_string())? = Some(file);
    Ok(())
}
