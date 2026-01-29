#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { SpotClient } from "./client/spot-client.js";

// Extended tool type with writable flag
interface SpotTool extends Tool {
  writable?: boolean;
}

// Tools that modify resources (create/delete operations)
const WRITABLE_TOOLS = new Set([
  "create_cloudspace",
  "delete_cloudspace",
  "create_spot_node_pool",
  "delete_spot_node_pool",
  "create_ondemand_node_pool",
  "delete_ondemand_node_pool",
]);

// Check if read-only mode is enabled
function isReadOnly(): boolean {
  const envValue = process.env.RACKSPACE_SPOT_READ_ONLY;
  return envValue === "true" || envValue === "1";
}

// Tool definitions
const allTools: SpotTool[] = [
  // ==================== Regions ====================
  {
    name: "list_regions",
    description:
      "List all available Rackspace Spot regions where cloudspaces can be deployed. Returns region names, countries, and provider information.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_region",
    description:
      "Get detailed information about a specific Rackspace Spot region by name.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Region name (e.g., us-central-dfw-1, us-east-iad-1, eu-west-lon-1)",
        },
      },
      required: ["name"],
    },
  },

  // ==================== Server Classes ====================
  {
    name: "list_server_classes",
    description:
      "List all available server classes (machine types) that can be used for node pools. Returns CPU, memory, and pricing information.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_server_class",
    description:
      "Get detailed information about a specific server class by name.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Server class name (e.g., gp.vs1.small-dfw, m3.medium)",
        },
      },
      required: ["name"],
    },
  },

  // ==================== Organizations ====================
  {
    name: "list_organizations",
    description:
      "List all organizations the user has access to. Returns organization names and their associated namespaces (org-xxx format) needed for other API calls.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  // ==================== Cloudspaces ====================
  {
    name: "list_cloudspaces",
    description:
      "List all Kubernetes cloudspaces (clusters) in a specific organization namespace.",
    inputSchema: {
      type: "object",
      properties: {
        namespace: {
          type: "string",
          description: "Organization namespace (e.g., org-xxxxx)",
        },
      },
      required: ["namespace"],
    },
  },
  {
    name: "get_cloudspace",
    description:
      "Get detailed information about a specific cloudspace including its status, region, and configuration.",
    inputSchema: {
      type: "object",
      properties: {
        namespace: {
          type: "string",
          description: "Organization namespace (e.g., org-xxxxx)",
        },
        name: {
          type: "string",
          description: "Cloudspace name",
        },
      },
      required: ["namespace", "name"],
    },
  },
  {
    name: "create_cloudspace",
    description:
      "Create a new Kubernetes cloudspace (cluster) in a specific region. The cloudspace will be fully managed by Rackspace Spot.",
    inputSchema: {
      type: "object",
      properties: {
        namespace: {
          type: "string",
          description: "Organization namespace (e.g., org-xxxxx)",
        },
        name: {
          type: "string",
          description: "Name for the new cloudspace",
        },
        region: {
          type: "string",
          description: "Region to deploy the cloudspace (e.g., us-central-dfw-1)",
        },
        haControlPlane: {
          type: "boolean",
          description:
            "Enable high-availability control plane (default: false, costs extra)",
        },
      },
      required: ["namespace", "name", "region"],
    },
    writable: true,
  },
  {
    name: "delete_cloudspace",
    description:
      "Delete a cloudspace and all its associated resources. This action is irreversible.",
    inputSchema: {
      type: "object",
      properties: {
        namespace: {
          type: "string",
          description: "Organization namespace (e.g., org-xxxxx)",
        },
        name: {
          type: "string",
          description: "Cloudspace name to delete",
        },
      },
      required: ["namespace", "name"],
    },
    writable: true,
  },

  // ==================== Spot Node Pools ====================
  {
    name: "list_spot_node_pools",
    description:
      "List all spot node pools in a cloudspace. Spot nodes use auction-based pricing for significant cost savings.",
    inputSchema: {
      type: "object",
      properties: {
        namespace: {
          type: "string",
          description: "Organization namespace (e.g., org-xxxxx)",
        },
        cloudspaceName: {
          type: "string",
          description: "Cloudspace name",
        },
      },
      required: ["namespace", "cloudspaceName"],
    },
  },
  {
    name: "get_spot_node_pool",
    description:
      "Get detailed information about a specific spot node pool including bid price, node count, and status.",
    inputSchema: {
      type: "object",
      properties: {
        namespace: {
          type: "string",
          description: "Organization namespace (e.g., org-xxxxx)",
        },
        name: {
          type: "string",
          description: "Spot node pool name",
        },
      },
      required: ["namespace", "name"],
    },
  },
  {
    name: "create_spot_node_pool",
    description:
      "Create a new spot node pool with auction-based pricing. Set a maximum bid price per hour for significant cost savings.",
    inputSchema: {
      type: "object",
      properties: {
        namespace: {
          type: "string",
          description: "Organization namespace (e.g., org-xxxxx)",
        },
        name: {
          type: "string",
          description: "Name for the new spot node pool",
        },
        cloudspaceName: {
          type: "string",
          description: "Cloudspace to add the node pool to",
        },
        serverClassName: {
          type: "string",
          description: "Server class for nodes (e.g., gp.vs1.small-dfw)",
        },
        bidPrice: {
          type: "string",
          description: "Maximum bid price per hour (e.g., '0.05' for $0.05/hr)",
        },
        minNodes: {
          type: "number",
          description: "Minimum number of nodes (default: 0)",
        },
        maxNodes: {
          type: "number",
          description: "Maximum number of nodes for autoscaling (default: 10)",
        },
        desiredNodes: {
          type: "number",
          description: "Initial desired number of nodes (default: 1)",
        },
      },
      required: ["namespace", "name", "cloudspaceName", "serverClassName", "bidPrice"],
    },
    writable: true,
  },
  {
    name: "delete_spot_node_pool",
    description: "Delete a spot node pool from a cloudspace.",
    inputSchema: {
      type: "object",
      properties: {
        namespace: {
          type: "string",
          description: "Organization namespace (e.g., org-xxxxx)",
        },
        name: {
          type: "string",
          description: "Spot node pool name to delete",
        },
      },
      required: ["namespace", "name"],
    },
    writable: true,
  },

  // ==================== On-Demand Node Pools ====================
  {
    name: "list_ondemand_node_pools",
    description:
      "List all on-demand node pools in a cloudspace. On-demand nodes have fixed pricing and guaranteed availability.",
    inputSchema: {
      type: "object",
      properties: {
        namespace: {
          type: "string",
          description: "Organization namespace (e.g., org-xxxxx)",
        },
        cloudspaceName: {
          type: "string",
          description: "Cloudspace name",
        },
      },
      required: ["namespace", "cloudspaceName"],
    },
  },
  {
    name: "get_ondemand_node_pool",
    description:
      "Get detailed information about a specific on-demand node pool.",
    inputSchema: {
      type: "object",
      properties: {
        namespace: {
          type: "string",
          description: "Organization namespace (e.g., org-xxxxx)",
        },
        name: {
          type: "string",
          description: "On-demand node pool name",
        },
      },
      required: ["namespace", "name"],
    },
  },
  {
    name: "create_ondemand_node_pool",
    description:
      "Create a new on-demand node pool with fixed pricing and guaranteed availability.",
    inputSchema: {
      type: "object",
      properties: {
        namespace: {
          type: "string",
          description: "Organization namespace (e.g., org-xxxxx)",
        },
        name: {
          type: "string",
          description: "Name for the new on-demand node pool",
        },
        cloudspaceName: {
          type: "string",
          description: "Cloudspace to add the node pool to",
        },
        serverClassName: {
          type: "string",
          description: "Server class for nodes (e.g., gp.vs1.small-dfw)",
        },
        minNodes: {
          type: "number",
          description: "Minimum number of nodes (default: 0)",
        },
        maxNodes: {
          type: "number",
          description: "Maximum number of nodes for autoscaling (default: 10)",
        },
        desiredNodes: {
          type: "number",
          description: "Initial desired number of nodes (default: 1)",
        },
      },
      required: ["namespace", "name", "cloudspaceName", "serverClassName"],
    },
    writable: true,
  },
  {
    name: "delete_ondemand_node_pool",
    description: "Delete an on-demand node pool from a cloudspace.",
    inputSchema: {
      type: "object",
      properties: {
        namespace: {
          type: "string",
          description: "Organization namespace (e.g., org-xxxxx)",
        },
        name: {
          type: "string",
          description: "On-demand node pool name to delete",
        },
      },
      required: ["namespace", "name"],
    },
    writable: true,
  },

  // ==================== Kubeconfig ====================
  {
    name: "get_kubeconfig",
    description:
      "Generate a kubeconfig file for accessing a cloudspace's Kubernetes cluster with kubectl.",
    inputSchema: {
      type: "object",
      properties: {
        organizationName: {
          type: "string",
          description: "Organization name (not namespace)",
        },
        cloudspaceName: {
          type: "string",
          description: "Cloudspace name",
        },
      },
      required: ["organizationName", "cloudspaceName"],
    },
  },

  // ==================== Pricing ====================
  {
    name: "get_market_pricing",
    description:
      "Get current market pricing and capacity information for all server classes across regions. Useful for determining optimal bid prices.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_price_history",
    description:
      "Get historical price data for a specific server class in a region. Useful for understanding price trends.",
    inputSchema: {
      type: "object",
      properties: {
        serverClass: {
          type: "string",
          description: "Server class name",
        },
        region: {
          type: "string",
          description: "Region name",
        },
      },
      required: ["serverClass", "region"],
    },
  },
  {
    name: "get_percentile_pricing",
    description:
      "Get percentile pricing information showing price distribution for server classes. Useful for setting competitive bid prices.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

// Get refresh token from environment
function getRefreshToken(): string {
  const token = process.env.RACKSPACE_SPOT_REFRESH_TOKEN;
  if (!token) {
    throw new Error(
      "RACKSPACE_SPOT_REFRESH_TOKEN environment variable is required. " +
        "Get your refresh token from https://spot.rackspace.com/ui/api-access/terraform"
    );
  }
  return token;
}

// Create and run the server
async function main() {
  const server = new Server(
    {
      name: "rackspace-spot-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  let client: SpotClient | null = null;

  function getClient(): SpotClient {
    if (!client) {
      client = new SpotClient({ refreshToken: getRefreshToken() });
    }
    return client;
  }

  // List available tools (filter writable tools in read-only mode)
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const readOnly = isReadOnly();
    const tools = readOnly
      ? allTools.filter((tool) => !tool.writable)
      : allTools;

    // Remove the writable flag from the response (it's internal metadata)
    const publicTools: Tool[] = tools.map(({ writable, ...rest }) => rest);
    return { tools: publicTools };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Block writable tools in read-only mode
    if (isReadOnly() && WRITABLE_TOOLS.has(name)) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Tool "${name}" is not available in read-only mode. Set RACKSPACE_SPOT_READ_ONLY=false to enable write operations.`,
          },
        ],
        isError: true,
      };
    }

    try {
      const spotClient = getClient();
      let result: unknown;

      switch (name) {
        // Regions
        case "list_regions":
          result = await spotClient.listRegions();
          break;
        case "get_region":
          result = await spotClient.getRegion(args?.name as string);
          break;

        // Server Classes
        case "list_server_classes":
          result = await spotClient.listServerClasses();
          break;
        case "get_server_class":
          result = await spotClient.getServerClass(args?.name as string);
          break;

        // Organizations
        case "list_organizations":
          result = await spotClient.listOrganizations();
          break;

        // Cloudspaces
        case "list_cloudspaces":
          result = await spotClient.listCloudspaces(args?.namespace as string);
          break;
        case "get_cloudspace":
          result = await spotClient.getCloudspace(
            args?.namespace as string,
            args?.name as string
          );
          break;
        case "create_cloudspace":
          result = await spotClient.createCloudspace(args?.namespace as string, {
            name: args?.name as string,
            region: args?.region as string,
            haControlPlane: args?.haControlPlane as boolean | undefined,
          });
          break;
        case "delete_cloudspace":
          result = await spotClient.deleteCloudspace(
            args?.namespace as string,
            args?.name as string
          );
          break;

        // Spot Node Pools
        case "list_spot_node_pools":
          result = await spotClient.listSpotNodePools(
            args?.namespace as string,
            args?.cloudspaceName as string
          );
          break;
        case "get_spot_node_pool":
          result = await spotClient.getSpotNodePool(
            args?.namespace as string,
            args?.name as string
          );
          break;
        case "create_spot_node_pool":
          result = await spotClient.createSpotNodePool(args?.namespace as string, {
            name: args?.name as string,
            cloudspaceName: args?.cloudspaceName as string,
            serverClassName: args?.serverClassName as string,
            bidPrice: args?.bidPrice as string,
            minNodes: args?.minNodes as number | undefined,
            maxNodes: args?.maxNodes as number | undefined,
            desiredNodes: args?.desiredNodes as number | undefined,
          });
          break;
        case "delete_spot_node_pool":
          result = await spotClient.deleteSpotNodePool(
            args?.namespace as string,
            args?.name as string
          );
          break;

        // On-Demand Node Pools
        case "list_ondemand_node_pools":
          result = await spotClient.listOnDemandNodePools(
            args?.namespace as string,
            args?.cloudspaceName as string
          );
          break;
        case "get_ondemand_node_pool":
          result = await spotClient.getOnDemandNodePool(
            args?.namespace as string,
            args?.name as string
          );
          break;
        case "create_ondemand_node_pool":
          result = await spotClient.createOnDemandNodePool(args?.namespace as string, {
            name: args?.name as string,
            cloudspaceName: args?.cloudspaceName as string,
            serverClassName: args?.serverClassName as string,
            minNodes: args?.minNodes as number | undefined,
            maxNodes: args?.maxNodes as number | undefined,
            desiredNodes: args?.desiredNodes as number | undefined,
          });
          break;
        case "delete_ondemand_node_pool":
          result = await spotClient.deleteOnDemandNodePool(
            args?.namespace as string,
            args?.name as string
          );
          break;

        // Kubeconfig
        case "get_kubeconfig":
          result = await spotClient.generateKubeconfig(
            args?.organizationName as string,
            args?.cloudspaceName as string
          );
          break;

        // Pricing
        case "get_market_pricing":
          result = await spotClient.getMarketPriceCapacity();
          break;
        case "get_price_history":
          result = await spotClient.getPriceHistory(
            args?.serverClass as string,
            args?.region as string
          );
          break;
        case "get_percentile_pricing":
          result = await spotClient.getPercentileInformation();
          break;

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Start the server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const mode = isReadOnly() ? "read-only" : "read-write";
  console.error(`Rackspace Spot MCP server running on stdio (${mode} mode)`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
