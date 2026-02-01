#!/usr/bin/env tsx
/**
 * Generate records map artifacts for Frame data sources.
 * Use as a CLI to build `maps/records_tree.txt` and `maps/records_map.md`,
 * optionally incrementally with cached summaries.
 *
 * Usage (CLI): tsx scripts/frame-build-records-map.ts [--incremental]
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "node:child_process";
import { FrameLoader, Entity, FileRef } from "./frame-load.js";
import { FrameResolver } from "./frame-resolve.js";
import matter from "gray-matter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface MapBuilderOptions {
  projectRoot?: string;
  includeFallbackSummaries?: boolean;
  outputRefSource?: string;
  incremental?: boolean;
}

export class RecordsMapBuilder {
  private projectRoot: string;
  private loader: FrameLoader;
  private resolver: FrameResolver;
  private options: Required<MapBuilderOptions>;

  constructor(options: MapBuilderOptions = {}) {
    this.projectRoot = path.resolve(options.projectRoot || process.cwd());
    this.loader = new FrameLoader(this.projectRoot);
    this.resolver = new FrameResolver(this.projectRoot);
    this.options = {
      projectRoot: this.projectRoot,
      includeFallbackSummaries: options.includeFallbackSummaries !== false,
      outputRefSource: options.outputRefSource || "outputs",
      incremental: options.incremental === true,
    };
  }

  private getRefString(ref: FileRef, type: string, id: string): string {
    return `ref:${ref.source}:${type}:${id}`;
  }

  private extractSummary(entity: Entity, content: string): string {
    const { metadata } = entity;

    // Prefer summary_3 (3 bullets) or summary_1 (1 line)
    if (metadata.summary_3) {
      return metadata.summary_3;
    }
    if (metadata.summary_1) {
      return metadata.summary_1;
    }

    if (!this.options.includeFallbackSummaries) {
      return "(no summary)";
    }

    // Generate fallback: strip markdown headings, take first ~200-400 chars
    const body = matter(content).content;
    const text = body
      .replace(/^#+\s+/gm, "") // Remove headings
      .replace(/\n+/g, " ")
      .trim();

    const excerpt = text.slice(0, 300);
    return excerpt.length < text.length ? `${excerpt}...` : excerpt;
  }

  private sortRecords(entities: Entity[]): Entity[] {
    const docTypeOrder: Record<string, number> = {
      transcript: 0,
      journal: 1,
      article: 2,
      collateral: 3,
      table: 4,
    };

    return [...entities].sort((a, b) => {
      const aType = a.metadata.doc_type || "";
      const bType = b.metadata.doc_type || "";

      // Sort by doc_type
      const aTypeOrder = docTypeOrder[aType] ?? 999;
      const bTypeOrder = docTypeOrder[bType] ?? 999;
      if (aTypeOrder !== bTypeOrder) {
        return aTypeOrder - bTypeOrder;
      }

      // Then by date descending
      if (a.metadata.date && b.metadata.date) {
        const dateCompare = b.metadata.date.localeCompare(a.metadata.date);
        if (dateCompare !== 0) {
          return dateCompare;
        }
      } else if (a.metadata.date) {
        return -1;
      } else if (b.metadata.date) {
        return 1;
      }

      // Finally by filename ascending
      return a.ref.path.localeCompare(b.ref.path);
    });
  }

  private buildRecordsTree(
    entities: Entity[],
    selectedIds: Set<string>,
  ): string {
    const lines: string[] = [];
    lines.push("Records Tree");
    lines.push("=".repeat(50));
    lines.push("");

    // Group by doc_type
    const byType = new Map<string, Entity[]>();
    for (const entity of entities) {
      const type = entity.metadata.doc_type || "other";
      if (!byType.has(type)) {
        byType.set(type, []);
      }
      byType.get(type)!.push(entity);
    }

    // Sort types
    const typeOrder = [
      "transcript",
      "journal",
      "article",
      "collateral",
      "table",
      "other",
    ];
    const sortedTypes = Array.from(byType.keys()).sort((a, b) => {
      const aIdx = typeOrder.indexOf(a);
      const bIdx = typeOrder.indexOf(b);
      return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    });

    for (const docType of sortedTypes) {
      const typeEntities = byType.get(docType)!;
      const sorted = this.sortRecords(typeEntities);

      lines.push(`${docType.charAt(0).toUpperCase() + docType.slice(1)}s:`);

      for (const entity of sorted) {
        const isSelected = selectedIds.has(entity.metadata.id);
        const marker = isSelected ? "[SELECTED]" : "";
        const dateStr = entity.metadata.date
          ? ` (${entity.metadata.date})`
          : "";
        const title = entity.metadata.id.replace(/_/g, " ");
        lines.push(`  ${marker} ${title}${dateStr}`);
      }

      lines.push("");
    }

    return lines.join("\n");
  }

  private buildRecordsMap(
    entities: Entity[],
    selectedIds: Set<string>,
  ): string {
    const lines: string[] = [];
    lines.push("# Records Map");
    lines.push("");
    lines.push(
      "Index cards for all data records, sorted by doc_type, date (desc), filename.",
    );
    lines.push("");

    const sorted = this.sortRecords(entities);

    for (const entity of sorted) {
      const refStr = this.getRefString(
        entity.ref,
        entity.metadata.type,
        entity.metadata.id,
      );
      const content = this.resolver.read(entity.ref);
      const summary = this.extractSummary(entity, content);

      const dateStr = entity.metadata.date ? ` ${entity.metadata.date}` : "";
      const docTypeStr = entity.metadata.doc_type
        ? ` (${entity.metadata.doc_type})`
        : "";

      // Format summary: if it's 3 bullets, keep them; if it's one line, use it as-is
      const summaryLines = summary.split("\n").filter((l) => l.trim());
      const formattedSummary =
        summaryLines.length > 1
          ? summaryLines.map((l) => `  ${l.trim()}`).join("\n")
          : summary;

      lines.push(`- [${refStr}]${dateStr}${docTypeStr} — ${formattedSummary}`);
      lines.push("");
    }

    return lines.join("\n");
  }

  private getChangedPathsForSource(sourceName: string): Set<string> {
    const sourcesConfig = this.loader.getSourcesConfig();
    const source = sourcesConfig.sources.find((s) => s.name === sourceName);
    if (!source) {
      return new Set();
    }

    const sourcePath = path.isAbsolute(source.path)
      ? source.path
      : path.resolve(this.projectRoot, source.path);

    if (!fs.existsSync(path.join(sourcePath, ".git"))) {
      return new Set(["__ALL__"]);
    }

    const changed = new Set<string>();
    const collect = (args: string[]) => {
      try {
        const output = execFileSync("git", ["-C", sourcePath, ...args], {
          encoding: "utf-8",
        });
        output
          .split("\n")
          .map((line: string) => line.trim())
          .filter(Boolean)
          .forEach((file: string) => changed.add(file));
      } catch {
        // Ignore git errors for non-repo or missing refs
      }
    };

    collect(["diff", "--name-only"]);
    collect(["diff", "--name-only", "--cached"]);
    collect(["ls-files", "--others", "--exclude-standard"]);

    return changed;
  }

  private loadCache(cachePath: string): Record<string, { summary: string }> {
    if (!fs.existsSync(cachePath)) {
      return {};
    }
    try {
      const content = fs.readFileSync(cachePath, "utf-8");
      const parsed = JSON.parse(content);
      return parsed.entries || {};
    } catch {
      return {};
    }
  }

  private writeCache(
    cachePath: string,
    entries: Record<string, { summary: string }>,
  ) {
    fs.writeFileSync(cachePath, JSON.stringify({ entries }, null, 2), "utf-8");
  }

  build(selectedIds: Set<string> = new Set()): {
    maps: FileRef[];
    generated_at: string;
    notes: string;
  } {
    const catalog = this.loader.load();

    // Filter to data entities only
    const dataEntities = Array.from(catalog.values()).filter(
      (e) => e.metadata.type === "data",
    );

    // Maps output directory (top-level)
    const mapsDir = path.join(this.projectRoot, "maps");
    if (!fs.existsSync(mapsDir)) {
      fs.mkdirSync(mapsDir, { recursive: true });
    }

    const cachePath = path.join(mapsDir, "records_cache.json");
    const cacheEntries = this.options.incremental
      ? this.loadCache(cachePath)
      : {};

    const changedBySource = new Map<string, Set<string>>();

    const getIsChanged = (entity: Entity) => {
      if (!this.options.incremental) {
        return true;
      }
      if (!changedBySource.has(entity.ref.source)) {
        changedBySource.set(
          entity.ref.source,
          this.getChangedPathsForSource(entity.ref.source),
        );
      }
      const changed = changedBySource.get(entity.ref.source)!;
      return changed.has("__ALL__") || changed.has(entity.ref.path);
    };

    // Build maps
    const recordsTree = this.buildRecordsTree(dataEntities, selectedIds);

    const sorted = this.sortRecords(dataEntities);
    const mapLines: string[] = [];
    mapLines.push("# Records Map");
    mapLines.push("");
    mapLines.push(
      "Index cards for all data records, sorted by doc_type, date (desc), filename.",
    );
    mapLines.push("");

    const newCacheEntries: Record<string, { summary: string }> = {};

    for (const entity of sorted) {
      const refKey = `${entity.ref.source}:${entity.ref.path}`;
      let summary = cacheEntries[refKey]?.summary;
      if (!summary || getIsChanged(entity)) {
        const content = this.resolver.read(entity.ref);
        summary = this.extractSummary(entity, content);
      }
      newCacheEntries[refKey] = { summary };

      const refStr = this.getRefString(
        entity.ref,
        entity.metadata.type,
        entity.metadata.id,
      );
      const dateStr = entity.metadata.date ? ` ${entity.metadata.date}` : "";
      const docTypeStr = entity.metadata.doc_type
        ? ` (${entity.metadata.doc_type})`
        : "";
      const summaryLines = summary.split("\n").filter((l) => l.trim());
      const formattedSummary =
        summaryLines.length > 1
          ? summaryLines.map((l) => `  ${l.trim()}`).join("\n")
          : summary;

      mapLines.push(
        `- [${refStr}]${dateStr}${docTypeStr} — ${formattedSummary}`,
      );
      mapLines.push("");
    }

    const recordsMap = mapLines.join("\n");

    const treePath = path.join(mapsDir, "records_tree.txt");
    const mapPath = path.join(mapsDir, "records_map.md");

    fs.writeFileSync(treePath, recordsTree, "utf-8");
    fs.writeFileSync(mapPath, recordsMap, "utf-8");
    if (this.options.incremental) {
      this.writeCache(cachePath, newCacheEntries);
    }

    const maps: FileRef[] = [
      { source: this.options.outputRefSource, path: "maps/records_tree.txt" },
      { source: this.options.outputRefSource, path: "maps/records_map.md" },
    ];

    return {
      maps,
      generated_at: new Date().toISOString(),
      notes: `Generated ${dataEntities.length} record entries`,
    };
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let projectRoot = process.cwd();
  let includeFallbackSummaries = true;
  let outputRefSource = "outputs";
  let incremental = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--projectRoot" && args[i + 1]) {
      projectRoot = args[i + 1];
      i++;
    } else if (args[i] === "--outputRefSource" && args[i + 1]) {
      outputRefSource = args[i + 1];
      i++;
    } else if (args[i] === "--incremental") {
      incremental = true;
    } else if (args[i] === "--no-fallback-summaries") {
      includeFallbackSummaries = false;
    }
  }

  const builder = new RecordsMapBuilder({
    projectRoot,
    includeFallbackSummaries,
    outputRefSource,
    incremental,
  });

  try {
    const result = builder.build();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}
