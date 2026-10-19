//! Opt-in desktop portals. No global input hooks or synthetic keystrokes.
mod screenshot;
mod shortcuts;

pub use screenshot::recognize;
pub use shortcuts::{configure, ShortcutState};

use crate::error::CommandError;

fn portal_error(error: ashpd::Error) -> CommandError {
    if matches!(
        error,
        ashpd::Error::Response(ashpd::desktop::ResponseError::Cancelled)
    ) {
        CommandError::cancelled()
    } else {
        CommandError::io(format!(
            "桌面 Portal 请求失败；请检查 xdg-desktop-portal 和 KDE 后端是否运行：{error}"
        ))
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn user_cancellation_has_stable_code() {
        let error = super::portal_error(ashpd::Error::Response(
            ashpd::desktop::ResponseError::Cancelled,
        ));
        assert_eq!(error.code, "CANCELLED");
    }
}
