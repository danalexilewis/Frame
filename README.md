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
