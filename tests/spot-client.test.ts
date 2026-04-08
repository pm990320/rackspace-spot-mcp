import { describe, it, expect, vi } from "vitest";
import { SpotClient } from "../src/client/spot-client.js";
import { SpotClient as ExportedSpotClient } from "../src/client/index.js";

type MockResponse = { ok: boolean; status: number; data: unknown };

function createMockFetch() {
  const responses: Map<string, MockResponse> = new Map();

  const mockFetch = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    let url = "";
    if (typeof input === "string") {
      url = input;
    } else if (input instanceof URL) {
      url = input.toString();
    } else {
      url = input.url;
      options = {
        method: input.method,
        headers: input.headers,
        body: input.body as BodyInit | null | undefined,
        ...options,
      };
    }

    let matchedResponse: MockResponse | undefined;
    for (const [pattern, response] of responses) {
      if (url.includes(pattern)) {
        matchedResponse = response;
        break;
      }
    }

    if (!matchedResponse) {
      if (url.includes("/oauth/token")) {
        matchedResponse = {
          ok: true,
          status: 200,
          data: {
            id_token: "mock-id-token",
            access_token: "mock-access-token",
            expires_in: 86400,
            token_type: "Bearer",
          },
        };
      } else {
        throw new Error(`No mock response for: ${url}`);
      }
    }

    const responseData = matchedResponse.data;
    const headers = new Headers({ "content-type": "application/json" });

    return {
      ok: matchedResponse.ok,
      status: matchedResponse.status,
      statusText: matchedResponse.ok ? "OK" : "Error",
      headers,
      json: () => Promise.resolve(responseData),
      text: () => Promise.resolve(JSON.stringify(responseData)),
      clone: function () {
        return this;
      },
    } as Response;
  });

  return {
    mockFetch,
    setResponse: (urlPattern: string, response: MockResponse) => {
      responses.set(urlPattern, response);
    },
  };
}

describe("SpotClient", () => {
  const mockRefreshToken = "test-refresh-token";

  describe("constructor", () => {
    it("should create a client with required config", () => {
      const client = new SpotClient({ refreshToken: mockRefreshToken });
      expect(client).toBeDefined();
    });

    it("should export SpotClient from the client barrel", () => {
      expect(ExportedSpotClient).toBe(SpotClient);
    });

    it("should accept custom fetch function", () => {
      const { mockFetch } = createMockFetch();
      const client = new SpotClient({
        refreshToken: mockRefreshToken,
        fetch: mockFetch as unknown as typeof fetch,
      });
      expect(client).toBeDefined();
    });

    it("should accept custom base URLs", () => {
      const client = new SpotClient({
        refreshToken: mockRefreshToken,
        baseUrl: "https://custom-api.example.com",
        authUrl: "https://custom-auth.example.com",
      });
      expect(client).toBeDefined();
    });
  });

  describe("authenticate", () => {
    it("should authenticate with correct parameters", async () => {
      const { mockFetch, setResponse } = createMockFetch();
      setResponse("/oauth/token", {
        ok: true,
        status: 200,
        data: {
          id_token: "mock-id-token",
          access_token: "mock-access-token",
          expires_in: 86400,
          token_type: "Bearer",
        },
      });

      const client = new SpotClient({
        refreshToken: mockRefreshToken,
        fetch: mockFetch as unknown as typeof fetch,
      });

      await client.authenticate();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://login.spot.rackspace.com/oauth/token",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        })
      );

      const call = mockFetch.mock.calls[0];
      const body = call[1]?.body as URLSearchParams;
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("client_id")).toBe("mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa");
      expect(body.get("refresh_token")).toBe(mockRefreshToken);
    });

    it("should use custom auth URL when provided", async () => {
      const { mockFetch, setResponse } = createMockFetch();
      setResponse("/oauth/token", {
        ok: true,
        status: 200,
        data: {
          id_token: "mock-id-token",
          access_token: "mock-access-token",
          expires_in: 86400,
          token_type: "Bearer",
        },
      });

      const client = new SpotClient({
        refreshToken: mockRefreshToken,
        fetch: mockFetch as unknown as typeof fetch,
        authUrl: "https://custom-auth.example.com",
      });

      await client.authenticate();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://custom-auth.example.com/oauth/token",
        expect.anything()
      );
    });

    it("should throw on authentication failure", async () => {
      const { mockFetch, setResponse } = createMockFetch();
      setResponse("/oauth/token", {
        ok: false,
        status: 401,
        data: { error: "Invalid refresh token" },
      });

      const client = new SpotClient({
        refreshToken: mockRefreshToken,
        fetch: mockFetch as unknown as typeof fetch,
      });

      await expect(client.authenticate()).rejects.toThrow(
        "Authentication failed: 401"
      );
    });
  });

  describe("openapi-backed resource APIs", () => {
    const cases = [
      {
        name: "listRegions",
        setup: (setResponse: (urlPattern: string, response: MockResponse) => void) =>
          setResponse("/apis/ngpc.rxt.io/v1/regions", { ok: true, status: 200, data: { items: [{ metadata: { name: "us-central-dfw-1" } }] } }),
        call: (client: SpotClient) => client.listRegions(),
      },
      {
        name: "getRegion",
        setup: (setResponse: (urlPattern: string, response: MockResponse) => void) =>
          setResponse("/apis/ngpc.rxt.io/v1/regions/us-central-dfw-1", { ok: true, status: 200, data: { metadata: { name: "us-central-dfw-1" } } }),
        call: (client: SpotClient) => client.getRegion("us-central-dfw-1"),
      },
      {
        name: "listServerClasses",
        setup: (setResponse: (urlPattern: string, response: MockResponse) => void) =>
          setResponse("/apis/ngpc.rxt.io/v1/serverclasses", { ok: true, status: 200, data: { items: [{ metadata: { name: "m3.medium" } }] } }),
        call: (client: SpotClient) => client.listServerClasses(),
      },
      {
        name: "getServerClass",
        setup: (setResponse: (urlPattern: string, response: MockResponse) => void) =>
          setResponse("/apis/ngpc.rxt.io/v1/serverclasses/m3.medium", { ok: true, status: 200, data: { metadata: { name: "m3.medium" } } }),
        call: (client: SpotClient) => client.getServerClass("m3.medium"),
      },
      {
        name: "listOrganizations",
        setup: (setResponse: (urlPattern: string, response: MockResponse) => void) =>
          setResponse("/apis/auth.ngpc.rxt.io/v1/organizations", { ok: true, status: 200, data: [{ name: "gecckio", namespace: "org-gecckio" }] }),
        call: (client: SpotClient) => client.listOrganizations(),
      },
      {
        name: "listCloudspaces",
        setup: (setResponse: (urlPattern: string, response: MockResponse) => void) =>
          setResponse("/apis/ngpc.rxt.io/v1/namespaces/org-gecckio/cloudspaces", { ok: true, status: 200, data: { items: [] } }),
        call: (client: SpotClient) => client.listCloudspaces("org-gecckio"),
      },
      {
        name: "getCloudspace",
        setup: (setResponse: (urlPattern: string, response: MockResponse) => void) =>
          setResponse("/apis/ngpc.rxt.io/v1/namespaces/org-gecckio/cloudspaces/demo", { ok: true, status: 200, data: { metadata: { name: "demo" } } }),
        call: (client: SpotClient) => client.getCloudspace("org-gecckio", "demo"),
      },
      {
        name: "createCloudspace",
        setup: (setResponse: (urlPattern: string, response: MockResponse) => void) =>
          setResponse("/apis/ngpc.rxt.io/v1/namespaces/org-gecckio/cloudspaces", { ok: true, status: 200, data: { status: "created" } }),
        call: (client: SpotClient) => client.createCloudspace("org-gecckio", { name: "demo", region: "us-central-dfw-1" }),
      },
      {
        name: "deleteCloudspace",
        setup: (setResponse: (urlPattern: string, response: MockResponse) => void) =>
          setResponse("/apis/ngpc.rxt.io/v1/namespaces/org-gecckio/cloudspaces/demo", { ok: true, status: 200, data: { status: "deleted" } }),
        call: (client: SpotClient) => client.deleteCloudspace("org-gecckio", "demo"),
      },
      {
        name: "listSpotNodePools",
        setup: (setResponse: (urlPattern: string, response: MockResponse) => void) =>
          setResponse("/apis/ngpc.rxt.io/v1/namespaces/org-gecckio/spotnodepools", { ok: true, status: 200, data: { items: [] } }),
        call: (client: SpotClient) => client.listSpotNodePools("org-gecckio", "demo"),
      },
      {
        name: "getSpotNodePool",
        setup: (setResponse: (urlPattern: string, response: MockResponse) => void) =>
          setResponse("/apis/ngpc.rxt.io/v1/namespaces/org-gecckio/spotnodepools/pool1", { ok: true, status: 200, data: { metadata: { name: "pool1" } } }),
        call: (client: SpotClient) => client.getSpotNodePool("org-gecckio", "pool1"),
      },
      {
        name: "createSpotNodePool",
        setup: (setResponse: (urlPattern: string, response: MockResponse) => void) =>
          setResponse("/apis/ngpc.rxt.io/v1/namespaces/org-gecckio/spotnodepools", { ok: true, status: 200, data: { status: "created" } }),
        call: (client: SpotClient) => client.createSpotNodePool("org-gecckio", { name: "pool1", cloudspaceName: "demo", serverClassName: "m3.medium", bidPrice: "0.05" }),
      },
      {
        name: "deleteSpotNodePool",
        setup: (setResponse: (urlPattern: string, response: MockResponse) => void) =>
          setResponse("/apis/ngpc.rxt.io/v1/namespaces/org-gecckio/spotnodepools/pool1", { ok: true, status: 200, data: { status: "deleted" } }),
        call: (client: SpotClient) => client.deleteSpotNodePool("org-gecckio", "pool1"),
      },
      {
        name: "listOnDemandNodePools",
        setup: (setResponse: (urlPattern: string, response: MockResponse) => void) =>
          setResponse("/apis/ngpc.rxt.io/v1/namespaces/org-gecckio/ondemandnodepools", { ok: true, status: 200, data: { items: [] } }),
        call: (client: SpotClient) => client.listOnDemandNodePools("org-gecckio", "demo"),
      },
      {
        name: "getOnDemandNodePool",
        setup: (setResponse: (urlPattern: string, response: MockResponse) => void) =>
          setResponse("/apis/ngpc.rxt.io/v1/namespaces/org-gecckio/ondemandnodepools/pool1", { ok: true, status: 200, data: { metadata: { name: "pool1" } } }),
        call: (client: SpotClient) => client.getOnDemandNodePool("org-gecckio", "pool1"),
      },
      {
        name: "createOnDemandNodePool",
        setup: (setResponse: (urlPattern: string, response: MockResponse) => void) =>
          setResponse("/apis/ngpc.rxt.io/v1/namespaces/org-gecckio/ondemandnodepools", { ok: true, status: 200, data: { status: "created" } }),
        call: (client: SpotClient) => client.createOnDemandNodePool("org-gecckio", { name: "pool1", cloudspaceName: "demo", serverClassName: "m3.medium" }),
      },
      {
        name: "deleteOnDemandNodePool",
        setup: (setResponse: (urlPattern: string, response: MockResponse) => void) =>
          setResponse("/apis/ngpc.rxt.io/v1/namespaces/org-gecckio/ondemandnodepools/pool1", { ok: true, status: 200, data: { status: "deleted" } }),
        call: (client: SpotClient) => client.deleteOnDemandNodePool("org-gecckio", "pool1"),
      },
    ] as const;

    for (const testCase of cases) {
      it(`should call ${testCase.name} using authenticated openapi client`, async () => {
        const { mockFetch, setResponse } = createMockFetch();
        testCase.setup(setResponse);
        const client = new SpotClient({
          refreshToken: mockRefreshToken,
          fetch: mockFetch as unknown as typeof fetch,
        });

        const result = await testCase.call(client);

        expect(result).toBeDefined();
        expect(mockFetch).toHaveBeenCalled();
        const authCalls = mockFetch.mock.calls.filter(([input]) => String(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url).includes("/oauth/token"));
        expect(authCalls.length).toBe(1);
      });
    }

    it("reuses cached auth tokens across multiple client calls", async () => {
      const { mockFetch, setResponse } = createMockFetch();
      setResponse("/apis/ngpc.rxt.io/v1/regions", { ok: true, status: 200, data: { items: [] } });
      setResponse("/apis/ngpc.rxt.io/v1/serverclasses", { ok: true, status: 200, data: { items: [] } });

      const client = new SpotClient({
        refreshToken: mockRefreshToken,
        fetch: mockFetch as unknown as typeof fetch,
      });

      await client.listRegions();
      await client.listServerClasses();

      const authCalls = mockFetch.mock.calls.filter(([input]) => String(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url).includes("/oauth/token"));
      expect(authCalls.length).toBe(1);
    });

    it("omits label selector when listing spot node pools without cloudspaceName", async () => {
      const { mockFetch, setResponse } = createMockFetch();
      setResponse("/apis/ngpc.rxt.io/v1/namespaces/org-gecckio/spotnodepools", { ok: true, status: 200, data: { items: [] } });

      const client = new SpotClient({
        refreshToken: mockRefreshToken,
        fetch: mockFetch as unknown as typeof fetch,
      });

      await client.listSpotNodePools("org-gecckio");

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const request = lastCall[0] as Request;
      expect(request.url).not.toContain("labelSelector=");
    });

    it("omits label selector when listing on-demand node pools without cloudspaceName", async () => {
      const { mockFetch, setResponse } = createMockFetch();
      setResponse("/apis/ngpc.rxt.io/v1/namespaces/org-gecckio/ondemandnodepools", { ok: true, status: 200, data: { items: [] } });

      const client = new SpotClient({
        refreshToken: mockRefreshToken,
        fetch: mockFetch as unknown as typeof fetch,
      });

      await client.listOnDemandNodePools("org-gecckio");

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const request = lastCall[0] as Request;
      expect(request.url).not.toContain("labelSelector=");
    });

    it("throws when an openapi-backed method returns an error payload", async () => {
      const { mockFetch, setResponse } = createMockFetch();
      setResponse("/apis/ngpc.rxt.io/v1/regions", { ok: false, status: 404, data: { message: "missing" } });

      const client = new SpotClient({
        refreshToken: mockRefreshToken,
        fetch: mockFetch as unknown as typeof fetch,
      });

      await expect(client.listRegions()).rejects.toThrow(/Failed to list regions/);
    });

    it("skips auth middleware for generate-kubeconfig-style URLs", async () => {
      const { mockFetch, setResponse } = createMockFetch();
      setResponse("/generate-kubeconfig", {
        ok: true,
        status: 200,
        data: { data: { kubeconfig: "apiVersion: v1" } },
      });

      const client = new SpotClient({
        refreshToken: mockRefreshToken,
        fetch: mockFetch as unknown as typeof fetch,
      });

      const internalClient = (client as unknown as { client: { GET: (path: string) => Promise<unknown> } }).client;
      await internalClient.GET("/apis/auth.ngpc.rxt.io/v1/generate-kubeconfig");

      const authCalls = mockFetch.mock.calls.filter(([input]) =>
        String(
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
        ).includes("/oauth/token")
      );
      expect(authCalls.length).toBe(0);
    });
  });

  describe("generateKubeconfig", () => {
    it("should generate kubeconfig with correct parameters", async () => {
      const { mockFetch, setResponse } = createMockFetch();
      setResponse("/generate-kubeconfig", {
        ok: true,
        status: 200,
        data: {
          data: { kubeconfig: "apiVersion: v1\nkind: Config..." },
          message: "kubeconfig generated successfully",
          status_code: 200,
        },
      });

      const client = new SpotClient({
        refreshToken: mockRefreshToken,
        fetch: mockFetch as unknown as typeof fetch,
      });

      const result = await client.generateKubeconfig("my-org", "my-cloudspace");

      expect(result).toEqual({
        data: { kubeconfig: "apiVersion: v1\nkind: Config..." },
        message: "kubeconfig generated successfully",
        status_code: 200,
      });

      const call = mockFetch.mock.calls[0];
      const url = typeof call[0] === "string" ? call[0] : call[0] instanceof URL ? call[0].toString() : call[0].url;
      expect(url).toBe(
        "https://spot.rackspace.com/apis/auth.ngpc.rxt.io/v1/generate-kubeconfig"
      );
      expect(call[1]?.method).toBe("POST");

      const body = JSON.parse(call[1]?.body as string);
      expect(body.organization_name).toBe("my-org");
      expect(body.cloudspace_name).toBe("my-cloudspace");
      expect(body.refresh_token).toBe(mockRefreshToken);
    });

    it("should use custom base URL when provided", async () => {
      const { mockFetch, setResponse } = createMockFetch();
      setResponse("/generate-kubeconfig", {
        ok: true,
        status: 200,
        data: { data: { kubeconfig: "..." } },
      });

      const client = new SpotClient({
        refreshToken: mockRefreshToken,
        fetch: mockFetch as unknown as typeof fetch,
        baseUrl: "https://custom-api.example.com",
      });

      await client.generateKubeconfig("org", "cloudspace");

      const call = mockFetch.mock.calls[0];
      const url = typeof call[0] === "string" ? call[0] : call[0] instanceof URL ? call[0].toString() : call[0].url;
      expect(url).toBe(
        "https://custom-api.example.com/apis/auth.ngpc.rxt.io/v1/generate-kubeconfig"
      );
    });

    it("should throw on kubeconfig generation failure", async () => {
      const { mockFetch, setResponse } = createMockFetch();
      setResponse("/generate-kubeconfig", {
        ok: false,
        status: 401,
        data: { error: "Unauthorized" },
      });

      const client = new SpotClient({
        refreshToken: mockRefreshToken,
        fetch: mockFetch as unknown as typeof fetch,
      });

      await expect(
        client.generateKubeconfig("my-org", "my-cloudspace")
      ).rejects.toThrow("Failed to generate kubeconfig: 401");
    });
  });

  describe("pricing APIs", () => {
    it("should get market price capacity", async () => {
      const { mockFetch, setResponse } = createMockFetch();
      const mockPricing = {
        items: [
          { serverClass: "m3.medium", region: "us-central-dfw-1", price: 0.03 },
        ],
      };
      setResponse("/market-price-capacity", {
        ok: true,
        status: 200,
        data: mockPricing,
      });

      const client = new SpotClient({
        refreshToken: mockRefreshToken,
        fetch: mockFetch as unknown as typeof fetch,
      });

      const result = await client.getMarketPriceCapacity();

      expect(result).toEqual(mockPricing);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should get percentile information", async () => {
      const { mockFetch, setResponse } = createMockFetch();
      const mockPercentiles = {
        items: [{ serverClass: "m3.medium", p50: 0.02, p90: 0.04, p99: 0.06 }],
      };
      setResponse("/percentile", {
        ok: true,
        status: 200,
        data: mockPercentiles,
      });

      const client = new SpotClient({
        refreshToken: mockRefreshToken,
        fetch: mockFetch as unknown as typeof fetch,
      });

      const result = await client.getPercentileInformation();

      expect(result).toEqual(mockPercentiles);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should get price history for a server class", async () => {
      const { mockFetch, setResponse } = createMockFetch();
      const mockHistory = {
        serverClass: "m3.medium",
        region: "us-central-dfw-1",
        history: [{ timestamp: "2024-01-01T00:00:00Z", price: 0.03 }],
      };
      setResponse("/price-history", {
        ok: true,
        status: 200,
        data: mockHistory,
      });

      const client = new SpotClient({
        refreshToken: mockRefreshToken,
        fetch: mockFetch as unknown as typeof fetch,
      });

      const result = await client.getPriceHistory("m3.medium", "us-central-dfw-1");

      expect(result).toEqual(mockHistory);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should throw on market pricing API failure", async () => {
      const { mockFetch, setResponse } = createMockFetch();
      setResponse("/market-price-capacity", {
        ok: false,
        status: 500,
        data: { error: "Internal server error" },
      });

      const client = new SpotClient({
        refreshToken: mockRefreshToken,
        fetch: mockFetch as unknown as typeof fetch,
      });

      await expect(client.getMarketPriceCapacity()).rejects.toThrow(
        "Failed to get market price capacity: 500"
      );
    });

    it("should throw on price history API failure", async () => {
      const { mockFetch, setResponse } = createMockFetch();
      setResponse("/price-history", {
        ok: false,
        status: 403,
        data: { error: "Forbidden" },
      });

      const client = new SpotClient({
        refreshToken: mockRefreshToken,
        fetch: mockFetch as unknown as typeof fetch,
      });

      await expect(client.getPriceHistory("m3.medium", "us-central-dfw-1")).rejects.toThrow(
        "Failed to get price history: 403"
      );
    });

    it("should throw on percentile pricing API failure", async () => {
      const { mockFetch, setResponse } = createMockFetch();
      setResponse("/percentile", {
        ok: false,
        status: 429,
        data: { error: "Rate limited" },
      });

      const client = new SpotClient({
        refreshToken: mockRefreshToken,
        fetch: mockFetch as unknown as typeof fetch,
      });

      await expect(client.getPercentileInformation()).rejects.toThrow(
        "Failed to get percentile information: 429"
      );
    });
  });

  describe("configuration", () => {
    it("should use default URLs when not specified", async () => {
      const { mockFetch, setResponse } = createMockFetch();
      setResponse("/oauth/token", {
        ok: true,
        status: 200,
        data: { id_token: "token", expires_in: 86400 },
      });

      const client = new SpotClient({
        refreshToken: mockRefreshToken,
        fetch: mockFetch as unknown as typeof fetch,
      });

      await client.authenticate();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("login.spot.rackspace.com"),
        expect.anything()
      );
    });
  });
});
