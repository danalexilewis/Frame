# Frame
A tool for managing LLM Agents context window

## Default Starter Content

`/frame` is source controlled and contains only **default** profiles, skills, and tools. It should not contain `data/`, `maps/`, or `runs/`.

Runtime outputs are written to top-level folders:
- `maps/` for generated records maps
- `runs/` for execution outputs

Users extend Frame by adding sources under `/sources/*` and referencing them in `frame/sources.yaml`.

## Adding Frame Sources

Frame supports multiple sources for organizing your content. To add a new source (like a sub-repo for specific meetings or projects):

1. **Add the source to `frame/sources.yaml`**:
   ```yaml
   sources:
     - name: project
       path: ./sources/project
     - name: eddy-meetings
       path: ./sources/eddy-meetings
   ```

2. **Create the source directory structure**:
   ```
   sources/eddy-meetings/
     ├── skills/
     ├── tools/
     ├── profiles/
     └── data/          # Put your meeting transcripts/summaries here
   ```

3. **Add your content**: Place Markdown files with YAML frontmatter in the appropriate directories.

The loader will automatically:
- Scan all configured sources
- Skip missing source paths (with a warning)
- Enforce unique IDs across all sources
- Make everything available via the catalog

**Example**: For Eddy meetings, you might structure it like:
```
sources/eddy-meetings/data/
  ├── 2026-02-01_eddy_sync.md
  ├── 2026-02-02_eddy_planning.md
  └── ...
```

Each file should have frontmatter like:
```yaml
---
type: data
id: eddy_sync_2026_02_01
doc_type: transcript
date: 2026-02-01
tags: [eddy, sync, planning]
---
```

## Scripts

Common CLI entry points:
- `npm run load` → validate/load sources
- `npm run build-map` → generate `maps/records_tree.txt` + `maps/records_map.md`
- `npm run curate` → select profile/skills/tools/records
- `npm run bundle` → build `context_bundle.json`
- `npm run mcp` → run MCP server
- `npm run docx-to-md` → convert .docx to Markdown

### Add Metadata to Markdown Sources

Use the metadata helper to add or fill YAML frontmatter based on file content:

```
tsx scripts/frame-add-metadata.ts --sourceDir ./sources/my-source/data
```

Options:
- `--type data` (default)
- `--docType article`
- `--maxTags 5`
- `--idPrefix my_source`
- `--overwrite` (replace existing fields)
- `--write` (apply changes; default is dry-run)

### DOCX to Markdown Ingestion

Convert `.docx` files into Markdown for ingestion:

```
tsx scripts/frame-docx-to-markdown.ts --input ./file.docx --outputDir ./sources/my-source/data
```

Batch import a folder (recommended layout uses `import/` → `data/`):

```
tsx scripts/frame-docx-to-markdown.ts --sourceDir ./sources/my-source/import --outputDir ./sources/my-source/data
```

Behavior:
- Writes Markdown into the `data/` folder.
- Adds YAML frontmatter by default (type/id/doc_type/date/tags).
- Skips files that already have a matching `.md` output.
- Writes a pending list file (`ingest_pending.md`) into the import folder.

Options:
- `--output` (explicit output file)
- `--outputDir` (target directory)
- `--title` (prepend `# Title` to the output)
- `--type` (default: `data`)
- `--docType` (default: inferred)
- `--maxTags` (default: `5`)
- `--idPrefix` (prefix for `id`)
- `--overwrite` (replace existing frontmatter fields)
- `--noFrontmatter` (skip YAML frontmatter)
- `--no-ignore-import` (include `sources/**/import` paths)
- `--trackingFile` (default: `ingest_pending.md`)
