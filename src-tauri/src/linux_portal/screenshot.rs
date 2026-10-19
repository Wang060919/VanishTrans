use crate::error::CommandError;
use ashpd::desktop::screenshot::Screenshot;
use std::{
    io::{Cursor, Read},
    path::Path,
    process::Stdio,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};

static CAPTURING: AtomicBool = AtomicBool::new(false);
const MAX_IMAGE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_TEXT_BYTES: u64 = 1024 * 1024;
struct CaptureGuard;
impl Drop for CaptureGuard {
    fn drop(&mut self) {
        CAPTURING.store(false, Ordering::Release);
    }
}

fn validate_language(language: &str) -> Result<(), CommandError> {
    if language.is_empty()
        || language.len() > 80
        || !language
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'+')
    {
        return Err(CommandError::validation(
            "OCR 语言代码无效，例如 eng 或 chi_sim+eng。",
        ));
    }
    Ok(())
}

fn read_image(path: &Path) -> Result<Vec<u8>, CommandError> {
    let input = std::fs::File::open(path)?;
    let metadata = input.metadata()?;
    if !metadata.is_file() || metadata.len() > MAX_IMAGE_BYTES {
        return Err(CommandError::validation(
            "截图必须是小于 32 MiB 的本地图片。",
        ));
    }
    let mut bytes = Vec::new();
    input.take(MAX_IMAGE_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(CommandError::validation("截图超过 32 MiB。"));
    }
    validate_image_bytes(&bytes)?;
    Ok(bytes)
}

fn validate_image_bytes(bytes: &[u8]) -> Result<(), CommandError> {
    let reader = image::ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
    if !matches!(
        reader.format(),
        Some(image::ImageFormat::Png | image::ImageFormat::Jpeg)
    ) {
        return Err(CommandError::validation("截图必须为 PNG 或 JPEG 图片。"));
    }
    let (width, height) = reader
        .into_dimensions()
        .map_err(|_| CommandError::validation("无法读取截图图片尺寸。"))?;
    validate_dimensions(width, height)
}

fn validate_dimensions(width: u32, height: u32) -> Result<(), CommandError> {
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 24_000_000 {
        return Err(CommandError::validation(
            "截图超过 2400 万像素，请选择较小区域。",
        ));
    }
    Ok(())
}

fn local_path(uri: &reqwest::Url) -> Result<std::path::PathBuf, CommandError> {
    if uri.scheme() != "file" || uri.host_str().is_some_and(|host| host != "localhost") {
        return Err(CommandError::validation("截图 Portal 未返回本地文件 URI。"));
    }
    uri.to_file_path()
        .map_err(|_| CommandError::validation("截图路径无效。"))
}

pub async fn recognize(language: String) -> Result<String, CommandError> {
    validate_language(&language)?;
    if CAPTURING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(CommandError::validation("已有截图 OCR 正在进行。"));
    }
    let _guard = CaptureGuard;
    // A version probe checks availability without opening a capture prompt first.
    let probe = tokio::time::timeout(
        Duration::from_secs(5),
        Command::new("tesseract")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .status(),
    )
    .await
    .map_err(|_| CommandError::io("Tesseract 检查超时。"))?
    .map_err(|_| {
        CommandError::not_found("请通过发行版包管理器安装 tesseract 和所需语言包，再重试。")
    })?;
    if !probe.success() {
        return Err(CommandError::io("Tesseract 无法运行。"));
    }
    let request = tokio::time::timeout(
        Duration::from_secs(120),
        Screenshot::request().interactive(true).modal(true).send(),
    )
    .await
    .map_err(|_| CommandError::io("系统截图等待超时，请关闭系统截图弹窗后重试。"))?
    .map_err(super::portal_error)?;
    let response = request.response().map_err(super::portal_error)?;
    let path = local_path(response.uri())?;
    let input = tokio::task::spawn_blocking(move || read_image(&path))
        .await
        .map_err(|_| CommandError::internal("截图校验任务失败。"))??;
    // The portal owns its file: never delete it or write a second unencrypted copy.
    let mut child = Command::new("tesseract")
        .args(["stdin", "stdout", "-l", &language])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| CommandError::io("无法启动 Tesseract。"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| CommandError::internal("无法读取 OCR 输出。"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| CommandError::internal("无法写入 OCR 图片。"))?;
    let mut output = Vec::new();
    let result = tokio::time::timeout(Duration::from_secs(45), async {
        let write = async {
            stdin.write_all(&input).await?;
            stdin.shutdown().await
        };
        let read = async {
            stdout
                .take(MAX_TEXT_BYTES + 1)
                .read_to_end(&mut output)
                .await
        };
        tokio::try_join!(write, read)?;
        if output.len() as u64 > MAX_TEXT_BYTES {
            return Err(CommandError::validation("OCR 文本过长。"));
        }
        let status = child.wait().await?;
        if !status.success() {
            return Err(CommandError::io(
                "OCR 失败，请检查已安装的 Tesseract 语言包及图片。",
            ));
        }
        String::from_utf8(output).map_err(|_| CommandError::io("OCR 输出编码无效。"))
    })
    .await
    .map_err(|_| CommandError::io("OCR 超时，已停止识别。"))??;
    if result.trim().is_empty() {
        return Err(CommandError::validation("未识别到文本。"));
    }
    Ok(result.trim().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_local_file_uris_are_accepted() {
        for uri in [
            "https://example.com/screenshot.png",
            "file://remote/tmp/capture.png",
            "data:image/png;base64,AAAA",
        ] {
            assert!(local_path(&reqwest::Url::parse(uri).unwrap()).is_err());
        }
        assert_eq!(
            local_path(&reqwest::Url::parse("file:///tmp/screen%20shot.png").unwrap()).unwrap(),
            Path::new("/tmp/screen shot.png")
        );
    }
    #[test]
    fn rejects_invalid_and_excessive_images() {
        assert!(validate_image_bytes(b"not an image").is_err());
        assert!(validate_dimensions(0, 1).is_err());
        assert!(validate_dimensions(6000, 5000).is_err());
        assert!(validate_dimensions(u32::MAX, u32::MAX).is_err());
        assert!(validate_dimensions(4000, 3000).is_ok());
        let mut png = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(1, 1)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        assert!(validate_image_bytes(png.get_ref()).is_ok());
    }
    #[test]
    fn language_is_data_not_command_options() {
        for valid in ["eng", "chi_sim+eng", "chi_tra"] {
            assert!(validate_language(valid).is_ok());
        }
        for invalid in ["", "../eng", "-l eng", "eng;echo", "eng\n"] {
            assert!(validate_language(invalid).is_err());
        }
    }
}
