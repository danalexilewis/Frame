#!/usr/bin/env tsx
/**
 * Resolve a Frame file reference into an absolute path.
 * Use as a CLI to translate `<source> <path>` into a real file location.
 *
 * Usage (CLI): tsx scripts/frame-resolve.ts <projectRoot> <source> <path>
 */
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { fileURLToPath } from "url";
import { FrameLoader, FileRef } from "./frame-load.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class FrameResolver {
  private projectRoot: string;
  private loader: FrameLoader;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
    this.loader = new FrameLoader(projectRoot);
  }

  resolve(ref: FileRef): string {
    if (ref.source === "outputs") {
      return path.join(this.projectRoot, ref.path);
    }
    const sourcesConfig = this.loader.getSourcesConfig();
    const source = sourcesConfig.sources.find((s) => s.name === ref.source);

    if (!source) {
      throw new Error(`Unknown source: ${ref.source}`);
    }

    const sourcePath =
      source.path.startsWith("./") || source.path.startsWith("../")
        ? path.resolve(this.projectRoot, source.path)
        : path.resolve(source.path);

    if (!fs.existsSync(sourcePath)) {
      throw new Error(
        `Source path does not exist: ${ref.source} -> ${sourcePath}`,
      );
    }

    const resolvedPath = path.join(sourcePath, ref.path);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(
        `File not found: ${ref.source}:${ref.path} -> ${resolvedPath}`,
      );
    }

    return resolvedPath;
  }

  read(ref: FileRef): string {
    const filePath = this.resolve(ref);
    return fs.readFileSync(filePath, "utf-8");
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const projectRoot = process.argv[2] || process.cwd();
  const source = process.argv[3];
  const filePath = process.argv[4];

  if (!source || !filePath) {
    console.error("Usage: frame-resolve <projectRoot> <source> <path>");
    process.exit(1);
  }

  const resolver = new FrameResolver(projectRoot);
  const ref: FileRef = { source, path: filePath };

  try {
    const resolved = resolver.resolve(ref);
    console.log(resolved);
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}
