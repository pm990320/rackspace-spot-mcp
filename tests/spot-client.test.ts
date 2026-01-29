import { describe, it, expect, vi } from "vitest";
import { SpotClient } from "../src/client/spot-client.js";

/**
 * Unit tests for SpotClient
 *
 * Note: Tests that use openapi-fetch internally are more integration-like
 * and are covered by the MCP server integration tests.
 *
 * These unit tests focus on:
 * - Authentication flow
 * - Direct fetch calls (kubeconfig, pricing APIs)
 * - Configuration options
 */

// Create a comprehensive mock fetch that returns proper Response-like objects
function createMockFetch() {
  const responses: Map<
    string,
    { ok: boolean; status: number; data: unknown }
  > = new Map();

  const mockFetch = vi.fn(async (url: string, options?: RequestInit) => {
    // Find matching response by URL pattern
    let matchedResponse: { ok: boolean; status: number; data: unknown } | undefined;

    for (const [pattern, response] of responses) {
      if (url.includes(pattern)) {
        matchedResponse = response;
        break;
      }
    }

    if (!matchedResponse) {
      // Default to auth response for oauth/token
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

    // Create a proper Response-like object
    const responseData = matchedResponse.data;
    const headers = new Headers({
      "content-type": "application/json",
    });

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
    setResponse: (
      urlPattern: string,
      response: { ok: boolean; status: number; data: unknown }
    ) => {
      responses.set(urlPattern, response);
    },
    clearResponses: () => responses.clear(),
  };
}

describe("SpotClient", () => {
  const mockRefreshToken = "test-refresh-token";

  describe("constructor", () => {
    it("should create a client with required config", () => {
      const client = new SpotClient({ refreshToken: mockRefreshToken });
      expect(client).toBeDefined();
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

      // Verify the body contains correct parameters
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

      // Verify the request
      const call = mockFetch.mock.calls[0];
      expect(call[0]).toBe(
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
      expect(call[0]).toBe(
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
      // Should call auth first, then the pricing API with auth header
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://spot.rackspace.com/apis/pricing.ngpc.rxt.io/v1/market-price-capacity",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer mock-id-token",
          }),
        })
      );
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
      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://spot.rackspace.com/apis/pricing.ngpc.rxt.io/v1/percentile",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer mock-id-token",
          }),
        })
      );
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
      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://spot.rackspace.com/apis/ngpc.rxt.io/v1/serverclasses/m3.medium/regions/us-central-dfw-1/price-history",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer mock-id-token",
          }),
        })
      );
    });

    it("should throw on pricing API failure", async () => {
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
