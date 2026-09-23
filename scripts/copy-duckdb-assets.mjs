// Copies the DuckDB-Wasm engine assets out of node_modules into public/db so
// they are served as static files (offline-capable, no bundler URL tricks).
//
// Both `next dev` and `next build` are wired to run this first (see package.json).
// When upgrading @duckdb/duckdb-wasm, the file names below must match the new
// dist/ contents; the mvp bundle is used (works without COI/SharedArrayBuffer).

import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(
  readFileSync(join(root, "node_modules/@duckdb/duckdb-wasm/package.json"), "utf8"),
);
const dist = join(root, "node_modules/@duckdb/duckdb-wasm/dist");
const outDir = join(root, "public/db");

const files = [
  "duckdb-mvp.wasm",
  "duckdb-browser-mvp.worker.js",
];

mkdirSync(outDir, { recursive: true });
for (const file of files) {
  copyFileSync(join(dist, file), join(outDir, file));
  console.log(`copied ${file}`);
}
console.log(`duckdb-wasm ${pkg.version} assets -> public/db/`);