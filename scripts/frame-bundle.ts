#!/usr/bin/env tsx
/**
 * Build a curated context bundle for a request.
 * Use as a CLI to select a profile, skills, tools, records, and maps, then
 * optionally write `context_bundle.json` to a run directory.
 *
 * Usage (CLI): tsx scripts/frame-bundle.ts --request "..." [--runDir outputs]
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { FrameCurator } from "./frame-curate.js";
import { RecordsMapBuilder } from "./frame-build-records-map.js";
import { FrameResolver } from "./frame-resolve.js";
import { FileRef } from "./frame-load.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ContextBundle {
  original_request: string;
  profile: FileRef | null;
  skills: FileRef[];
  tools: FileRef[];
  records: FileRef[];
  maps: FileRef[];
  context_read_order: FileRef[];
  records_tree_preview: string;
  notes: string;
}

interface BundleOptions {
  projectRoot?: string;
  request: string;
  runDir?: string;
  outputRefSource?: string;
  maxSkills?: number;
  maxTools?: number;
  maxRecords?: number;
}

export class FrameBundleBuilder {
  private projectRoot: string;
  private options: Required<BundleOptions>;

  constructor(options: BundleOptions) {
    this.projectRoot = path.resolve(options.projectRoot || process.cwd());
    this.options = {
      projectRoot: this.projectRoot,
      request: options.request,
      runDir: options.runDir || "",
      outputRefSource: options.outputRefSource || "outputs",
      maxSkills: options.maxSkills ?? 3,
      maxTools: options.maxTools ?? 3,
      maxRecords: options.maxRecords ?? 8,
    };
  }

  build(): ContextBundle {
    // Ensure maps exist
    const mapBuilder = new RecordsMapBuilder({
      projectRoot: this.projectRoot,
      outputRefSource: this.options.outputRefSource,
      includeFallbackSummaries: true,
    });

    // Curate selection
    const curator = new FrameCurator({
      projectRoot: this.projectRoot,
      request: this.options.request,
      maxSkills: this.options.maxSkills,
      maxTools: this.options.maxTools,
      maxRecords: this.options.maxRecords,
    });

    const curation = curator.curate();

    // Build maps with selected markers
    const selectedRecordIds = new Set(
      curation.records.map((r) => r.metadata.id),
    );
    const mapResult = mapBuilder.build(selectedRecordIds);

    // Build context_read_order: profile -> skills -> tools -> maps -> records
    const contextReadOrder: FileRef[] = [];

    if (curation.profile) {
      contextReadOrder.push(curation.profile.ref);
    }

    for (const skill of curation.skills) {
      contextReadOrder.push(skill.ref);
    }

    for (const tool of curation.tools) {
      contextReadOrder.push(tool.ref);
    }

    // Maps come before full records
    for (const mapRef of mapResult.maps) {
      contextReadOrder.push(mapRef);
    }

    // Then selected records
    for (const record of curation.records) {
      contextReadOrder.push(record.ref);
    }

    // Read records_tree_preview
    const resolver = new FrameResolver(this.projectRoot);
    const recordsTreeRef =
      mapResult.maps.find((ref) => ref.path.endsWith("records_tree.txt")) ??
      mapResult.maps[0];
    const recordsTreePreview = recordsTreeRef
      ? resolver.read(recordsTreeRef)
      : "";

    // Build bundle
    const bundle: ContextBundle = {
      original_request: this.options.request,
      profile: curation.profile ? curation.profile.ref : null,
      skills: curation.skills.map((s) => s.ref),
      tools: curation.tools.map((t) => t.ref),
      records: curation.records.map((r) => r.ref),
      maps: mapResult.maps,
      context_read_order: contextReadOrder,
      records_tree_preview: recordsTreePreview,
      notes: curation.notes,
    };

    // Write to run directory if provided
    if (this.options.runDir) {
      const runDir = path.resolve(this.projectRoot, this.options.runDir);
      if (!fs.existsSync(runDir)) {
        fs.mkdirSync(runDir, { recursive: true });
      }

      const bundlePath = path.join(runDir, "context_bundle.json");
      fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), "utf-8");
      console.error(`Context bundle written to: ${bundlePath}`);
    }

    return bundle;
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let projectRoot = process.cwd();
  let request = "";
  let runDir = "";
  let outputRefSource = "outputs";
  let maxSkills = 3;
  let maxTools = 3;
  let maxRecords = 8;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--projectRoot" && args[i + 1]) {
      projectRoot = args[i + 1];
      i++;
    } else if (args[i] === "--request" && args[i + 1]) {
      request = args[i + 1];
      i++;
    } else if (args[i] === "--runDir" && args[i + 1]) {
      runDir = args[i + 1];
      i++;
    } else if (args[i] === "--outputRefSource" && args[i + 1]) {
      outputRefSource = args[i + 1];
      i++;
    } else if (args[i] === "--maxSkills" && args[i + 1]) {
      maxSkills = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--maxTools" && args[i + 1]) {
      maxTools = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--maxRecords" && args[i + 1]) {
      maxRecords = parseInt(args[i + 1], 10);
      i++;
    }
  }

  if (!request) {
    console.error("Error: --request is required");
    process.exit(1);
  }

  const builder = new FrameBundleBuilder({
    projectRoot,
    request,
    runDir,
    outputRefSource,
    maxSkills,
    maxTools,
    maxRecords,
  });

  try {
    const bundle = builder.build();
    console.log(JSON.stringify(bundle, null, 2));
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}
