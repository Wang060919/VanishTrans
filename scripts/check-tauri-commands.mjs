#!/usr/bin/env node
import { readFileSync } from "node:fs";

const registrationSource = readFileSync("src-tauri/src/lib.rs", "utf8");
const handlerStart = registrationSource.indexOf("generate_handler![");
const handlerEnd = registrationSource.indexOf("\n        ])", handlerStart);
if (handlerStart < 0 || handlerEnd < 0) {
  throw new Error("Could not locate the Tauri generate_handler command list");
}
const registered = [...registrationSource.slice(handlerStart, handlerEnd).matchAll(/commands::([A-Za-z0-9_]+)/g)].map(
  (match) => match[1],
);

const documented = new Map();
for (const path of ["AGENTS.md", "docs/architecture/AGENTS.md"]) {
  const source = readFileSync(path, "utf8");
  const startMarker = "<!-- BEGIN TAURI_COMMANDS -->";
  const endMarker = "<!-- END TAURI_COMMANDS -->";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error(`${path}: missing command-list markers`);
  }
  const names = [...source.slice(start + startMarker.length, end).matchAll(/`([A-Za-z][A-Za-z0-9_]*)`/g)].map(
    (match) => match[1],
  );
  documented.set(path, names);
}

function duplicates(names) {
  return [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
}

const registeredSet = new Set(registered);
let failed = false;
for (const [path, names] of documented) {
  const documentedSet = new Set(names);
  const missing = registered.filter((name) => !documentedSet.has(name));
  const extra = names.filter((name) => !registeredSet.has(name));
  const duplicateNames = duplicates(names);
  if (missing.length || extra.length || duplicateNames.length || names.length !== registered.length) {
    failed = true;
    console.error(`${path}: command list does not match generate_handler!`);
    if (missing.length) console.error(`  missing: ${missing.join(", ")}`);
    if (extra.length) console.error(`  extra: ${extra.join(", ")}`);
    if (duplicateNames.length) console.error(`  duplicates: ${duplicateNames.join(", ")}`);
    if (names.length !== registered.length) {
      console.error(`  documented ${names.length}, registered ${registered.length}`);
    }
  }
}

if (duplicates(registered).length) {
  failed = true;
  console.error(`generate_handler! contains duplicate commands: ${duplicates(registered).join(", ")}`);
}

if (failed) process.exit(1);
console.log(`Tauri command documentation matches ${registered.length} registered commands.`);
