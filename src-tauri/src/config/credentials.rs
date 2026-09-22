const CRED_TARGET: &str = "VanishTrans_APIKey";

#[cfg(target_os = "windows")]
pub(super) fn save_api_key_credential(key: &str) -> Result<(), String> {
    use windows::core::HSTRING;
    use windows::Win32::Security::Credentials::{
        CredDeleteW, CredWriteW, CREDENTIALW, CRED_FLAGS, CRED_PERSIST_LOCAL_MACHINE,
        CRED_TYPE_GENERIC,
    };

    if key.is_empty() {
        unsafe {
            let _ = CredDeleteW(&HSTRING::from(CRED_TARGET), CRED_TYPE_GENERIC, 0);
        }
        return Ok(());
    }

    let target = HSTRING::from(CRED_TARGET);
    let username = HSTRING::from("VanishTrans");
    let secret_bytes: &[u8] = key.as_bytes();
    let secret_len = secret_bytes.len() as u32;

    let cred = CREDENTIALW {
        Flags: CRED_FLAGS(0),
        Type: CRED_TYPE_GENERIC,
        TargetName: windows::core::PWSTR::from_raw(target.as_ptr() as *mut _),
        Comment: windows::core::PWSTR::null(),
        LastWritten: Default::default(),
        CredentialBlobSize: secret_len,
        CredentialBlob: secret_bytes.as_ptr() as *mut u8,
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        AttributeCount: 0,
        Attributes: std::ptr::null_mut(),
        TargetAlias: windows::core::PWSTR::null(),
        UserName: windows::core::PWSTR::from_raw(username.as_ptr() as *mut _),
    };

    unsafe {
        CredWriteW(&cred, 0).map_err(|e| format!("存储凭据失败: {}", e))?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub(super) fn load_api_key_credential() -> Option<String> {
    use windows::core::HSTRING;
    use windows::Win32::Security::Credentials::{
        CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC,
    };

    let mut pcred: *mut CREDENTIALW = std::ptr::null_mut();
    unsafe {
        if CredReadW(
            &HSTRING::from(CRED_TARGET),
            CRED_TYPE_GENERIC,
            0,
            &mut pcred,
        )
        .is_err()
        {
            return None;
        }
        if pcred.is_null() {
            return None;
        }
        let blob_size = (*pcred).CredentialBlobSize as usize;
        let blob_ptr = (*pcred).CredentialBlob;
        if blob_ptr.is_null() || blob_size == 0 {
            CredFree(pcred as *const _);
            return None;
        }
        let bytes = std::slice::from_raw_parts(blob_ptr, blob_size);
        let key = String::from_utf8_lossy(bytes).to_string();
        CredFree(pcred as *const _);
        if key.is_empty() {
            None
        } else {
            Some(key)
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub(super) fn save_api_key_credential(_key: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub(super) fn load_api_key_credential() -> Option<String> {
    None
}
