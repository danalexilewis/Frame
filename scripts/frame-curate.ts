#!/usr/bin/env tsx
/**
 * Curate the best-matching profile, skills, tools, and records for a request.
 * Use as a CLI to score entities and emit the top selections as JSON.
 *
 * Usage (CLI): tsx scripts/frame-curate.ts --request "..."
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { FrameLoader, Entity, FileRef } from "./frame-load.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CuratorOptions {
  projectRoot?: string;
  request: string;
  maxSkills?: number;
  maxTools?: number;
  maxRecords?: number;
}

interface CuratorResult {
  profile: Entity | null;
  skills: Entity[];
  tools: Entity[];
  records: Entity[];
  notes: string;
}

export class FrameCurator {
  private projectRoot: string;
  private loader: FrameLoader;
  private options: Required<CuratorOptions>;

  constructor(options: CuratorOptions) {
    this.projectRoot = path.resolve(options.projectRoot || process.cwd());
    this.loader = new FrameLoader(this.projectRoot);
    this.options = {
      projectRoot: this.projectRoot,
      request: options.request,
      maxSkills: options.maxSkills ?? 3,
      maxTools: options.maxTools ?? 3,
      maxRecords: options.maxRecords ?? 8,
    };
  }

  private scoreEntity(entity: Entity, request: string): number {
    let score = 0;
    const { metadata } = entity;
    const requestLower = request.toLowerCase();

    // Tag/trigger matching
    if (metadata.tags) {
      for (const tag of metadata.tags) {
        if (requestLower.includes(tag.toLowerCase())) {
          score += 10;
        }
      }
    }

    if (metadata.triggers) {
      for (const trigger of metadata.triggers) {
        if (requestLower.includes(trigger.toLowerCase())) {
          score += 15; // Triggers are more specific than tags
        }
      }
    }

    // Quality/status bonuses
    const qualityScores: Record<string, number> = {
      best: 20,
      high: 15,
      medium: 10,
      low: 5,
    };
    if (metadata.quality && qualityScores[metadata.quality]) {
      score += qualityScores[metadata.quality];
    }

    const statusScores: Record<string, number> = {
      stable: 15,
      reviewed: 10,
      candidate: 5,
      draft: 0,
    };
    if (metadata.status && statusScores[metadata.status]) {
      score += statusScores[metadata.status];
    }

    // Recency boost for "latest/most recent/last meeting"
    const recencyKeywords = [
      "latest",
      "most recent",
      "last meeting",
      "recent",
      "last",
    ];
    const hasRecencyIntent = recencyKeywords.some((kw) =>
      requestLower.includes(kw),
    );
    if (hasRecencyIntent && metadata.date && metadata.type === "data") {
      // Boost records with dates, more recent = higher boost
      const recordDate = new Date(metadata.date);
      const now = new Date();
      const daysDiff =
        (now.getTime() - recordDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff <= 30) {
        score += 20 - Math.floor(daysDiff / 2); // Up to 20 points for very recent
      }
    }

    return score;
  }

  curate(): CuratorResult {
    const catalog = this.loader.load();
    const request = this.options.request;

    // Separate entities by type
    const profiles: Entity[] = [];
    const skills: Entity[] = [];
    const tools: Entity[] = [];
    const records: Entity[] = [];

    for (const entity of catalog.values()) {
      switch (entity.metadata.type) {
        case "profile":
          profiles.push(entity);
          break;
        case "skill":
          skills.push(entity);
          break;
        case "tool":
          tools.push(entity);
          break;
        case "data":
          records.push(entity);
          break;
      }
    }

    // Score and select
    const scoredProfiles = profiles.map((e) => ({
      entity: e,
      score: this.scoreEntity(e, request),
    }));
    scoredProfiles.sort((a, b) => b.score - a.score);

    const scoredSkills = skills.map((e) => ({
      entity: e,
      score: this.scoreEntity(e, request),
    }));
    scoredSkills.sort((a, b) => b.score - a.score);

    const scoredTools = tools.map((e) => ({
      entity: e,
      score: this.scoreEntity(e, request),
    }));
    scoredTools.sort((a, b) => b.score - a.score);

    const scoredRecords = records.map((e) => ({
      entity: e,
      score: this.scoreEntity(e, request),
    }));
    scoredRecords.sort((a, b) => b.score - a.score);

    // Select top entities
    const selectedProfile =
      scoredProfiles.length > 0 ? scoredProfiles[0].entity : null;
    const selectedSkills = scoredSkills
      .slice(0, this.options.maxSkills)
      .map((s) => s.entity);
    const selectedTools = scoredTools
      .slice(0, this.options.maxTools)
      .map((t) => t.entity);
    const selectedRecords = scoredRecords
      .slice(0, this.options.maxRecords)
      .map((r) => r.entity);

    // Build notes
    const notesParts: string[] = [];
    if (selectedProfile) {
      notesParts.push(`Selected profile: ${selectedProfile.metadata.id}`);
    }
    if (selectedSkills.length > 0) {
      notesParts.push(`Selected ${selectedSkills.length} skill(s)`);
    }
    if (selectedTools.length > 0) {
      notesParts.push(`Selected ${selectedTools.length} tool(s)`);
    }
    if (selectedRecords.length > 0) {
      notesParts.push(
        `Selected ${selectedRecords.length} record(s) based on relevance`,
      );
    }

    return {
      profile: selectedProfile,
      skills: selectedSkills,
      tools: selectedTools,
      records: selectedRecords,
      notes: notesParts.join(". ") + ".",
    };
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let projectRoot = process.cwd();
  let request = "";
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

  const curator = new FrameCurator({
    projectRoot,
    request,
    maxSkills,
    maxTools,
    maxRecords,
  });

  try {
    const result = curator.curate();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}
