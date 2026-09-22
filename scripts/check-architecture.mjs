import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Validate the current map, never historical refactoring reports.
const document = readFileSync("docs/architecture/ARCHITECTURE.md", "utf8");
const paths = [...document.matchAll(/`((?:src|src-tauri|scripts)\/[^`]+)`/g)].map((match) => match[1]);
const errors = paths.filter((path) => !existsSync(path)).map((path) => `Missing documented path: ${path}`);

// Incremental budget: legacy oversized modules are documented debt, not silently exempted here.
const directories = ["src/features/ball", "src-tauri/src/config", "src-tauri/src/translate"];
const files = directories.flatMap((directory) => readdirSync(directory)
  .filter((name) => /\.(ts|tsx|rs)$/.test(name)).map((name) => join(directory, name)));
files.push("src/features/useBallWindow.ts", "src/features/QuickTranslateWindow.tsx",
  "src/hooks/useTranslation.ts", "src/hooks/useTranslationSession.ts", "src/hooks/useTextTranslation.ts",
  "src/hooks/useFileTranslation.ts", "src/hooks/useQuickTranslation.ts", "src-tauri/src/translate.rs");
for (const path of files) {
  const lines = readFileSync(path, "utf8").trimEnd().split(/\r?\n/).length;
  if (lines > 200) errors.push(`${path}: ${lines} lines exceeds the 200-line module budget`);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Architecture paths exist; ${files.length} refactored modules meet the line budget.`);
