#!/usr/bin/env tsx
/**
 * Load all Frame entities from configured sources.
 * Use as a CLI to validate the catalog and print a summary of loaded entities.
 *
 * Usage (CLI): tsx scripts/frame-load.ts [projectRoot]
 */
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import matter from "gray-matter";
import { fileURLToPath } from "url";
import {
  formatCliError,
  formatCliMessage,
  normalizeError,
} from "./cli-output.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface FileRef {
  source: string;
  path: string; // relative to source root
}

export interface EntityMetadata {
  type: "skill" | "tool" | "profile" | "data";
  id: string;
  tags?: string[];
  triggers?: string[];
  requires?: string[];
  status?: "draft" | "candidate" | "reviewed" | "stable";
  quality?: "low" | "medium" | "high" | "best";
  quality_note?: string;
  quality_as_of?: string;
  curated_by?: string;
  doc_type?: "transcript" | "journal" | "article" | "collateral" | "table";
  date?: string;
  summary_1?: string;
  summary_3?: string;
}

export interface Entity {
  metadata: EntityMetadata;
  ref: FileRef;
}

export interface SourcesConfig {
  sources: Array<{
    name: string;
    path: string;
    ignore?: boolean;
  }>;
}

export class FrameLoader {
  private projectRoot: string;
  private sourcesConfig: SourcesConfig;
  private catalog: Map<string, Entity> = new Map();

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
    this.sourcesConfig = this.loadSourcesConfig();
  }

  private isTestMode(): boolean {
    return (
      process.env.FRAME_MODE === "test" ||
      process.env.NODE_ENV === "test" ||
      process.env.FRAME_TEST_MODE === "true"
    );
  }

  private loadSourcesConfig(): SourcesConfig {
    const sourcesPath = path.join(this.projectRoot, "frame", "sources.yaml");
    if (!fs.existsSync(sourcesPath)) {
      throw new Error(`Sources config not found: ${sourcesPath}`);
    }
    const content = fs.readFileSync(sourcesPath, "utf-8");
    return yaml.load(content) as SourcesConfig;
  }

  private resolveSourcePath(sourcePath: string): string {
    if (path.isAbsolute(sourcePath)) {
      return sourcePath;
    }
    return path.resolve(this.projectRoot, sourcePath);
  }

  private loadEntitiesFromSource(
    sourceName: string,
    sourcePath: string
  ): Entity[] {
    const resolvedPath = this.resolveSourcePath(sourcePath);
    if (!fs.existsSync(resolvedPath)) {
      console.warn(
        `Source path does not exist, skipping: ${sourceName} -> ${resolvedPath}`
      );
      return [];
    }

    const entities: Entity[] = [];
    const entityTypes = ["skills", "tools", "profiles", "data"];

    for (const entityType of entityTypes) {
      const typeDir = path.join(resolvedPath, entityType);
      if (!fs.existsSync(typeDir)) {
        continue;
      }

      const files = fs
        .readdirSync(typeDir, { recursive: true })
        .filter((f) => typeof f === "string" && f.endsWith(".md"))
        .map((f) => path.join(typeDir, f as string));

      for (const filePath of files) {
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          const parsed = matter(content);
          const metadata = parsed.data as EntityMetadata;

          if (!metadata.type || !metadata.id) {
            console.warn(`Skipping ${filePath}: missing type or id`);
            continue;
          }

          // Validate type matches directory
          const typeFromDir =
            entityType === "data" ? "data" : entityType.slice(0, -1);
          if (metadata.type !== typeFromDir) {
            console.warn(
              `Skipping ${filePath}: type mismatch (${metadata.type} vs ${typeFromDir})`
            );
            continue;
          }

          // Extract date from filename if not in frontmatter
          if (metadata.type === "data" && !metadata.date) {
            const filename = path.basename(filePath, ".md");
            const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
            if (dateMatch) {
              metadata.date = dateMatch[1];
            }
          }

          const relativePath = path.relative(resolvedPath, filePath);
          const ref: FileRef = {
            source: sourceName,
            path: relativePath,
          };

          entities.push({ metadata, ref });
        } catch (error) {
          const message = `${filePath}\n${normalizeError(error)}`;
          console.error(formatCliMessage("Error loading file", message));
        }
      }
    }

    return entities;
  }

  load(): Map<string, Entity> {
    this.catalog.clear();

    for (const source of this.sourcesConfig.sources) {
      if (source.ignore && !this.isTestMode()) {
        continue;
      }
      const entities = this.loadEntitiesFromSource(source.name, source.path);

      for (const entity of entities) {
        const existing = this.catalog.get(entity.metadata.id);
        if (existing) {
          throw new Error(
            `Duplicate ID "${entity.metadata.id}" found:\n` +
              `  ${existing.ref.source}:${existing.ref.path}\n` +
              `  ${entity.ref.source}:${entity.ref.path}`
          );
        }
        this.catalog.set(entity.metadata.id, entity);
      }
    }

    return this.catalog;
  }

  getCatalog(): Map<string, Entity> {
    return this.catalog;
  }

  getSourcesConfig(): SourcesConfig {
    return this.sourcesConfig;
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const projectRoot = process.argv[2] || process.cwd();
  try {
    const loader = new FrameLoader(projectRoot);
    const catalog = loader.load();

    console.log(`Loaded ${catalog.size} entities from sources:`);
    for (const [id, entity] of catalog.entries()) {
      console.log(
        `  ${id} (${entity.metadata.type}) from ${entity.ref.source}:${entity.ref.path}`
      );
    }
  } catch (error) {
    console.error(formatCliError(error));
    process.exit(1);
  }
}
