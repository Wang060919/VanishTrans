#!/usr/bin/env node
// Bump the app version across all manifests in lockstep.
//
// Usage:
//   node scripts/bump-version.mjs 0.2.0
//
// Updates package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, and
// the `vanish-trans` entry in src-tauri/Cargo.lock.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const version = process.argv[2]?.trim().replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("用法: node scripts/bump-version.mjs <version>  (例如 0.2.0)");
  process.exit(1);
}

function replace(file, transform) {
  const path = resolve(root, file);
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (after === before) {
    throw new Error(`${file}: 未产生任何改动`);
  }
  writeFileSync(path, after);
  console.log(`✓ ${file}`);
}

// package.json
replace("package.json", (s) =>
  s.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`),
);

// src-tauri/tauri.conf.json
replace("src-tauri/tauri.conf.json", (s) =>
  s.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`),
);

// src-tauri/Cargo.toml — only the standalone [package] version line
replace("src-tauri/Cargo.toml", (s) =>
  s.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`),
);

// src-tauri/Cargo.lock — only the vanish-trans package entry
replace("src-tauri/Cargo.lock", (s) => {
  const nameMarker = 'name = "vanish-trans"';
  const nameIndex = s.indexOf(nameMarker);
  if (nameIndex === -1) {
    throw new Error("Cargo.lock: 找不到 vanish-trans 包条目");
  }
  const rest = s.slice(nameIndex);
  const match = rest.match(/version\s*=\s*"[^"]*"/);
  if (!match) {
    throw new Error("Cargo.lock: 找不到 vanish-trans 版本");
  }
  return s.slice(0, nameIndex) + rest.replace(match[0], `version = "${version}"`);
});

console.log(`已把版本统一为 ${version}`);
