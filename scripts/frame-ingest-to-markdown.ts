#!/usr/bin/env tsx
/**
 * Ingest files into Markdown and add YAML frontmatter.
 *
 * Supported input types: .docx, .txt, .html, .htm, .pdf, .jpg, .jpeg, .png, .gif, .webp, .tiff, .bmp, .heic
 *
 * Usage:
 *   tsx scripts/frame-ingest-to-markdown.ts --input ./file.docx --outputDir ./sources/my-source/data
 *   tsx scripts/frame-ingest-to-markdown.ts --input ./file.txt --output ./sources/my-source/data/my_file.md
 *   tsx scripts/frame-ingest-to-markdown.ts --sourceDir ./sources/my-source/import --outputDir ./sources/my-source/data
 *   tsx scripts/frame-ingest-to-markdown.ts
 */
import * as fs from "fs";
import * as path from "path";
import mammoth from "mammoth";
import TurndownService from "turndown";
import matter from "gray-matter";
import {
  formatCliError,
  formatCliMessage,
  normalizeError,
} from "./cli-output.js";

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
  extensions: string[];
}

const DEFAULT_EXTENSIONS = [
  ".docx",
  ".txt",
  ".html",
  ".htm",
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".tiff",
  ".bmp",
  ".heic",
];

const BINARY_EXTENSIONS = new Set([
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".tiff",
  ".bmp",
  ".heic",
]);

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
    extensions: DEFAULT_EXTENSIONS,
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
    } else if (arg === "--extensions" && args[i + 1]) {
      options.extensions = args[i + 1]
        .split(",")
        .map((ext) => ext.trim().toLowerCase())
        .filter(Boolean)
        .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`));
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

export type IngestConverter = (
  inputPath: string,
  options: Options
) => Promise<ConversionResult>;

async function convertDocxToMarkdown(
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

function isZipFile(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, "r");
    const header = Buffer.alloc(4);
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
    fs.closeSync(fd);
    if (bytesRead < 4) {
      return false;
    }
    return (
      header[0] === 0x50 &&
      header[1] === 0x4b &&
      (header[2] === 0x03 || header[2] === 0x05 || header[2] === 0x07) &&
      (header[3] === 0x04 || header[3] === 0x06 || header[3] === 0x08)
    );
  } catch {
    return false;
  }
}

async function convertHtmlToMarkdown(
  inputPath: string,
  options: Options
): Promise<ConversionResult> {
  const html = fs.readFileSync(inputPath, "utf-8");
  const turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
  });
  let markdown = turndown.turndown(html);
  if (options.title) {
    markdown = `# ${options.title}\n\n${markdown}`;
  }
  return { markdown, messages: [] };
}

async function convertTxtToMarkdown(
  inputPath: string,
  options: Options
): Promise<ConversionResult> {
  const text = fs.readFileSync(inputPath, "utf-8");
  const markdown = options.title ? `# ${options.title}\n\n${text}` : text;
  return { markdown, messages: [] };
}

async function defaultConvert(
  inputPath: string,
  options: Options
): Promise<ConversionResult> {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === ".docx") {
    return convertDocxToMarkdown(inputPath, options);
  }
  if (ext === ".html" || ext === ".htm") {
    return convertHtmlToMarkdown(inputPath, options);
  }
  if (ext === ".txt") {
    return convertTxtToMarkdown(inputPath, options);
  }
  throw new Error(`Unsupported input type: ${ext}`);
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
const COMPACT_DATE_RE = /\b(20\d{2})(\d{2})(\d{2})\b/;
const YEAR_FIRST_DATE_RE = /\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/;
const YEAR_LAST_DATE_RE = /\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/;
const MONTH_NAME_RE =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i;
const MONTHS: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};
const SPEAKER_LINE_RE = /^[A-Z][A-Z0-9 _-]{1,30}:\s+/m;
const TABLE_LINE_RE = /^\s*\|.+\|\s*$/m;

function toId(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseDateFromText(text: string): string | undefined {
  type Candidate = { value: string; score: number; index: number };
  const candidates: Candidate[] = [];

  const pushCandidate = (
    year: string,
    month: string,
    day: string,
    score: number,
    index: number
  ) => {
    const monthNum = Number.parseInt(month, 10);
    const dayNum = Number.parseInt(day, 10);
    if (Number.isNaN(monthNum) || Number.isNaN(dayNum)) {
      return;
    }
    if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) {
      return;
    }
    const iso = `${year}-${String(monthNum).padStart(2, "0")}-${String(
      dayNum
    ).padStart(2, "0")}`;
    candidates.push({ value: iso, score, index });
  };

  const normalizedText = text.replace(/_/g, " ");

  const isoMatch = normalizedText.match(DATE_RE);
  if (isoMatch?.index !== undefined) {
    candidates.push({ value: isoMatch[1], score: 100, index: isoMatch.index });
  }

  const compactMatch = normalizedText.match(COMPACT_DATE_RE);
  if (compactMatch?.index !== undefined) {
    pushCandidate(
      compactMatch[1],
      compactMatch[2],
      compactMatch[3],
      95,
      compactMatch.index
    );
  }

  const yearFirstMatch = normalizedText.match(YEAR_FIRST_DATE_RE);
  if (yearFirstMatch?.index !== undefined) {
    pushCandidate(
      yearFirstMatch[1],
      yearFirstMatch[2],
      yearFirstMatch[3],
      92,
      yearFirstMatch.index
    );
  }

  const yearLastMatch = normalizedText.match(YEAR_LAST_DATE_RE);
  if (yearLastMatch?.index !== undefined) {
    const first = Number.parseInt(yearLastMatch[1], 10);
    const second = Number.parseInt(yearLastMatch[2], 10);
    if (first > 12 && second <= 12) {
      pushCandidate(
        yearLastMatch[3],
        yearLastMatch[2],
        yearLastMatch[1],
        90,
        yearLastMatch.index
      );
    } else if (second > 12 && first <= 12) {
      pushCandidate(
        yearLastMatch[3],
        yearLastMatch[1],
        yearLastMatch[2],
        90,
        yearLastMatch.index
      );
    } else if (first <= 12 && second <= 12) {
      pushCandidate(
        yearLastMatch[3],
        yearLastMatch[1],
        yearLastMatch[2],
        70,
        yearLastMatch.index
      );
    }
  }

  const monthMatch = normalizedText.match(MONTH_NAME_RE);
  if (monthMatch?.index !== undefined) {
    const monthName = monthMatch[1].toLowerCase();
    const month = MONTHS[monthName];
    if (month) {
      const pattern = new RegExp(
        `\\b(${monthMatch[1]})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\,?\\s+(20\\d{2})\\b`,
        "i"
      );
      const match = normalizedText.match(pattern);
      if (match?.index !== undefined) {
        pushCandidate(match[3], month, match[2], 94, match.index);
      }

      const altPattern = new RegExp(
        `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthMatch[1]})\\s+(20\\d{2})\\b`,
        "i"
      );
      const altMatch = normalizedText.match(altPattern);
      if (altMatch?.index !== undefined) {
        pushCandidate(altMatch[3], month, altMatch[1], 94, altMatch.index);
      }
    }
  }

  if (candidates.length === 0) {
    return undefined;
  }

  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates[0].value;
}

function inferDate(filename: string, content: string): string | undefined {
  const fromFilename = parseDateFromText(filename);
  if (fromFilename) {
    return fromFilename;
  }
  const firstHeading = content.match(/^#\s+(.+)$/m)?.[1];
  if (firstHeading) {
    const fromHeading = parseDateFromText(firstHeading);
    if (fromHeading) {
      return fromHeading;
    }
  }
  return parseDateFromText(content);
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
  options: Options,
  originalFilename?: string
): Record<string, any> {
  const filename = originalFilename
    ? path.basename(originalFilename, path.extname(originalFilename))
    : path.basename(outputPath, ".md");
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

function listSourceDirectories(projectRoot: string): string[] {
  const sourcesRoot = path.join(projectRoot, "sources");
  if (!fs.existsSync(sourcesRoot)) {
    throw new Error(`Sources directory not found: ${sourcesRoot}`);
  }
  return fs
    .readdirSync(sourcesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(sourcesRoot, entry.name));
}

function isTestMode(): boolean {
  return (
    process.env.FRAME_MODE === "test" ||
    process.env.NODE_ENV === "test" ||
    process.env.FRAME_TEST_MODE === "true"
  );
}

function walkInputFiles(
  rootDir: string,
  ignoreImport: boolean,
  extensions: string[]
): string[] {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (ignoreImport && isIgnoredPath(fullPath, rootDir)) {
        continue;
      }
      results.push(...walkInputFiles(fullPath, ignoreImport, extensions));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!extensions.includes(ext)) {
        continue;
      }
      if (ignoreImport && isIgnoredPath(fullPath, rootDir)) {
        continue;
      }
      results.push(fullPath);
    }
  }
  return results;
}

function isBinaryAsset(ext: string): boolean {
  return BINARY_EXTENSIONS.has(ext.toLowerCase());
}

function resolveOutputPath(inputPath: string, options: Options): string {
  if (options.output) {
    return path.resolve(options.output);
  }
  const outDir = path.resolve(options.outputDir || path.dirname(inputPath));
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const ext = path.extname(inputPath).toLowerCase();

  if (isBinaryAsset(ext)) {
    return path.join(outDir, baseName, "index.md");
  }
  return path.join(outDir, `${baseName}.md`);
}

export async function convertInput(
  inputPath: string,
  options: Options,
  converter: IngestConverter = defaultConvert
): Promise<string> {
  const outputPath = resolveOutputPath(inputPath, options);
  const ext = path.extname(inputPath).toLowerCase();
  const isBinary = isBinaryAsset(ext);

  if (ext === ".docx" && !isZipFile(inputPath)) {
    console.error(
      formatCliMessage(
        "Warning",
        `Skipping invalid .docx (not a zip): ${inputPath}`
      )
    );
    return outputPath;
  }

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  if (isBinary) {
    const assetFolder = outputDir;
    const originalFilename = path.basename(inputPath);
    const assetPath = path.join(assetFolder, originalFilename);

    fs.copyFileSync(inputPath, assetPath);

    const baseName = path.basename(inputPath, ext);
    const title = options.title || baseName.replace(/_/g, " ");
    const markdownContent = `# ${title}\n\nAsset: [${originalFilename}](${originalFilename})\n`;

    let outputContent = markdownContent.trim() + "\n";

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
        markdownContent,
        existing,
        options,
        inputPath
      );
      outputContent = matter.stringify(markdownContent, updated);
    }

    fs.writeFileSync(outputPath, outputContent, "utf-8");
    console.log(`Wrote: ${outputPath}`);
    console.log(`Copied asset: ${assetPath}`);
    return outputPath;
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
    const warnings = result.messages
      .map((message) => `${message.type}: ${message.message}`)
      .join("\n");
    console.error(formatCliMessage("Conversion warnings", warnings));
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
  converter: IngestConverter = defaultConvert
): Promise<{ pending: string[] }> {
  const resolvedSourceDir = path.resolve(sourceDir);
  if (!fs.existsSync(resolvedSourceDir)) {
    throw new Error(`Source directory not found: ${resolvedSourceDir}`);
  }

  const extensions = options.extensions || DEFAULT_EXTENSIONS;
  const inputFiles = walkInputFiles(
    resolvedSourceDir,
    options.ignoreImport,
    extensions
  );
  if (inputFiles.length === 0) {
    console.log("No supported files found.");
    writePendingList(resolvedSourceDir, [], options.trackingFile);
    return { pending: [] };
  }

  for (const filePath of inputFiles) {
    const outputPath = resolveOutputPath(filePath, options);
    if (fs.existsSync(outputPath)) {
      continue;
    }
    try {
      await convertInput(filePath, options, converter);
    } catch (error) {
      const message = `Ingest failed for ${filePath}\n${normalizeError(error)}`;
      console.error(formatCliMessage("Error", message));
    }
  }

  const pending: string[] = [];
  for (const filePath of inputFiles) {
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

export async function ingestAllSources(
  options: Options,
  converter: IngestConverter = defaultConvert
): Promise<void> {
  const projectRoot = process.cwd();
  const sourceRoots = listSourceDirectories(projectRoot);
  const testMode = isTestMode();
  const tasks: Array<Promise<{ pending: string[] }>> = [];

  for (const sourceRoot of sourceRoots) {
    const sourceName = path.basename(sourceRoot);
    if (!testMode && sourceName.startsWith("test-")) {
      continue;
    }
    const importDir = path.join(sourceRoot, "import");
    const dataDir = path.join(sourceRoot, "data");

    if (!fs.existsSync(importDir)) {
      continue;
    }

    tasks.push(
      ingestSourceDir(
        importDir,
        {
          ...options,
          sourceDir: importDir,
          outputDir: dataDir,
        },
        converter
      )
    );
  }

  if (tasks.length === 0) {
    console.log("No source folders with an import directory found.");
    return;
  }

  await Promise.all(tasks);
}

export async function ingestSingle(
  inputPath: string,
  options: Options,
  converter: IngestConverter = defaultConvert
): Promise<string> {
  const resolvedInputPath = path.resolve(inputPath);
  if (!fs.existsSync(resolvedInputPath)) {
    throw new Error(`Input file not found: ${resolvedInputPath}`);
  }
  const extensions = options.extensions || DEFAULT_EXTENSIONS;
  const ext = path.extname(resolvedInputPath).toLowerCase();
  if (!extensions.includes(ext)) {
    throw new Error(`Unsupported input type: ${ext}`);
  }
  return convertInput(resolvedInputPath, options, converter);
}

async function run(options: Options) {
  if (options.sourceDir) {
    await ingestSourceDir(options.sourceDir, options);
    return;
  }

  if (!options.input) {
    await ingestAllSources(options);
    return;
  }

  await ingestSingle(options.input, options);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  run(options).catch((error) => {
    console.error(formatCliError(error));
    process.exit(1);
  });
}
