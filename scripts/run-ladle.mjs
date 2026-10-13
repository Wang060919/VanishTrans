import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { URL } from "node:url";

// SWC checks every cache ancestor's ACL on Windows. AppData/Local can grant
// replacement rights to other accounts, so use a cache under the user home.
// Keep explicit cache overrides and SWC's integrity/permission checks intact.
if (process.platform === "win32" && !process.env.SWC_NATIVE_BINDING_CACHE) {
  process.env.SWC_NATIVE_BINDING_CACHE = join(homedir(), ".vanishtrans-cache", "swc");
}

// Resolve the installed Ladle CLI without importing SWC before configuring it.
await import(new URL("../cli/cli.js", import.meta.resolve("@ladle/react")).href);
