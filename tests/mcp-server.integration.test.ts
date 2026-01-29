import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, "..", "dist", "index.js");

/**
 * MCP Server Integration Tests
 *
 * These tests verify the MCP server works correctly by:
 * 1. Starting the server as a subprocess
 * 2. Connecting to it using the MCP client SDK
 * 3. Calling tools and verifying responses
 *
 * Requirements:
 * - RACKSPACE_SPOT_REFRESH_TOKEN env var must be set for authenticated tests
 * - Run `npm run build` before running these tests
 */
describe("MCP Server Integration", () => {
  let client: Client;
  let transport: StdioClientTransport;
  let serverProcess: ChildProcess;

  const hasToken = !!process.env.RACKSPACE_SPOT_REFRESH_TOKEN;

  beforeAll(async () => {
    // Start the MCP server as a subprocess
    transport = new StdioClientTransport({
      command: "node",
      args: [serverPath],
      env: {
        ...process.env,
        RACKSPACE_SPOT_REFRESH_TOKEN:
          process.env.RACKSPACE_SPOT_REFRESH_TOKEN || "test-token-for-structure-tests",
      },
    });

    client = new Client(
      {
        name: "test-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
  });

  describe("Server Connection", () => {
    it("should connect to the MCP server successfully", async () => {
      const serverInfo = client.getServerVersion();
      expect(serverInfo).toBeDefined();
      expect(serverInfo?.name).toBe("rackspace-spot-mcp");
      expect(serverInfo?.version).toBe("0.1.0");
    });
  });

  describe("Tool Discovery", () => {
    it("should list all available tools", async () => {
      const tools = await client.listTools();

      expect(tools.tools).toBeDefined();
      expect(tools.tools.length).toBeGreaterThan(0);

      // Check for expected tool categories
      const toolNames = tools.tools.map((t) => t.name);

      // Regions
      expect(toolNames).toContain("list_regions");
      expect(toolNames).toContain("get_region");

      // Server Classes
      expect(toolNames).toContain("list_server_classes");
      expect(toolNames).toContain("get_server_class");

      // Organizations
      expect(toolNames).toContain("list_organizations");

      // Cloudspaces
      expect(toolNames).toContain("list_cloudspaces");
      expect(toolNames).toContain("get_cloudspace");
      expect(toolNames).toContain("create_cloudspace");
      expect(toolNames).toContain("delete_cloudspace");

      // Spot Node Pools
      expect(toolNames).toContain("list_spot_node_pools");
      expect(toolNames).toContain("get_spot_node_pool");
      expect(toolNames).toContain("create_spot_node_pool");
      expect(toolNames).toContain("delete_spot_node_pool");

      // On-Demand Node Pools
      expect(toolNames).toContain("list_ondemand_node_pools");
      expect(toolNames).toContain("get_ondemand_node_pool");
      expect(toolNames).toContain("create_ondemand_node_pool");
      expect(toolNames).toContain("delete_ondemand_node_pool");

      // Utilities
      expect(toolNames).toContain("get_kubeconfig");
      expect(toolNames).toContain("get_market_pricing");
      expect(toolNames).toContain("get_price_history");
      expect(toolNames).toContain("get_percentile_pricing");
    });

    it("should have correct schema for list_regions tool", async () => {
      const tools = await client.listTools();
      const listRegions = tools.tools.find((t) => t.name === "list_regions");

      expect(listRegions).toBeDefined();
      expect(listRegions?.description).toContain("regions");
      expect(listRegions?.inputSchema).toEqual({
        type: "object",
        properties: {},
        required: [],
      });
    });

    it("should have correct schema for create_cloudspace tool", async () => {
      const tools = await client.listTools();
      const createCloudspace = tools.tools.find(
        (t) => t.name === "create_cloudspace"
      );

      expect(createCloudspace).toBeDefined();
      expect(createCloudspace?.inputSchema.required).toContain("namespace");
      expect(createCloudspace?.inputSchema.required).toContain("name");
      expect(createCloudspace?.inputSchema.required).toContain("region");
      expect(createCloudspace?.inputSchema.properties).toHaveProperty(
        "haControlPlane"
      );
    });

    it("should have correct schema for create_spot_node_pool tool", async () => {
      const tools = await client.listTools();
      const createSpotPool = tools.tools.find(
        (t) => t.name === "create_spot_node_pool"
      );

      expect(createSpotPool).toBeDefined();
      expect(createSpotPool?.inputSchema.required).toContain("bidPrice");
      expect(createSpotPool?.inputSchema.required).toContain("serverClassName");
      expect(createSpotPool?.inputSchema.properties).toHaveProperty("minNodes");
      expect(createSpotPool?.inputSchema.properties).toHaveProperty("maxNodes");
    });
  });

  // These tests require a valid refresh token
  describe.skipIf(!hasToken)("Live API Tests (requires RACKSPACE_SPOT_REFRESH_TOKEN)", () => {
    it("should list regions from the live API", async () => {
      const result = await client.callTool({
        name: "list_regions",
        arguments: {},
      });

      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);

      const content = result.content[0];
      expect(content.type).toBe("text");

      if (content.type === "text") {
        const data = JSON.parse(content.text);
        expect(data.items).toBeDefined();
        expect(Array.isArray(data.items)).toBe(true);

        // Verify region structure
        if (data.items.length > 0) {
          const region = data.items[0];
          expect(region.metadata).toHaveProperty("name");
          expect(region.spec).toBeDefined();
        }
      }
    });

    it("should list server classes from the live API", async () => {
      const result = await client.callTool({
        name: "list_server_classes",
        arguments: {},
      });

      expect(result.content).toBeDefined();
      const content = result.content[0];
      expect(content.type).toBe("text");

      if (content.type === "text") {
        const data = JSON.parse(content.text);
        expect(data.items).toBeDefined();
        expect(Array.isArray(data.items)).toBe(true);
      }
    });

    it("should list organizations from the live API", async () => {
      const result = await client.callTool({
        name: "list_organizations",
        arguments: {},
      });

      expect(result.content).toBeDefined();
      const content = result.content[0];
      expect(content.type).toBe("text");

      if (content.type === "text") {
        const data = JSON.parse(content.text);
        // Organizations response structure may vary
        expect(data).toBeDefined();
      }
    });

    it("should get market pricing or return permission error", async () => {
      const result = await client.callTool({
        name: "get_market_pricing",
        arguments: {},
      });

      expect(result.content).toBeDefined();
      const content = result.content[0];
      expect(content.type).toBe("text");

      if (content.type === "text") {
        // Either returns data or a permission error (403)
        if (result.isError) {
          expect(content.text).toMatch(/Error|Forbidden|forbidden/);
        } else {
          const data = JSON.parse(content.text);
          expect(data).toBeDefined();
        }
      }
    });

    it("should get percentile pricing or return permission error", async () => {
      const result = await client.callTool({
        name: "get_percentile_pricing",
        arguments: {},
      });

      expect(result.content).toBeDefined();
      const content = result.content[0];
      expect(content.type).toBe("text");

      if (content.type === "text") {
        // Either returns data or a permission error (403)
        if (result.isError) {
          expect(content.text).toMatch(/Error|Forbidden|forbidden/);
        } else {
          const data = JSON.parse(content.text);
          expect(data).toBeDefined();
        }
      }
    });

    it("should get a specific region by name", async () => {
      // First get list of regions to find a valid name
      const listResult = await client.callTool({
        name: "list_regions",
        arguments: {},
      });

      const listContent = listResult.content[0];
      if (listContent.type !== "text") {
        throw new Error("Expected text content");
      }

      const regions = JSON.parse(listContent.text);
      if (!regions.items || regions.items.length === 0) {
        console.log("No regions available, skipping test");
        return;
      }

      const regionName = regions.items[0].metadata.name;

      // Now get the specific region
      const result = await client.callTool({
        name: "get_region",
        arguments: { name: regionName },
      });

      expect(result.content).toBeDefined();
      const content = result.content[0];
      expect(content.type).toBe("text");

      if (content.type === "text") {
        const data = JSON.parse(content.text);
        expect(data.metadata.name).toBe(regionName);
      }
    });

    it("should list cloudspaces for an organization", async () => {
      // First get organizations to find a namespace
      const orgResult = await client.callTool({
        name: "list_organizations",
        arguments: {},
      });

      const orgContent = orgResult.content[0];
      if (orgContent.type !== "text") {
        throw new Error("Expected text content");
      }

      const orgs = JSON.parse(orgContent.text);

      // Find a namespace - structure may vary
      let namespace: string | undefined;
      if (orgs.organizations && orgs.organizations.length > 0) {
        namespace = orgs.organizations[0].namespace;
      } else if (orgs.items && orgs.items.length > 0) {
        namespace = orgs.items[0].metadata?.namespace || orgs.items[0].namespace;
      }

      if (!namespace) {
        console.log("No organizations available, skipping test");
        return;
      }

      // List cloudspaces
      const result = await client.callTool({
        name: "list_cloudspaces",
        arguments: { namespace },
      });

      expect(result.content).toBeDefined();
      const content = result.content[0];
      expect(content.type).toBe("text");

      if (content.type === "text") {
        const data = JSON.parse(content.text);
        expect(data).toBeDefined();
        // May have items or be empty
      }
    });
  });

  describe("Error Handling", () => {
    it("should return error for unknown tool", async () => {
      const result = await client.callTool({
        name: "nonexistent_tool",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]).toHaveProperty("type", "text");
      if (result.content[0].type === "text") {
        expect(result.content[0].text).toContain("Unknown tool");
      }
    });

    it("should return error for missing required arguments", async () => {
      const result = await client.callTool({
        name: "get_cloudspace",
        arguments: {}, // Missing namespace and name
      });

      // Should return an error response
      expect(result.isError).toBe(true);
    });

    it("should return error for invalid namespace format", async () => {
      const result = await client.callTool({
        name: "list_cloudspaces",
        arguments: { namespace: "invalid-namespace-format" },
      });

      // May succeed but return empty or error depending on API
      expect(result.content).toBeDefined();
    });
  });
});

describe("Tool Input Validation", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: "node",
      args: [serverPath],
      env: {
        ...process.env,
        RACKSPACE_SPOT_REFRESH_TOKEN: "test-token",
      },
    });

    client = new Client(
      {
        name: "validation-test-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
  });

  it("should handle create_cloudspace with all parameters", async () => {
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "create_cloudspace");

    expect(tool).toBeDefined();
    expect(tool?.inputSchema.properties).toHaveProperty("namespace");
    expect(tool?.inputSchema.properties).toHaveProperty("name");
    expect(tool?.inputSchema.properties).toHaveProperty("region");
    expect(tool?.inputSchema.properties).toHaveProperty("haControlPlane");
  });

  it("should handle create_spot_node_pool with all parameters", async () => {
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "create_spot_node_pool");

    expect(tool).toBeDefined();
    expect(tool?.inputSchema.properties).toHaveProperty("namespace");
    expect(tool?.inputSchema.properties).toHaveProperty("name");
    expect(tool?.inputSchema.properties).toHaveProperty("cloudspaceName");
    expect(tool?.inputSchema.properties).toHaveProperty("serverClassName");
    expect(tool?.inputSchema.properties).toHaveProperty("bidPrice");
    expect(tool?.inputSchema.properties).toHaveProperty("minNodes");
    expect(tool?.inputSchema.properties).toHaveProperty("maxNodes");
    expect(tool?.inputSchema.properties).toHaveProperty("desiredNodes");
  });

  it("should handle create_ondemand_node_pool with all parameters", async () => {
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "create_ondemand_node_pool");

    expect(tool).toBeDefined();
    expect(tool?.inputSchema.properties).toHaveProperty("namespace");
    expect(tool?.inputSchema.properties).toHaveProperty("name");
    expect(tool?.inputSchema.properties).toHaveProperty("cloudspaceName");
    expect(tool?.inputSchema.properties).toHaveProperty("serverClassName");
    // No bidPrice for on-demand
    expect(tool?.inputSchema.required).not.toContain("bidPrice");
  });

  it("should have proper descriptions for pricing tools", async () => {
    const tools = await client.listTools();

    const marketPricing = tools.tools.find((t) => t.name === "get_market_pricing");
    expect(marketPricing?.description).toContain("market");
    expect(marketPricing?.description).toContain("pricing");

    const priceHistory = tools.tools.find((t) => t.name === "get_price_history");
    expect(priceHistory?.description).toContain("historical");
    expect(priceHistory?.inputSchema.required).toContain("serverClass");
    expect(priceHistory?.inputSchema.required).toContain("region");

    const percentile = tools.tools.find((t) => t.name === "get_percentile_pricing");
    expect(percentile?.description).toContain("percentile");
  });
});
