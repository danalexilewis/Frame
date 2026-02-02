#!/usr/bin/env tsx
/**
 * Add or fill YAML frontmatter for Markdown files in a source directory.
 * Heuristics infer type/doc_type/date/tags based on file content.
 *
 * Usage:
 *   tsx scripts/frame-add-metadata.ts --sourceDir ./sources/my-source/data
 *     [--type data] [--docType article] [--maxTags 5]
 *     [--idPrefix my_source] [--overwrite] [--write]
 *
 * Default is dry-run unless --write is provided.
 */
import * as fs from "fs";
import * as path from "path";
import matter from "gray-matter";
import { formatCliError, formatCliMessage } from "./cli-output.js";

interface Options {
  sourceDir: string;
  type: "skill" | "tool" | "profile" | "data";
  docType?: "transcript" | "journal" | "article" | "collateral" | "table";
  maxTags: number;
  idPrefix?: string;
  overwrite: boolean;
  write: boolean;
}

const DEFAULT_OPTIONS: Options = {
  sourceDir: "",
  type: "data",
  docType: undefined,
  maxTags: 5,
  idPrefix: undefined,
  overwrite: false,
  write: false,
};

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

function walkFiles(rootDir: string): string[] {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results;
}

function buildFrontmatter(
  filePath: string,
  content: string,
  existing: Record<string, any>,
  options: Options
): Record<string, any> {
  const filename = path.basename(filePath, ".md");
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

function run(options: Options) {
  const sourceDir = path.resolve(options.sourceDir);
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Source directory does not exist: ${sourceDir}`);
  }

  const files = walkFiles(sourceDir);
  if (files.length === 0) {
    console.log("No Markdown files found.");
    return;
  }

  console.log(`Found ${files.length} Markdown files.`);
  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = matter(raw);
    const updated = buildFrontmatter(
      filePath,
      parsed.content,
      parsed.data as Record<string, any>,
      options
    );
    const next = matter.stringify(parsed.content, updated);

    if (next !== raw) {
      console.log(`Updated: ${filePath}`);
      if (options.write) {
        fs.writeFileSync(filePath, next, "utf-8");
      }
    } else {
      console.log(`No changes: ${filePath}`);
    }
  }

  if (!options.write) {
    console.log("Dry run complete. Re-run with --write to apply changes.");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const options: Options = { ...DEFAULT_OPTIONS };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--sourceDir" && args[i + 1]) {
      options.sourceDir = args[i + 1];
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
    } else if (arg === "--write") {
      options.write = true;
    }
  }

  if (!options.sourceDir) {
    console.error(formatCliMessage("Error", "--sourceDir is required"));
    process.exit(1);
  }

  try {
    run(options);
  } catch (error) {
    console.error(formatCliError(error));
    process.exit(1);
  }
}
