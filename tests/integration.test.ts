import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import AdmZip from "adm-zip";

import { FrameLoader } from "../scripts/frame-load.js";
import { FrameResolver } from "../scripts/frame-resolve.js";
import {
  RecordsMapBuilder,
  cleanMapsFolder,
} from "../scripts/frame-build-records-map.js";
import { FrameBundleBuilder } from "../scripts/frame-bundle.js";
import {
  ingestSourceDir,
  ingestSingle,
  IngestConverter,
} from "../scripts/frame-ingest-to-markdown.js";
import {
  formatCliError,
  formatCliMessage,
  normalizeError,
} from "../scripts/cli-output.js";
import matter from "gray-matter";

process.env.FRAME_MODE = "test";
const projectRoot = process.cwd();
const testSourceRoot = path.join(projectRoot, "sources", "test-source");
const testImportDir = path.join(testSourceRoot, "import");

function createMinimalDocx(
  outputPath: string,
  content: string = "Test content"
): void {
  const zip = new AdmZip();

  zip.addFile(
    "[Content_Types].xml",
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`)
  );

  zip.addFile(
    "_rels/.rels",
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)
  );

  zip.addFile(
    "word/document.xml",
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p>
<w:r>
<w:t>${content}</w:t>
</w:r>
</w:p>
</w:body>
</w:document>`)
  );

  zip.addFile(
    "word/_rels/document.xml.rels",
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`)
  );

  zip.writeZip(outputPath);
}

test("loader and resolver work across configured sources", () => {
  const loader = new FrameLoader(projectRoot);
  const catalog = loader.load();

  assert.ok(catalog.has("default_operator"));
  assert.ok(catalog.has("test_transcript_2026_02_05"));

  const resolver = new FrameResolver(projectRoot);
  const testRef = catalog.get("test_transcript_2026_02_05")!.ref;
  const content = resolver.read(testRef);
  assert.ok(content.includes("Test Transcript"));
});

test("map builder generates records_tree and records_map", () => {
  const builder = new RecordsMapBuilder({
    projectRoot,
    includeFallbackSummaries: true,
    outputRefSource: "outputs",
  });

  const result = builder.build(new Set(["test_transcript_2026_02_05"]));
  assert.equal(result.maps.length, 2);

  const recordsTree = fs.readFileSync(
    path.join(projectRoot, "maps", "records_tree.txt"),
    "utf-8"
  );
  assert.ok(recordsTree.includes("[SELECTED]"));
  assert.ok(recordsTree.includes("(2026-02-05)"));

  const recordsMap = fs.readFileSync(
    path.join(projectRoot, "maps", "records_map.md"),
    "utf-8"
  );
  assert.ok(
    recordsMap.includes("ref:test-source:data:test_transcript_2026_02_05")
  );
  assert.ok(
    recordsMap.includes("ref:test-source:data:test_article_2026_02_07")
  );
});

test("bundle builder orders maps before full records", () => {
  const builder = new FrameBundleBuilder({
    projectRoot,
    request: "latest test transcript summary",
    outputRefSource: "outputs",
  });

  const bundle = builder.build();
  const mapIndex = bundle.context_read_order.findIndex(
    (ref) => ref.path === "maps/records_map.md"
  );
  const recordIndex = bundle.context_read_order.findIndex((ref) =>
    ref.path.includes("data/2026-02-05_test_transcript.md")
  );

  assert.ok(mapIndex >= 0);
  assert.ok(recordIndex >= 0);
  assert.ok(mapIndex < recordIndex);
  assert.ok(bundle.records_tree_preview.includes("[SELECTED]"));
});

test("docx ingestion uses test-source import fixtures", async () => {
  const dataDir = path.join(testSourceRoot, "data");
  const outputPaths = [path.join(dataDir, "b.md"), path.join(dataDir, "c.md")];
  const docxPaths = [
    path.join(testImportDir, "b.docx"),
    path.join(testImportDir, "c.docx"),
  ];

  for (const outputPath of outputPaths) {
    if (fs.existsSync(outputPath)) {
      fs.rmSync(outputPath);
    }
  }

  createMinimalDocx(docxPaths[0], "Document B content");
  createMinimalDocx(docxPaths[1], "Document C content");

  const converted: string[] = [];
  const converter: IngestConverter = async (inputPath) => {
    converted.push(inputPath);
    return { markdown: "# Converted\n\nBody", messages: [] };
  };

  try {
    await ingestSourceDir(
      testImportDir,
      {
        type: "data",
        docType: undefined,
        maxTags: 3,
        idPrefix: "docx",
        overwrite: false,
        noFrontmatter: false,
        ignoreImport: true,
        trackingFile: "ingest_pending.md",
        outputDir: dataDir,
        extensions: [".docx", ".txt", ".html", ".htm"],
      },
      converter
    );

    assert.equal(converted.length, 2);
    assert.deepEqual(converted.map((file) => path.basename(file)).sort(), [
      "b.docx",
      "c.docx",
    ]);
    assert.ok(fs.existsSync(path.join(dataDir, "b.md")));
    assert.ok(fs.existsSync(path.join(dataDir, "c.md")));

    const pendingPath = path.join(testImportDir, "ingest_pending.md");
    const pendingContents = fs.readFileSync(pendingPath, "utf-8");
    assert.ok(pendingContents.includes("# Ingestion Pending"));
    assert.ok(!pendingContents.includes("a.docx"));
    assert.ok(!pendingContents.includes("b.docx"));
    assert.ok(!pendingContents.includes("c.docx"));
  } finally {
    for (const outputPath of outputPaths) {
      if (fs.existsSync(outputPath)) {
        fs.rmSync(outputPath);
      }
    }
    for (const docxPath of docxPaths) {
      if (fs.existsSync(docxPath)) {
        fs.rmSync(docxPath);
      }
    }
    const pendingPath = path.join(testImportDir, "ingest_pending.md");
    if (fs.existsSync(pendingPath)) {
      fs.rmSync(pendingPath);
    }
  }
});

test("cli error formatting wraps messages in code blocks", () => {
  const message = formatCliMessage("Error", "missing --request");
  assert.ok(message.startsWith("Error:\n```"));
  assert.ok(message.includes("missing --request"));
  assert.ok(message.endsWith("```\n") || message.endsWith("```"));

  const err = new Error("boom");
  const formatted = formatCliError(err);
  assert.ok(formatted.startsWith("Error:\n```"));
  assert.ok(formatted.includes("boom"));

  const normalized = normalizeError(err);
  assert.ok(normalized.includes("boom"));
});

test("date inference prefers filename over content", async () => {
  const importPath = path.join(testImportDir, "2026-03-04_filename_date.txt");
  const outputPath = path.join(
    testSourceRoot,
    "data",
    "2026-03-04_filename_date.md"
  );

  fs.writeFileSync(
    importPath,
    "# Meeting notes\n\nThis was held on 2026-01-01.",
    "utf-8"
  );

  try {
    await ingestSingle(importPath, {
      type: "data",
      docType: undefined,
      maxTags: 3,
      idPrefix: "date",
      overwrite: false,
      noFrontmatter: false,
      ignoreImport: true,
      trackingFile: "ingest_pending.md",
      outputDir: path.join(testSourceRoot, "data"),
      extensions: [".docx", ".txt", ".html", ".htm"],
    });

    const parsed = matter(fs.readFileSync(outputPath, "utf-8"));
    assert.equal(parsed.data.date, "2026-03-04");
  } finally {
    if (fs.existsSync(importPath)) {
      fs.rmSync(importPath);
    }
    if (fs.existsSync(outputPath)) {
      fs.rmSync(outputPath);
    }
  }
});

test("date inference extracts from title or body", async () => {
  const importPath = path.join(testImportDir, "meeting_notes.txt");
  const outputPath = path.join(testSourceRoot, "data", "meeting_notes.md");

  fs.writeFileSync(
    importPath,
    "# Meeting February 2, 2026\n\nAgenda and notes follow.",
    "utf-8"
  );

  try {
    await ingestSingle(importPath, {
      type: "data",
      docType: undefined,
      maxTags: 3,
      idPrefix: "date",
      overwrite: false,
      noFrontmatter: false,
      ignoreImport: true,
      trackingFile: "ingest_pending.md",
      outputDir: path.join(testSourceRoot, "data"),
      extensions: [".docx", ".txt", ".html", ".htm"],
    });

    const parsed = matter(fs.readFileSync(outputPath, "utf-8"));
    assert.equal(parsed.data.date, "2026-02-02");
  } finally {
    if (fs.existsSync(importPath)) {
      fs.rmSync(importPath);
    }
    if (fs.existsSync(outputPath)) {
      fs.rmSync(outputPath);
    }
  }
});

test("cleanMapsFolder clears maps directory contents", () => {
  const mapsDir = path.join(projectRoot, "maps");
  if (!fs.existsSync(mapsDir)) {
    fs.mkdirSync(mapsDir, { recursive: true });
  }
  const tempFile = path.join(mapsDir, "temp.txt");
  const tempDir = path.join(mapsDir, "temp");
  fs.writeFileSync(tempFile, "temp", "utf-8");
  fs.mkdirSync(tempDir, { recursive: true });

  cleanMapsFolder(projectRoot);

  const remaining = fs.readdirSync(mapsDir);
  assert.equal(remaining.length, 0);
});

test("binary asset ingestion creates folder with index.md and copies asset as blob", async () => {
  const importPath = path.join(testImportDir, "test_document.pdf");
  const assetFolder = path.join(testSourceRoot, "data", "test_document");
  const indexPath = path.join(assetFolder, "index.md");
  const assetPath = path.join(assetFolder, "test_document.pdf");

  const fakePdfContent = Buffer.from("%PDF-1.4\nfake pdf content");
  fs.writeFileSync(importPath, fakePdfContent);

  try {
    await ingestSingle(importPath, {
      type: "data",
      docType: undefined,
      maxTags: 3,
      idPrefix: "test",
      overwrite: false,
      noFrontmatter: false,
      ignoreImport: true,
      trackingFile: "ingest_pending.md",
      outputDir: path.join(testSourceRoot, "data"),
      extensions: [".pdf", ".jpg", ".jpeg", ".png"],
    });

    assert.ok(fs.existsSync(assetFolder), "Asset folder should exist");
    assert.ok(fs.existsSync(indexPath), "index.md should exist");
    assert.ok(
      fs.existsSync(assetPath),
      "Binary asset should be copied as blob"
    );

    const indexContent = fs.readFileSync(indexPath, "utf-8");
    const parsed = matter(indexContent);
    assert.equal(parsed.data.type, "data");
    assert.ok(parsed.data.id);
    assert.ok(indexContent.includes("test_document.pdf"));

    const copiedAsset = fs.readFileSync(assetPath);
    assert.deepEqual(
      copiedAsset,
      fakePdfContent,
      "Asset should be stored as-is (blob)"
    );
  } finally {
    if (fs.existsSync(importPath)) {
      fs.rmSync(importPath);
    }
    if (fs.existsSync(assetFolder)) {
      fs.rmSync(assetFolder, { recursive: true });
    }
  }
});

test("binary asset date inference from filename", async () => {
  const importPath = path.join(testImportDir, "2026-05-15_meeting_notes.pdf");
  const assetFolder = path.join(
    testSourceRoot,
    "data",
    "2026-05-15_meeting_notes"
  );
  const indexPath = path.join(assetFolder, "index.md");
  const assetPath = path.join(assetFolder, "2026-05-15_meeting_notes.pdf");

  const fakePdfContent = Buffer.from("%PDF-1.4\nfake pdf content");
  fs.writeFileSync(importPath, fakePdfContent);

  try {
    await ingestSingle(importPath, {
      type: "data",
      docType: undefined,
      maxTags: 3,
      idPrefix: "test",
      overwrite: false,
      noFrontmatter: false,
      ignoreImport: true,
      trackingFile: "ingest_pending.md",
      outputDir: path.join(testSourceRoot, "data"),
      extensions: [".pdf"],
    });

    const indexContent = fs.readFileSync(indexPath, "utf-8");
    const parsed = matter(indexContent);
    assert.equal(parsed.data.date, "2026-05-15");
    assert.ok(fs.existsSync(assetPath), "Binary asset should exist as blob");
  } finally {
    if (fs.existsSync(importPath)) {
      fs.rmSync(importPath);
    }
    if (fs.existsSync(assetFolder)) {
      fs.rmSync(assetFolder, { recursive: true });
    }
  }
});
