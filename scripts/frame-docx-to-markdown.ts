#!/usr/bin/env tsx
/**
 * Convert a .docx file to Markdown and add YAML frontmatter.
 *
 * Usage:
 *   tsx scripts/frame-docx-to-markdown.ts --input ./file.docx --outputDir ./sources/my-source/data
 *   tsx scripts/frame-docx-to-markdown.ts --input ./file.docx --output ./sources/my-source/data/my_file.md
 *   tsx scripts/frame-docx-to-markdown.ts --sourceDir ./sources/my-source/import --outputDir ./sources/my-source/data
 */
import * as fs from "fs";
import * as path from "path";
import mammoth from "mammoth";
import TurndownService from "turndown";
import matter from "gray-matter";

export interface Options {
  input?: string;
  sourceDir?: string;
  outputDir?: string;
  output?: string;
  title?: string;
  type: "skill" | "tool" | "profile" | "data";
  docType?: "transcript" | "journal" | "article" | "collateral" | "table";
  maxTags: number;
  idPrefix?: string;
  overwrite: boolean;
  noFrontmatter: boolean;
  ignoreImport: boolean;
  trackingFile: string;
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    input: undefined,
    sourceDir: undefined,
    type: "data",
    docType: undefined,
    maxTags: 5,
    idPrefix: undefined,
    overwrite: false,
    noFrontmatter: false,
    ignoreImport: true,
    trackingFile: "ingest_pending.md",
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--input" && args[i + 1]) {
      options.input = args[i + 1];
      i++;
    } else if (arg === "--sourceDir" && args[i + 1]) {
      options.sourceDir = args[i + 1];
      i++;
    } else if (arg === "--outputDir" && args[i + 1]) {
      options.outputDir = args[i + 1];
      i++;
    } else if (arg === "--output" && args[i + 1]) {
      options.output = args[i + 1];
      i++;
    } else if (arg === "--title" && args[i + 1]) {
      options.title = args[i + 1];
      i++;
    } else if (arg === "--type" && args[i + 1]) {
      options.type = args[i + 1] as Options["type"];
      i++;
    } else if (arg === "--docType" && args[i + 1]) {
      options.docType = args[i + 1] as Options["docType"];
      i++;
    } else if (arg === "--maxTags" && args[i + 1]) {
      options.maxTags = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === "--idPrefix" && args[i + 1]) {
      options.idPrefix = args[i + 1];
      i++;
    } else if (arg === "--overwrite") {
      options.overwrite = true;
    } else if (arg === "--noFrontmatter") {
      options.noFrontmatter = true;
    } else if (arg === "--no-ignore-import") {
      options.ignoreImport = false;
    } else if (arg === "--trackingFile" && args[i + 1]) {
      options.trackingFile = args[i + 1];
      i++;
    }
  }
  return options;
}

export interface ConversionMessage {
  type: string;
  message: string;
}

export interface ConversionResult {
  markdown: string;
  messages: ConversionMessage[];
}

export type DocxConverter = (
  inputPath: string,
  options: Options
) => Promise<ConversionResult>;

async function defaultConvertDocx(
  inputPath: string,
  options: Options
): Promise<ConversionResult> {
  const result = await mammoth.convertToHtml({ path: inputPath });
  const turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
  });

  let markdown = turndown.turndown(result.value);
  if (options.title) {
    markdown = `# ${options.title}\n\n${markdown}`;
  }

  return { markdown, messages: result.messages };
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "they",
  "their",
  "have",
  "will",
  "were",
  "what",
  "when",
  "where",
  "which",
  "your",
  "you",
  "our",
  "about",
  "into",
  "over",
  "under",
  "after",
  "before",
  "between",
  "because",
  "these",
  "those",
  "there",
  "here",
  "also",
  "just",
  "than",
  "then",
  "them",
  "been",
  "more",
  "most",
  "some",
  "such",
  "very",
  "make",
  "made",
  "does",
  "did",
  "doing",
  "done",
  "can",
  "could",
  "should",
  "would",
  "may",
  "might",
  "must",
  "not",
  "no",
  "yes",
]);

const DATE_RE = /\b(20\d{2}-\d{2}-\d{2})\b/;
const SPEAKER_LINE_RE = /^[A-Z][A-Z0-9 _-]{1,30}:\s+/m;
const TABLE_LINE_RE = /^\s*\|.+\|\s*$/m;

function toId(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function inferDate(filename: string, content: string): string | undefined {
  const fromFilename = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  if (fromFilename) {
    return fromFilename[1];
  }
  const fromContent = content.match(DATE_RE);
  return fromContent ? fromContent[1] : undefined;
}

function inferDocType(
  content: string,
  fallback?: Options["docType"]
): Options["docType"] {
  const lower = content.toLowerCase();
  if (TABLE_LINE_RE.test(content)) {
    return "table";
  }
  if (lower.includes("transcript") || SPEAKER_LINE_RE.test(content)) {
    return "transcript";
  }
  if (lower.includes("journal") || lower.includes("diary")) {
    return "journal";
  }
  if (lower.includes("collateral") || lower.includes("one-pager")) {
    return "collateral";
  }
  if (lower.includes("report") || lower.includes("article")) {
    return "article";
  }
  return fallback || "article";
}

function inferTags(content: string, maxTags: number): string[] {
  const tokens = content
    .replace(/[^\w\s-]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));

  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxTags)
    .map(([token]) => token);
}

function buildFrontmatter(
  outputPath: string,
  content: string,
  existing: Record<string, any>,
  options: Options
): Record<string, any> {
  const filename = path.basename(outputPath, ".md");
  const inferredDate = inferDate(filename, content);
  const inferredDocType = inferDocType(content, options.docType);
  const inferredTags = inferTags(content, options.maxTags);

  const idBase = filename.replace(/^\d{4}-\d{2}-\d{2}[_-]?/, "");
  const id = toId(options.idPrefix ? `${options.idPrefix}_${idBase}` : idBase);

  const next = { ...existing };

  const setIfMissing = (key: string, value: any) => {
    if (options.overwrite || next[key] === undefined) {
      next[key] = value;
    }
  };

  setIfMissing("type", options.type);
  setIfMissing("id", id);
  if (options.type === "data") {
    setIfMissing("doc_type", inferredDocType);
    if (inferredDate) {
      setIfMissing("date", inferredDate);
    }
  }
  if (inferredTags.length > 0) {
    setIfMissing("tags", inferredTags);
  }

  return next;
}

function isIgnoredPath(filePath: string, rootDir: string): boolean {
  const relative = path.relative(rootDir, filePath);
  const parts = relative.split(path.sep);
  return parts.includes("import");
}

function walkDocxFiles(rootDir: string, ignoreImport: boolean): string[] {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (ignoreImport && isIgnoredPath(fullPath, rootDir)) {
        continue;
      }
      results.push(...walkDocxFiles(fullPath, ignoreImport));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".docx")) {
      if (ignoreImport && isIgnoredPath(fullPath, rootDir)) {
        continue;
      }
      results.push(fullPath);
    }
  }
  return results;
}

function resolveOutputPath(inputPath: string, options: Options): string {
  if (options.output) {
    return path.resolve(options.output);
  }
  const outDir = path.resolve(options.outputDir || path.dirname(inputPath));
  const baseName = path.basename(inputPath, ".docx");
  return path.join(outDir, `${baseName}.md`);
}

export async function convertDocx(
  inputPath: string,
  options: Options,
  converter: DocxConverter = defaultConvertDocx
): Promise<string> {
  const outputPath = resolveOutputPath(inputPath, options);

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const result = await converter(inputPath, options);
  let outputContent = result.markdown.trim() + "\n";

  if (!options.noFrontmatter) {
    const existing =
      fs.existsSync(outputPath) && fs.readFileSync(outputPath, "utf-8").trim()
        ? (matter(fs.readFileSync(outputPath, "utf-8")).data as Record<
            string,
            any
          >)
        : {};
    const updated = buildFrontmatter(
      outputPath,
      outputContent,
      existing,
      options
    );
    outputContent = matter.stringify(outputContent, updated);
  }

  fs.writeFileSync(outputPath, outputContent, "utf-8");

  if (result.messages.length > 0) {
    console.error("Conversion warnings:");
    for (const message of result.messages) {
      console.error(`- ${message.type}: ${message.message}`);
    }
  }

  console.log(`Wrote: ${outputPath}`);
  return outputPath;
}

function writePendingList(
  sourceDir: string,
  pending: string[],
  trackingFile: string
) {
  const trackingPath = path.join(sourceDir, trackingFile);
  const lines = [
    "# Ingestion Pending",
    "",
    `Updated: ${new Date().toISOString()}`,
    "",
    "Files not yet ingested:",
    "",
    ...pending.map((file) => `- ${file}`),
    "",
  ];
  fs.writeFileSync(trackingPath, lines.join("\n"), "utf-8");
}

export async function ingestSourceDir(
  sourceDir: string,
  options: Options,
  converter: DocxConverter = defaultConvertDocx
): Promise<{ pending: string[] }> {
  const resolvedSourceDir = path.resolve(sourceDir);
  if (!fs.existsSync(resolvedSourceDir)) {
    throw new Error(`Source directory not found: ${resolvedSourceDir}`);
  }

  const docxFiles = walkDocxFiles(resolvedSourceDir, options.ignoreImport);
  if (docxFiles.length === 0) {
    console.log("No .docx files found.");
    writePendingList(resolvedSourceDir, [], options.trackingFile);
    return { pending: [] };
  }

  for (const filePath of docxFiles) {
    const outputPath = resolveOutputPath(filePath, options);
    if (fs.existsSync(outputPath)) {
      continue;
    }
    await convertDocx(filePath, options, converter);
  }

  const pending: string[] = [];
  for (const filePath of docxFiles) {
    const outputPath = resolveOutputPath(filePath, options);
    if (!fs.existsSync(outputPath)) {
      pending.push(path.relative(resolvedSourceDir, filePath));
    }
  }

  writePendingList(resolvedSourceDir, pending, options.trackingFile);
  console.log(
    `Pending list updated: ${path.join(
      resolvedSourceDir,
      options.trackingFile
    )}`
  );
  return { pending };
}

export async function ingestSingle(
  inputPath: string,
  options: Options,
  converter: DocxConverter = defaultConvertDocx
): Promise<string> {
  const resolvedInputPath = path.resolve(inputPath);
  if (!fs.existsSync(resolvedInputPath)) {
    throw new Error(`Input file not found: ${resolvedInputPath}`);
  }
  if (!resolvedInputPath.toLowerCase().endsWith(".docx")) {
    throw new Error("Input file must be a .docx file");
  }
  return convertDocx(resolvedInputPath, options, converter);
}

async function run(options: Options) {
  if (!options.input && !options.sourceDir) {
    throw new Error("Either --input or --sourceDir is required");
  }

  if (options.sourceDir) {
    await ingestSourceDir(options.sourceDir, options);
    return;
  }

  if (!options.input) {
    throw new Error("--input is required when --sourceDir is not set");
  }

  await ingestSingle(options.input, options);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  run(options).catch((error) => {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
