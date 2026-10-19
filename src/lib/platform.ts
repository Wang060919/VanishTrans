/** Explicit shell mode supplied by tauri.linux.conf.json, never inferred from UA. */
export function isLinuxCore(): boolean {
  return new URLSearchParams(window.location.search).has("linux-core");
}
