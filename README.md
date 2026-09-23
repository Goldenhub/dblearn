# dblearn

A zero-latency, browser-native playground that teaches database internals visually. Write SQL, tweak table sizes, and watch query plans, cost graphs, B-Tree traversals, buffer-pool behavior, and concurrency isolation in real time — then fix five "broken production database" challenges. Everything runs 100% in your browser: **no backend server, no live database**.

## Highlights

- **Learn** — a 60-lesson beginner track (5 units: foundations, storage, indexes, query execution, transactions) that ends each unit in a hands-on capstone. Tasks run in the browser, with worked math, before/after reads animations, and first-principles explanations.
- **Query Plan lab** — type SQL and watch DuckDB-Wasm build a live execution plan rendered as an interactive React Flow DAG: operator costs, cardinals, heat-mapped timing, and bottleneck warnings.
- **B-Tree Index** — insert, delete, and look up keys in a real B-Tree. Watch node splits, pointer hops, and a side-by-side `O(log N)` vs `O(N)` proof.
- **Isolation & locking** — simulate concurrent transactions under 2PL and four isolation levels; load Dirty Read, Non-Repeatable Read, Phantom Read, and Deadlock scenarios and watch lock queues, wait-for graphs, and anomalies.
- **Challenges** — five production incidents (missing index, N+1, dirty read, buffer thrash, deadlock) driven by a static cost/efficiency evaluator.
- **Offline-ready PWA** — installable with a custom install prompt, light/dark theme, no external assets or network calls.

## Tech stack

- [Next.js 16](https://nextjs.org) (App Router, Turbopack) + React 19 + TypeScript (strict)
- [Tailwind CSS v4](https://tailwindcss.com) — class-based dark mode via CSS variables (zinc remap)
- [DuckDB-Wasm `@duckdb/duckdb-wasm@1.32.0`](https://github.com/duckdb/duckdb-wasm) — query engine in a Web Worker
- [React Flow](https://reactflow.dev) (`@xyflow/react`) — query-plan DAGs
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) — bundled locally, offline
- `@dagrejs/dagre` — automatic top-to-bottom plan layout

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The dev server runs in the browser with hot reload; the DuckDB engine is downloaded/initialized client-side.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server (first copies DuckDB-wasm assets into `public/db`) |
| `npm run build` | Production build (74 static routes) |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint (must stay clean) |
| `npm run check:e2e` | Headless-Chromium smoke test. Requires a server on `:3000` and a Chromium binary — `npx playwright-core install chromium`, or set `PLAYWRIGHT_CHROMIUM=<path>` |
| `node --experimental-strip-types --experimental-loader ./tsloader.mjs learn-test.mjs` | 388-check curriculum/task test suite |
| `node --experimental-strip-types --experimental-loader ./tsloader.mjs challenge-test.mjs` | 15-check challenge evaluator test suite |

> Note: `tsloader.mjs` is needed because the plain Node type-stripping loader doesn't resolve extensionless TS imports.

## Routes

| Route | Page |
| --- | --- |
| `/` | Landing page |
| `/learn` | Curriculum home |
| `/learn/[lessonId]` | Lesson page (SSG over all 60 lessons) |
| `/plan` | Query Plan lab |
| `/btree` | B-Tree Index visualizer |
| `/isolation` | Concurrency & isolation playground |
| `/challenges` | Challenge hub |
| `/challenges/[challengeId]` | Challenge workspace (SSG) |

Routes are real, indexable URLs — lessons deep-link to their capstone challenges and back.

## Architecture

Everything runs client-side. The only "backend" work is static asset copying.

```
src/
├── app/            # Next.js App Router pages + layout (routes above, landing, PWA wiring)
├── components/
│   ├── plan/       # PlanLab: SQL editor + React Flow graph + inspector
│   ├── nodes/      # Custom React Flow operator nodes (scans, joins, aggregates)
│   ├── btree/      # B-Tree canvas, controls, playback transport
│   ├── concurrency/# Isolation timeline, lock monitor, wait-for graph
│   ├── challenge/  # Challenge workspace, reads animation
│   ├── learn/      # Lesson view, curriculum sidebar, task runners
│   └── layout/     # Header, theme provider, install prompt
└── lib/
    ├── duckdb/     # protocol.ts + db-worker.ts + client.ts (engine bridge)
    ├── parser/     # planMapper (EXPLAIN JSON -> nodes/edges/metrics), plan tips
    ├── engine/     # Pure-TS engines: btree, bufferPool, concurrency
    ├── lessons/    # 60-lesson curriculum + static SQL analyzer (queryAnalyzer)
    ├── challenges/ # 5-challenge catalog
    └── store/      # Persistent progress (localStorage)
```

### Query engine (`lib/duckdb`)

DuckDB-Wasm runs in a Web Worker, bridged by a request/response protocol (`init` + `explain` only). The lab uses `EXPLAIN (ANALYZE, FORMAT JSON)` and parses the single `explain_value` column into plan nodes/edges.

### The "engine" modules are pure TypeScript

B-Tree, buffer pool, and concurrency simulators are self-contained, `document`-independent logic in `src/lib/engine/` — no DuckDB involvement. Each records full state snapshots per step so the UI is a pure player: keyframe data in, animation out.

### Static (not live) challenge evaluation

Challenge grading is a closed-form cost model over the query text — it **never executes DuckDB** (duckdb-wasm 1.32 crashes the worker on the heavy seed tables). The Query Plan lab remains the live-EXPLAIN surface; challenges reason about reads/scan modes/correlates from the statement and table catalog, then drive the reads animation.

### PWA

- `public/manifest.webmanifest` + `public/icons/*` (generated by `scripts/gen-icons.mjs`)
- `public/sw.js` — versioned precache (`dblearn-v2`), cache-first for hashed static assets, network-first navigations with offline fallback. Bump `VERSION` when releasing.
- Custom install prompt in the header: native `beforeinstallprompt` where supported, iOS "Add to Home Screen" instructions otherwise.
- Fully offline after first visit; Monaco, DuckDB, React Flow — all local.

## Theming

Class-based dark mode. Tailwind's zinc scale is remapped via CSS variables so zinc utilities are self-themed (no `dark:` variants needed); `dark:` is reserved for accent shades. The token source of truth is `src/app/globals.css`.

## Development notes

### DuckDB-Wasm query-plan quirks (verified on 1.32.0)

Use **`EXPLAIN (ANALYZE, FORMAT JSON)`** — the unparenthesized form crashes the engine. `operator_timing` is already in ms; the JSON lands in a single column. `EXPLAIN (ANALYZE, FORMAT JSON)` cannot be exercised under Node (the Node build trips the same Emscripten bug) — verify SQL shape changes with `scripts/e2e.mjs` in a real browser.

### Scripts / asset sync

`scripts/copy-duckdb-assets.mjs` copies the DuckDB-Wasm bundle (`/db/*`) into `public/db` on every dev/build/start. Keep its file list in sync with the `@duckdb/duckdb-wasm` version.

### Port hygiene

An orphaned `next-server` on `:3000` serves stale chunk hashes that a fresh build no longer contains, producing phantom `HTTP 500 /_next/static/*` errors — kill it (`pkill -9 -f "next-server"`, verify `lsof -ti :3000` is empty) before restarting.

## License

Private project — no external license specified.