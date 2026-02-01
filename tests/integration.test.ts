import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { FrameLoader } from "../scripts/frame-load.js";
import { FrameResolver } from "../scripts/frame-resolve.js";
import { RecordsMapBuilder } from "../scripts/frame-build-records-map.js";
import { FrameBundleBuilder } from "../scripts/frame-bundle.js";

function writeFile(filePath: string, contents: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf-8");
}

function createTempProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-test-"));

  writeFile(
    path.join(root, "frame", "sources.yaml"),
    [
      "sources:",
      "  - name: defaults",
      "    path: ./frame",
      "  - name: test-source",
      "    path: ./sources/test-source",
      "",
    ].join("\n"),
  );

  // Default starter profiles
  writeFile(
    path.join(root, "frame", "profiles", "default_operator.md"),
    [
      "---",
      "type: profile",
      "id: default_operator",
      "tags: [default, operator]",
      "status: stable",
      "quality: high",
      "---",
      "",
      "# Default Operator",
      "",
    ].join("\n"),
  );

  writeFile(
    path.join(root, "frame", "profiles", "research_analyst.md"),
    [
      "---",
      "type: profile",
      "id: research_analyst",
      "tags: [analysis, research]",
      "status: stable",
      "quality: high",
      "---",
      "",
      "# Research Analyst",
      "",
    ].join("\n"),
  );

  writeFile(
    path.join(root, "frame", "profiles", "brief_writer.md"),
    [
      "---",
      "type: profile",
      "id: brief_writer",
      "tags: [writing, brief]",
      "status: reviewed",
      "quality: medium",
      "---",
      "",
      "# Brief Writer",
      "",
    ].join("\n"),
  );

  // Default starter skills
  writeFile(
    path.join(root, "frame", "skills", "summarize_brief.md"),
    [
      "---",
      "type: skill",
      "id: summarize_brief",
      "tags: [summary, brief]",
      "triggers: [summary, brief, recap]",
      "status: reviewed",
      "quality: high",
      "---",
      "",
      "# Summarize Brief",
      "",
      "Summarize content into a concise brief.",
      "",
    ].join("\n"),
  );

  writeFile(
    path.join(root, "frame", "skills", "extract_actions.md"),
    [
      "---",
      "type: skill",
      "id: extract_actions",
      "tags: [actions, tasks]",
      "triggers: [action items, tasks, to-dos]",
      "status: reviewed",
      "quality: high",
      "---",
      "",
      "# Extract Actions",
      "",
      "Extract action items with owners and due dates.",
      "",
    ].join("\n"),
  );

  writeFile(
    path.join(root, "frame", "skills", "write_project_brief.md"),
    [
      "---",
      "type: skill",
      "id: write_project_brief",
      "tags: [project, brief]",
      "triggers: [project brief, overview, summary]",
      "status: reviewed",
      "quality: medium",
      "---",
      "",
      "# Write Project Brief",
      "",
      "Create a short project brief.",
      "",
    ].join("\n"),
  );

  // Default starter tools
  writeFile(
    path.join(root, "frame", "tools", "outline_builder.md"),
    [
      "---",
      "type: tool",
      "id: outline_builder",
      "tags: [outline, structure]",
      "status: reviewed",
      "quality: medium",
      "---",
      "",
      "# Outline Builder",
      "",
      "Generate a structured outline.",
      "",
    ].join("\n"),
  );

  writeFile(
    path.join(root, "frame", "tools", "decision_log.md"),
    [
      "---",
      "type: tool",
      "id: decision_log",
      "tags: [decisions, log]",
      "status: reviewed",
      "quality: medium",
      "---",
      "",
      "# Decision Log",
      "",
      "Capture key decisions with rationale.",
      "",
    ].join("\n"),
  );

  writeFile(
    path.join(root, "frame", "tools", "risk_scan.md"),
    [
      "---",
      "type: tool",
      "id: risk_scan",
      "tags: [risk, assessment]",
      "status: candidate",
      "quality: medium",
      "---",
      "",
      "# Risk Scan",
      "",
      "Identify potential risks and mitigations.",
      "",
    ].join("\n"),
  );

  // Test-source entities
  writeFile(
    path.join(root, "sources", "test-source", "profiles", "test_profile.md"),
    [
      "---",
      "type: profile",
      "id: test_profile",
      "tags: [test, example]",
      "status: stable",
      "quality: high",
      "---",
      "",
      "# Test Profile",
      "",
      "Example profile for integration tests.",
      "",
    ].join("\n"),
  );

  writeFile(
    path.join(root, "sources", "test-source", "skills", "test_skill.md"),
    [
      "---",
      "type: skill",
      "id: test_skill",
      "tags: [test, example]",
      "triggers: [test, sample]",
      "status: reviewed",
      "quality: high",
      "requires: [test_tool]",
      "---",
      "",
      "# Test Skill",
      "",
      "Example skill for trigger matching tests.",
      "",
    ].join("\n"),
  );

  writeFile(
    path.join(root, "sources", "test-source", "tools", "test_tool.md"),
    [
      "---",
      "type: tool",
      "id: test_tool",
      "tags: [test, example]",
      "status: reviewed",
      "quality: medium",
      "---",
      "",
      "# Test Tool",
      "",
      "Example tool for loading tests.",
      "",
    ].join("\n"),
  );

  writeFile(
    path.join(
      root,
      "sources",
      "test-source",
      "data",
      "2026-02-05_test_transcript.md",
    ),
    [
      "---",
      "type: data",
      "id: test_transcript_2026_02_05",
      "doc_type: transcript",
      'date: "2026-02-05"',
      "tags: [test, transcript]",
      'summary_1: "Decisions: Validate loader | Actions: Run tests | Risks: None"',
      "status: candidate",
      "quality: medium",
      "---",
      "",
      "# Test Transcript",
      "",
      "Placeholder transcript for integration tests.",
      "",
    ].join("\n"),
  );

  writeFile(
    path.join(
      root,
      "sources",
      "test-source",
      "data",
      "2026-02-06_test_journal.md",
    ),
    [
      "---",
      "type: data",
      "id: test_journal_2026_02_06",
      "doc_type: journal",
      'date: "2026-02-06"',
      "tags: [test, journal]",
      'summary_1: "Notes: Example journal entry | Actions: None | Risks: None"',
      "status: draft",
      "quality: low",
      "---",
      "",
      "# Test Journal",
      "",
      "Placeholder journal entry for sorting checks.",
      "",
    ].join("\n"),
  );

  writeFile(
    path.join(
      root,
      "sources",
      "test-source",
      "data",
      "2026-02-07_test_article.md",
    ),
    [
      "---",
      "type: data",
      "id: test_article_2026_02_07",
      "doc_type: article",
      'date: "2026-02-07"',
      "tags: [test, article]",
      'summary_1: "Summary: Example article | Actions: None | Risks: None"',
      "status: reviewed",
      "quality: medium",
      "---",
      "",
      "# Test Article",
      "",
      "Placeholder article for integration tests.",
      "",
    ].join("\n"),
  );

  return root;
}

test("loader and resolver work across multiple sources", () => {
  const projectRoot = createTempProject();
  const loader = new FrameLoader(projectRoot);
  const catalog = loader.load();

  assert.equal(catalog.size, 15);
  assert.ok(catalog.has("default_operator"));
  assert.ok(catalog.has("test_transcript_2026_02_05"));

  const resolver = new FrameResolver(projectRoot);
  const testRef = catalog.get("test_transcript_2026_02_05")!.ref;
  const content = resolver.read(testRef);
  assert.ok(content.includes("Test Transcript"));
});

test("map builder generates records_tree and records_map", () => {
  const projectRoot = createTempProject();
  const builder = new RecordsMapBuilder({
    projectRoot,
    includeFallbackSummaries: true,
    outputRefSource: "outputs",
  });

  const result = builder.build(new Set(["test_transcript_2026_02_05"]));
  assert.equal(result.maps.length, 2);

  const recordsTree = fs.readFileSync(
    path.join(projectRoot, "maps", "records_tree.txt"),
    "utf-8",
  );
  assert.ok(recordsTree.includes("[SELECTED]"));
  assert.ok(recordsTree.includes("(2026-02-05)"));

  const recordsMap = fs.readFileSync(
    path.join(projectRoot, "maps", "records_map.md"),
    "utf-8",
  );
  assert.ok(
    recordsMap.includes("ref:test-source:data:test_transcript_2026_02_05"),
  );
  assert.ok(
    recordsMap.includes("ref:test-source:data:test_article_2026_02_07"),
  );
});

test("bundle builder orders maps before full records", () => {
  const projectRoot = createTempProject();
  const builder = new FrameBundleBuilder({
    projectRoot,
    request: "latest test transcript summary",
    outputRefSource: "outputs",
  });

  const bundle = builder.build();
  const mapIndex = bundle.context_read_order.findIndex(
    (ref) => ref.path === "maps/records_map.md",
  );
  const recordIndex = bundle.context_read_order.findIndex((ref) =>
    ref.path.includes("data/2026-02-05_test_transcript.md"),
  );

  assert.ok(mapIndex >= 0);
  assert.ok(recordIndex >= 0);
  assert.ok(mapIndex < recordIndex);
  assert.ok(bundle.records_tree_preview.includes("[SELECTED]"));
});
