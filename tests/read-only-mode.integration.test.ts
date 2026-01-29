import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, "..", "dist", "index.js");

// Writable tools that should be hidden in read-only mode
const WRITABLE_TOOLS = [
  "create_cloudspace",
  "delete_cloudspace",
  "create_spot_node_pool",
  "delete_spot_node_pool",
  "create_ondemand_node_pool",
  "delete_ondemand_node_pool",
];

// Read-only tools that should always be available
const READ_ONLY_TOOLS = [
  "list_regions",
  "get_region",
  "list_server_classes",
  "get_server_class",
  "list_organizations",
  "list_cloudspaces",
  "get_cloudspace",
  "list_spot_node_pools",
  "get_spot_node_pool",
  "list_ondemand_node_pools",
  "get_ondemand_node_pool",
  "get_kubeconfig",
  "get_market_pricing",
  "get_price_history",
  "get_percentile_pricing",
];

describe("Read-Only Mode", () => {
  let readOnlyClient: Client;
  let readOnlyTransport: StdioClientTransport;

  let readWriteClient: Client;
  let readWriteTransport: StdioClientTransport;

  beforeAll(async () => {
    // Start a server in read-only mode
    readOnlyTransport = new StdioClientTransport({
      command: "node",
      args: [serverPath],
      env: {
        ...process.env,
        RACKSPACE_SPOT_REFRESH_TOKEN: "test-token",
        RACKSPACE_SPOT_READ_ONLY: "true",
      },
    });

    readOnlyClient = new Client(
      {
        name: "read-only-test-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    await readOnlyClient.connect(readOnlyTransport);

    // Start a server in read-write mode (default)
    readWriteTransport = new StdioClientTransport({
      command: "node",
      args: [serverPath],
      env: {
        ...process.env,
        RACKSPACE_SPOT_REFRESH_TOKEN: "test-token",
        RACKSPACE_SPOT_READ_ONLY: "false",
      },
    });

    readWriteClient = new Client(
      {
        name: "read-write-test-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    await readWriteClient.connect(readWriteTransport);
  });

  afterAll(async () => {
    await readOnlyClient.close();
    await readWriteClient.close();
  });

  describe("Tool Discovery in Read-Only Mode", () => {
    it("should not list writable tools in read-only mode", async () => {
      const tools = await readOnlyClient.listTools();
      const toolNames = tools.tools.map((t) => t.name);

      // Writable tools should NOT be present
      for (const writableTool of WRITABLE_TOOLS) {
        expect(toolNames).not.toContain(writableTool);
      }
    });

    it("should list all read-only tools in read-only mode", async () => {
      const tools = await readOnlyClient.listTools();
      const toolNames = tools.tools.map((t) => t.name);

      // All read-only tools should be present
      for (const readOnlyTool of READ_ONLY_TOOLS) {
        expect(toolNames).toContain(readOnlyTool);
      }
    });

    it("should have correct tool count in read-only mode", async () => {
      const tools = await readOnlyClient.listTools();

      // Should only have read-only tools (18 total - 6 writable = 18 tools)
      expect(tools.tools.length).toBe(READ_ONLY_TOOLS.length);
    });
  });

  describe("Tool Discovery in Read-Write Mode", () => {
    it("should list all tools including writable ones in read-write mode", async () => {
      const tools = await readWriteClient.listTools();
      const toolNames = tools.tools.map((t) => t.name);

      // All writable tools should be present
      for (const writableTool of WRITABLE_TOOLS) {
        expect(toolNames).toContain(writableTool);
      }

      // All read-only tools should also be present
      for (const readOnlyTool of READ_ONLY_TOOLS) {
        expect(toolNames).toContain(readOnlyTool);
      }
    });

    it("should have correct tool count in read-write mode", async () => {
      const tools = await readWriteClient.listTools();

      // Should have all tools
      expect(tools.tools.length).toBe(
        READ_ONLY_TOOLS.length + WRITABLE_TOOLS.length
      );
    });
  });

  describe("Tool Execution in Read-Only Mode", () => {
    it("should block create_cloudspace in read-only mode", async () => {
      const result = await readOnlyClient.callTool({
        name: "create_cloudspace",
        arguments: {
          namespace: "org-test",
          name: "test-cloudspace",
          region: "us-central-dfw-1",
        },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]).toHaveProperty("type", "text");
      if (result.content[0].type === "text") {
        expect(result.content[0].text).toContain("not available in read-only mode");
      }
    });

    it("should block delete_cloudspace in read-only mode", async () => {
      const result = await readOnlyClient.callTool({
        name: "delete_cloudspace",
        arguments: {
          namespace: "org-test",
          name: "test-cloudspace",
        },
      });

      expect(result.isError).toBe(true);
      if (result.content[0].type === "text") {
        expect(result.content[0].text).toContain("not available in read-only mode");
      }
    });

    it("should block create_spot_node_pool in read-only mode", async () => {
      const result = await readOnlyClient.callTool({
        name: "create_spot_node_pool",
        arguments: {
          namespace: "org-test",
          name: "test-pool",
          cloudspaceName: "test-cloudspace",
          serverClassName: "gp.vs1.small-dfw",
          bidPrice: "0.05",
        },
      });

      expect(result.isError).toBe(true);
      if (result.content[0].type === "text") {
        expect(result.content[0].text).toContain("not available in read-only mode");
      }
    });

    it("should block delete_spot_node_pool in read-only mode", async () => {
      const result = await readOnlyClient.callTool({
        name: "delete_spot_node_pool",
        arguments: {
          namespace: "org-test",
          name: "test-pool",
        },
      });

      expect(result.isError).toBe(true);
      if (result.content[0].type === "text") {
        expect(result.content[0].text).toContain("not available in read-only mode");
      }
    });

    it("should block create_ondemand_node_pool in read-only mode", async () => {
      const result = await readOnlyClient.callTool({
        name: "create_ondemand_node_pool",
        arguments: {
          namespace: "org-test",
          name: "test-pool",
          cloudspaceName: "test-cloudspace",
          serverClassName: "gp.vs1.small-dfw",
        },
      });

      expect(result.isError).toBe(true);
      if (result.content[0].type === "text") {
        expect(result.content[0].text).toContain("not available in read-only mode");
      }
    });

    it("should block delete_ondemand_node_pool in read-only mode", async () => {
      const result = await readOnlyClient.callTool({
        name: "delete_ondemand_node_pool",
        arguments: {
          namespace: "org-test",
          name: "test-pool",
        },
      });

      expect(result.isError).toBe(true);
      if (result.content[0].type === "text") {
        expect(result.content[0].text).toContain("not available in read-only mode");
      }
    });
  });
});

describe("Read-Only Mode with RACKSPACE_SPOT_READ_ONLY=1", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    // Test with "1" value instead of "true"
    transport = new StdioClientTransport({
      command: "node",
      args: [serverPath],
      env: {
        ...process.env,
        RACKSPACE_SPOT_REFRESH_TOKEN: "test-token",
        RACKSPACE_SPOT_READ_ONLY: "1",
      },
    });

    client = new Client(
      {
        name: "read-only-1-test-client",
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

  it("should enable read-only mode with RACKSPACE_SPOT_READ_ONLY=1", async () => {
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);

    // Writable tools should NOT be present
    expect(toolNames).not.toContain("create_cloudspace");
    expect(toolNames).not.toContain("delete_cloudspace");
  });
});

describe("Default Mode (without RACKSPACE_SPOT_READ_ONLY)", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    // Start server without RACKSPACE_SPOT_READ_ONLY
    const envWithoutReadOnly = { ...process.env };
    delete envWithoutReadOnly.RACKSPACE_SPOT_READ_ONLY;

    transport = new StdioClientTransport({
      command: "node",
      args: [serverPath],
      env: {
        ...envWithoutReadOnly,
        RACKSPACE_SPOT_REFRESH_TOKEN: "test-token",
      },
    });

    client = new Client(
      {
        name: "default-mode-test-client",
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

  it("should default to read-write mode when RACKSPACE_SPOT_READ_ONLY is not set", async () => {
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);

    // All writable tools should be present
    for (const writableTool of WRITABLE_TOOLS) {
      expect(toolNames).toContain(writableTool);
    }
  });
});
