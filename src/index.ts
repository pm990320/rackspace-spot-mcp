#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { pathToFileURL } from "node:url";
import { SpotClient } from "./client/spot-client.js";

// Extended tool type with writable flag
interface SpotTool extends Tool {
  writable?: boolean;
}

export interface SpotProfileConfig {
  tokenEnv?: string;
  refreshToken?: string;
  defaultNamespace?: string;
  defaultOrganizationName?: string;
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
export function isReadOnly(): boolean {
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

export const listConfiguredProfilesTool: SpotTool = {
  name: "list_configured_profiles",
  description:
    "List configured Rackspace Spot MCP profiles and their defaults. Use these profile aliases with other tools when multiple tokens or organizations are configured.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
};

const PROFILE_AWARE_TOOLS = new Set(
  allTools.map((tool) => tool.name)
);

const NAMESPACE_OPTIONAL_WITH_PROFILE_TOOLS = new Set([
  "list_cloudspaces",
  "get_cloudspace",
  "create_cloudspace",
  "delete_cloudspace",
  "list_spot_node_pools",
  "get_spot_node_pool",
  "create_spot_node_pool",
  "delete_spot_node_pool",
  "list_ondemand_node_pools",
  "get_ondemand_node_pool",
  "create_ondemand_node_pool",
  "delete_ondemand_node_pool",
]);

const ORGANIZATION_NAME_OPTIONAL_WITH_PROFILE_TOOLS = new Set([
  "get_kubeconfig",
]);

export function augmentToolWithProfile(tool: SpotTool): SpotTool {
  if (!PROFILE_AWARE_TOOLS.has(tool.name)) {
    return tool;
  }

  const properties = {
    ...(tool.inputSchema.properties ?? {}),
    profile: {
      type: "string",
      description:
        "Optional Rackspace Spot profile alias. Use this to select a configured token/account profile.",
    },
  } as Record<string, { type: string; description?: string }>;

  const required = Array.isArray(tool.inputSchema.required)
    ? [...tool.inputSchema.required]
    : [];

  if (NAMESPACE_OPTIONAL_WITH_PROFILE_TOOLS.has(tool.name)) {
    const idx = required.indexOf("namespace");
    if (idx >= 0) {
      required.splice(idx, 1);
    }
    if (properties.namespace?.description) {
      properties.namespace = {
        ...properties.namespace,
        description: `${properties.namespace.description} Optional if the selected profile defines defaultNamespace.`,
      };
    }
  }

  if (ORGANIZATION_NAME_OPTIONAL_WITH_PROFILE_TOOLS.has(tool.name)) {
    const idx = required.indexOf("organizationName");
    if (idx >= 0) {
      required.splice(idx, 1);
    }
    if (properties.organizationName?.description) {
      properties.organizationName = {
        ...properties.organizationName,
        description: `${properties.organizationName.description} Optional if the selected profile defines defaultOrganizationName.`,
      };
    }
  }

  return {
    ...tool,
    description: `${tool.description} Supports optional profile selection when multiple Rackspace Spot profiles are configured.`,
    inputSchema: {
      ...tool.inputSchema,
      properties,
      required,
    },
  };
}

export const publicToolsDefinition: SpotTool[] = [
  listConfiguredProfilesTool,
  ...allTools.map(augmentToolWithProfile),
];

// Get refresh token from environment
export function getRefreshToken(): string {
  const token = process.env.RACKSPACE_SPOT_REFRESH_TOKEN;
  if (!token) {
    throw new Error(
      "RACKSPACE_SPOT_REFRESH_TOKEN environment variable is required. " +
        "Get your refresh token from https://spot.rackspace.com/ui/api-access/terraform"
    );
  }
  return token;
}

export function loadProfiles(): Record<string, SpotProfileConfig> {
  const raw = process.env.RACKSPACE_SPOT_PROFILES;
  if (!raw) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `RACKSPACE_SPOT_PROFILES must be valid JSON. Parse error: ${message}`
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "RACKSPACE_SPOT_PROFILES must be a JSON object keyed by profile alias."
    );
  }

  return parsed as Record<string, SpotProfileConfig>;
}

export function getEffectiveProfileName(
  requestedProfile: string | undefined,
  profiles: Record<string, SpotProfileConfig>
): string | undefined {
  const profileNames = Object.keys(profiles);

  if (requestedProfile) {
    if (!profiles[requestedProfile]) {
      throw new Error(
        `Unknown Rackspace Spot profile '${requestedProfile}'. Use list_configured_profiles to see available profiles.`
      );
    }
    return requestedProfile;
  }

  const defaultProfile = process.env.RACKSPACE_SPOT_DEFAULT_PROFILE;
  if (defaultProfile) {
    if (!profiles[defaultProfile]) {
      throw new Error(
        `RACKSPACE_SPOT_DEFAULT_PROFILE is set to '${defaultProfile}', but no such profile exists.`
      );
    }
    return defaultProfile;
  }

  if (profileNames.length === 1) {
    return profileNames[0];
  }

  return undefined;
}

export function getRefreshTokenForProfile(
  profileName: string,
  profiles: Record<string, SpotProfileConfig>
): string {
  const profile = profiles[profileName];
  if (!profile) {
    throw new Error(`Unknown Rackspace Spot profile '${profileName}'.`);
  }

  if (profile.tokenEnv) {
    const token = process.env[profile.tokenEnv];
    if (!token) {
      throw new Error(
        `Rackspace Spot profile '${profileName}' expects token env '${profile.tokenEnv}', but it is not set.`
      );
    }
    return token;
  }

  if (profile.refreshToken) {
    return profile.refreshToken;
  }

  if (process.env.RACKSPACE_SPOT_REFRESH_TOKEN) {
    return process.env.RACKSPACE_SPOT_REFRESH_TOKEN;
  }

  throw new Error(
    `Rackspace Spot profile '${profileName}' does not define refreshToken or tokenEnv, and legacy RACKSPACE_SPOT_REFRESH_TOKEN is not set.`
  );
}

export function resolveNamespace(
  args: Record<string, unknown> | undefined,
  profiles: Record<string, SpotProfileConfig>
): string {
  const namespace =
    typeof args?.namespace === "string" ? (args.namespace as string) : "";
  if (namespace) {
    return namespace;
  }

  const profileName = getEffectiveProfileName(
    typeof args?.profile === "string" ? (args.profile as string) : undefined,
    profiles
  );

  if (profileName && profiles[profileName]?.defaultNamespace) {
    return profiles[profileName].defaultNamespace as string;
  }

  if (Object.keys(profiles).length > 1) {
    throw new Error(
      "namespace is required unless you specify a profile with defaultNamespace or set RACKSPACE_SPOT_DEFAULT_PROFILE."
    );
  }

  throw new Error(
    "namespace is required unless the selected Rackspace Spot profile defines defaultNamespace."
  );
}

export function resolveOrganizationName(
  args: Record<string, unknown> | undefined,
  profiles: Record<string, SpotProfileConfig>
): string {
  const organizationName =
    typeof args?.organizationName === "string"
      ? (args.organizationName as string)
      : "";
  if (organizationName) {
    return organizationName;
  }

  const profileName = getEffectiveProfileName(
    typeof args?.profile === "string" ? (args.profile as string) : undefined,
    profiles
  );

  if (profileName && profiles[profileName]?.defaultOrganizationName) {
    return profiles[profileName].defaultOrganizationName as string;
  }

  throw new Error(
    "organizationName is required unless the selected Rackspace Spot profile defines defaultOrganizationName."
  );
}

export function summarizeProfiles(profiles: Record<string, SpotProfileConfig>) {
  return Object.entries(profiles).map(([name, profile]) => ({
    name,
    tokenEnv: profile.tokenEnv ?? null,
    usesInlineRefreshToken: Boolean(profile.refreshToken),
    fallsBackToLegacyRefreshToken:
      !profile.tokenEnv && !profile.refreshToken,
    defaultNamespace: profile.defaultNamespace ?? null,
    defaultOrganizationName: profile.defaultOrganizationName ?? null,
  }));
}

// Create and run the server
export async function main() {
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

  const profiles = loadProfiles();
  let client: SpotClient | null = null;
  const profileClients = new Map<string, SpotClient>();

  function getClient(requestedProfile?: string): SpotClient {
    const effectiveProfile = getEffectiveProfileName(requestedProfile, profiles);

    if (effectiveProfile) {
      const existingClient = profileClients.get(effectiveProfile);
      if (existingClient) {
        return existingClient;
      }
      const newClient = new SpotClient({
        refreshToken: getRefreshTokenForProfile(effectiveProfile, profiles),
      });
      profileClients.set(effectiveProfile, newClient);
      return newClient;
    }

    if (
      Object.keys(profiles).length > 1 &&
      !process.env.RACKSPACE_SPOT_REFRESH_TOKEN
    ) {
      throw new Error(
        "Multiple Rackspace Spot profiles are configured. Specify profile explicitly or set RACKSPACE_SPOT_DEFAULT_PROFILE."
      );
    }

    if (!client) {
      client = new SpotClient({ refreshToken: getRefreshToken() });
    }
    return client;
  }

  // List available tools (filter writable tools in read-only mode)
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const readOnly = isReadOnly();
    const tools = readOnly
      ? publicToolsDefinition.filter((tool) => !tool.writable)
      : publicToolsDefinition;

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
      const profileArg =
        typeof args?.profile === "string" ? (args.profile as string) : undefined;
      let result: unknown;

      switch (name) {
        // Regions
        case "list_regions":
          result = await getClient(profileArg).listRegions();
          break;
        case "get_region":
          result = await getClient(profileArg).getRegion(args?.name as string);
          break;

        // Server Classes
        case "list_server_classes":
          result = await getClient(profileArg).listServerClasses();
          break;
        case "get_server_class":
          result = await getClient(profileArg).getServerClass(args?.name as string);
          break;

        // Organizations
        case "list_organizations":
          if (profileArg) {
            result = await getClient(profileArg).listOrganizations();
          } else if (Object.keys(profiles).length > 0) {
            result = await Promise.all(
              Object.keys(profiles).map(async (profileName) => ({
                profile: profileName,
                organizations: await getClient(profileName).listOrganizations(),
              }))
            );
          } else {
            result = await getClient().listOrganizations();
          }
          break;
        case "list_configured_profiles":
          result = summarizeProfiles(profiles);
          break;

        // Cloudspaces
        case "list_cloudspaces":
          result = await getClient(profileArg).listCloudspaces(
            resolveNamespace(args as Record<string, unknown> | undefined, profiles)
          );
          break;
        case "get_cloudspace":
          result = await getClient(profileArg).getCloudspace(
            resolveNamespace(args as Record<string, unknown> | undefined, profiles),
            args?.name as string
          );
          break;
        case "create_cloudspace":
          result = await getClient(profileArg).createCloudspace(
            resolveNamespace(args as Record<string, unknown> | undefined, profiles),
            {
              name: args?.name as string,
              region: args?.region as string,
              haControlPlane: args?.haControlPlane as boolean | undefined,
            }
          );
          break;
        case "delete_cloudspace":
          result = await getClient(profileArg).deleteCloudspace(
            resolveNamespace(args as Record<string, unknown> | undefined, profiles),
            args?.name as string
          );
          break;

        // Spot Node Pools
        case "list_spot_node_pools":
          result = await getClient(profileArg).listSpotNodePools(
            resolveNamespace(args as Record<string, unknown> | undefined, profiles),
            args?.cloudspaceName as string
          );
          break;
        case "get_spot_node_pool":
          result = await getClient(profileArg).getSpotNodePool(
            resolveNamespace(args as Record<string, unknown> | undefined, profiles),
            args?.name as string
          );
          break;
        case "create_spot_node_pool":
          result = await getClient(profileArg).createSpotNodePool(
            resolveNamespace(args as Record<string, unknown> | undefined, profiles),
            {
              name: args?.name as string,
              cloudspaceName: args?.cloudspaceName as string,
              serverClassName: args?.serverClassName as string,
              bidPrice: args?.bidPrice as string,
              minNodes: args?.minNodes as number | undefined,
              maxNodes: args?.maxNodes as number | undefined,
              desiredNodes: args?.desiredNodes as number | undefined,
            }
          );
          break;
        case "delete_spot_node_pool":
          result = await getClient(profileArg).deleteSpotNodePool(
            resolveNamespace(args as Record<string, unknown> | undefined, profiles),
            args?.name as string
          );
          break;

        // On-Demand Node Pools
        case "list_ondemand_node_pools":
          result = await getClient(profileArg).listOnDemandNodePools(
            resolveNamespace(args as Record<string, unknown> | undefined, profiles),
            args?.cloudspaceName as string
          );
          break;
        case "get_ondemand_node_pool":
          result = await getClient(profileArg).getOnDemandNodePool(
            resolveNamespace(args as Record<string, unknown> | undefined, profiles),
            args?.name as string
          );
          break;
        case "create_ondemand_node_pool":
          result = await getClient(profileArg).createOnDemandNodePool(
            resolveNamespace(args as Record<string, unknown> | undefined, profiles),
            {
              name: args?.name as string,
              cloudspaceName: args?.cloudspaceName as string,
              serverClassName: args?.serverClassName as string,
              minNodes: args?.minNodes as number | undefined,
              maxNodes: args?.maxNodes as number | undefined,
              desiredNodes: args?.desiredNodes as number | undefined,
            }
          );
          break;
        case "delete_ondemand_node_pool":
          result = await getClient(profileArg).deleteOnDemandNodePool(
            resolveNamespace(args as Record<string, unknown> | undefined, profiles),
            args?.name as string
          );
          break;

        // Kubeconfig
        case "get_kubeconfig":
          result = await getClient(profileArg).generateKubeconfig(
            resolveOrganizationName(
              args as Record<string, unknown> | undefined,
              profiles
            ),
            args?.cloudspaceName as string
          );
          break;

        // Pricing
        case "get_market_pricing":
          result = await getClient(profileArg).getMarketPriceCapacity();
          break;
        case "get_price_history":
          result = await getClient(profileArg).getPriceHistory(
            args?.serverClass as string,
            args?.region as string
          );
          break;
        case "get_percentile_pricing":
          result = await getClient(profileArg).getPercentileInformation();
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
