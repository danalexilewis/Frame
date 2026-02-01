# Frame v0.1 + Maps + MCP MVP — Implementation Plan (Detailed, Repo-Accurate)

## Completed (Based on Current Repo + Scripts)

### 1) Repo layout (current structure)
- `frame/` is source-controlled defaults only (profiles/skills/tools).
- Runtime outputs live at repo root:
  - `maps/` for generated records maps.
  - `runs/` for execution outputs.
- Data lives in configured sources (e.g. `sources/*/data/`), not in `frame/`.
- `frame/sources.yaml` is the entry point for loading sources.

### 2) Loader + entity model
- `scripts/frame-load.ts`:
  - Loads `frame/sources.yaml`.
  - Skips missing sources with a warning.
  - Enforces unique IDs across all sources (throws on duplicate).
  - Scans `skills/`, `tools/`, `profiles/`, `data/` for Markdown entities.
  - Extracts `date` from filename if missing in frontmatter.
  - Validates type vs folder (e.g., `skills/` only holds `type: skill`).

### 3) Resolver
- `scripts/frame-resolve.ts`:
  - Resolves FileRef to an absolute path using `frame/sources.yaml`.
  - Special-cases `ref.source === "outputs"` to repo-root outputs
    (used for `maps/` and `runs/`).

### 4) Map builder (docs-first, token saver)
- `scripts/frame-build-records-map.ts`:
  - Writes `maps/records_tree.txt` and `maps/records_map.md`
    at the repo root.
  - Adds `[SELECTED]` markers in the tree when provided selection IDs.
  - Deterministic ordering: `doc_type` → date desc → filename asc.
  - Summary selection:
    `summary_3` → `summary_1` → fallback snippet (unless disabled).
  - Optional incremental cache: `maps/records_cache.json`.
  - Emits map refs using `source: "outputs"`.

### 5) Curator
- `scripts/frame-curate.ts`:
  - Scores entities by tags/triggers + quality/status + recency signals.
  - Selects: 1 profile, top N skills/tools/records (defaults 3/3/8).
  - Returns notes describing selections.

### 6) Context bundle
- `scripts/frame-bundle.ts`:
  - Ensures maps exist before selection output.
  - Builds `context_read_order`:
    profile → skills → tools → maps → records.
  - Includes `records_tree_preview` (with `[SELECTED]` markers).
  - Writes `context_bundle.json` if `--runDir` is provided.

### 7) MCP MVP server
- `scripts/frame-mcp-server.ts`:
  - `resources/list` returns all entities + map files in repo-root `maps/`.
  - `resources/read` supports:
    - entities: `frame://<source>/<type>/<id>`
    - maps: `frame://outputs/map/<filename>`
  - Tools exposed:
    - `frame_build_records_map`
    - `frame_context_build`
  - URL parsing now guarded with try/catch; malformed URI returns
    a client-friendly error containing the original value.

## Outstanding / Not Yet Implemented (From Handover)

### 8) Worktrunk run scaffolding
- No automated worktrunk hook present in repo for:
  - `runs/YYYY-MM-DD/<branch>/selection.json`
  - `runs/YYYY-MM-DD/<branch>/output.md`
- Needs a hook or CLI wrapper to create the run folder and stubs.

### 9) MCP prompts for skills (optional)
- Prompts are not exposed via MCP yet (`prompts/list`, `prompts/get`).

### 10) CLI documentation parity
- CLIs exist in scripts, but README does not document:
  - `frame-build-records-map`
  - `frame-curate`
  - `frame-bundle`

### 11) Acceptance criteria verification
- Execution flow is implemented, but not formally verified end-to-end:
  1. Worktrunk run scaffolding
  2. Map generation output presence in `maps/`
  3. Bundle contains maps before records in read order
  4. MCP resources + tools support executor flow

### 12) Repo Prompt pattern validation
- Pattern is implemented in code (maps + selected markers),
  but still needs explicit “docs-first” validation on a real run:
  confirm reasoning model uses maps/tree for selection,
  then executor reads full records in order.
