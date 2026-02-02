import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { FrameLoader } from "../scripts/frame-load.js";
import { FrameResolver } from "../scripts/frame-resolve.js";
import { RecordsMapBuilder } from "../scripts/frame-build-records-map.js";
import { FrameBundleBuilder } from "../scripts/frame-bundle.js";
import {
  ingestSourceDir,
  IngestConverter,
} from "../scripts/frame-ingest-to-markdown.js";

process.env.FRAME_MODE = "test";
const projectRoot = process.cwd();
const testSourceRoot = path.join(projectRoot, "sources", "test-source");
const testImportDir = path.join(testSourceRoot, "import");

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

  for (const outputPath of outputPaths) {
    if (fs.existsSync(outputPath)) {
      fs.rmSync(outputPath);
    }
  }

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
    const pendingPath = path.join(testImportDir, "ingest_pending.md");
    if (fs.existsSync(pendingPath)) {
      fs.rmSync(pendingPath);
    }
  }
});
