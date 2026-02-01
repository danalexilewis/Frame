#!/usr/bin/env tsx
/**
 * Run the Frame MCP server over stdio.
 * Use as a CLI to expose Frame resources and tools to MCP clients.
 *
 * Usage (CLI): tsx scripts/frame-mcp-server.ts [projectRoot]
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as path from "path";
import * as fs from "fs";
import { FrameLoader, Entity, FileRef } from "./frame-load.js";
import { FrameResolver } from "./frame-resolve.js";
import { RecordsMapBuilder } from "./frame-build-records-map.js";
import { FrameBundleBuilder } from "./frame-bundle.js";

class FrameMCPServer {
  private server: Server;
  private projectRoot: string;
  private loader: FrameLoader;
  private resolver: FrameResolver;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
    this.loader = new FrameLoader(this.projectRoot);
    this.resolver = new FrameResolver(this.projectRoot);

    this.server = new Server(
      {
        name: "frame-mcp-server",
        version: "0.1.0",
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      },
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    // List resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const catalog = this.loader.load();
      const resources = [];

      // Add all entities
      for (const entity of catalog.values()) {
        const uri = `frame://${entity.ref.source}/${entity.metadata.type}/${entity.metadata.id}`;
        resources.push({
          uri,
          name: entity.metadata.id,
          description: `Frame ${entity.metadata.type}: ${entity.metadata.id}`,
          mimeType: "text/markdown",
        });
      }

      // Add maps
      const mapsDir = path.join(this.projectRoot, "maps");
      if (fs.existsSync(mapsDir)) {
        const files = fs.readdirSync(mapsDir);
        for (const file of files) {
          if (file === "records_tree.txt" || file === "records_map.md") {
            const uri = `frame://outputs/map/${file}`;
            resources.push({
              uri,
              name: file,
              description: `Frame map: ${file}`,
              mimeType: file.endsWith(".md") ? "text/markdown" : "text/plain",
            });
          }
        }
      }

      return { resources };
    });

    // Read resource
    this.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
        let uri: URL;
        try {
          uri = new URL(request.params.uri);
        } catch (error) {
          throw new Error(
            `Malformed URI: "${request.params.uri}". ${
              error instanceof Error ? error.message : "Invalid URI format"
            }`,
          );
        }

        if (uri.protocol !== "frame:") {
          throw new Error(`Unsupported URI scheme: ${uri.protocol}`);
        }

        const parts = uri.pathname.split("/").filter(Boolean);
        const source = uri.hostname;

        if (parts[0] === "map") {
          // Map resource: frame://outputs/map/<filename>
          const filename = parts[1];
          const mapPath = path.join(this.projectRoot, "maps", filename);
          if (!fs.existsSync(mapPath)) {
            throw new Error(`Map not found: ${filename}`);
          }
          const content = fs.readFileSync(mapPath, "utf-8");
          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: filename.endsWith(".md")
                  ? "text/markdown"
                  : "text/plain",
                text: content,
              },
            ],
          };
        } else {
          // Entity resource: frame://<source>/<type>/<id>
          const [type, id] = parts;
          const catalog = this.loader.load();

          let entity: Entity | undefined;
          for (const e of catalog.values()) {
            if (
              e.ref.source === source &&
              e.metadata.type === type &&
              e.metadata.id === id
            ) {
              entity = e;
              break;
            }
          }

          if (!entity) {
            throw new Error(`Entity not found: ${source}/${type}/${id}`);
          }

          const content = this.resolver.read(entity.ref);
          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: "text/markdown",
                text: content,
              },
            ],
          };
        }
      },
    );

    // List tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "frame_build_records_map",
            description:
              "Build records tree and map files for Frame data entities",
            inputSchema: {
              type: "object",
              properties: {
                includeFallbackSummaries: {
                  type: "boolean",
                  description:
                    "Include fallback summaries if not in frontmatter (default: true)",
                },
                outputRefSource: {
                  type: "string",
                  description: 'Source name used for maps (default: "outputs")',
                },
                incremental: {
                  type: "boolean",
                  description:
                    "Use git diff to update cached summaries (default: false)",
                },
              },
            },
          },
          {
            name: "frame_context_build",
            description:
              "Build a context bundle (profile + skills + tools + records + maps) for a given request",
            inputSchema: {
              type: "object",
              properties: {
                request: {
                  type: "string",
                  description: "The user request/prompt to curate context for",
                },
                maxSkills: {
                  type: "number",
                  description:
                    "Maximum number of skills to include (default: 3)",
                },
                maxTools: {
                  type: "number",
                  description:
                    "Maximum number of tools to include (default: 3)",
                },
                maxRecords: {
                  type: "number",
                  description:
                    "Maximum number of records to include (default: 8)",
                },
              },
              required: ["request"],
            },
          },
        ],
      };
    });

    // Call tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === "frame_build_records_map") {
        const includeFallbackSummaries =
          (args as any)?.includeFallbackSummaries !== false;
        const outputRefSource = (args as any)?.outputRefSource || "outputs";
        const incremental = (args as any)?.incremental === true;

        const builder = new RecordsMapBuilder({
          projectRoot: this.projectRoot,
          includeFallbackSummaries,
          outputRefSource,
          incremental,
        });

        const result = builder.build(new Set());
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } else if (name === "frame_context_build") {
        const requestText = (args as any)?.request;
        if (!requestText) {
          throw new Error("Missing required parameter: request");
        }

        const maxSkills = (args as any)?.maxSkills || 3;
        const maxTools = (args as any)?.maxTools || 3;
        const maxRecords = (args as any)?.maxRecords || 8;

        const builder = new FrameBundleBuilder({
          projectRoot: this.projectRoot,
          request: requestText,
          maxSkills,
          maxTools,
          maxRecords,
        });

        const bundle = builder.build();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(bundle, null, 2),
            },
          ],
        };
      } else {
        throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Frame MCP server running on stdio");
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const projectRoot = process.argv[2] || process.cwd();
  const server = new FrameMCPServer(projectRoot);
  server.run().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
}
