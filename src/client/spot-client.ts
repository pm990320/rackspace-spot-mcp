import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "../generated/api.js";

const AUTH_BASE_URL = "https://login.spot.rackspace.com";
const API_BASE_URL = "https://spot.rackspace.com";
const CLIENT_ID = "mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa";

interface TokenResponse {
  access_token: string;
  id_token: string;
  scope: string;
  expires_in: number;
  token_type: string;
}

export interface SpotClientConfig {
  refreshToken: string;
  /** Custom fetch function for testing */
  fetch?: typeof fetch;
  /** Custom base URL for API */
  baseUrl?: string;
  /** Custom auth URL */
  authUrl?: string;
}

export class SpotClient {
  private refreshToken: string;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private client: ReturnType<typeof createClient<paths>>;
  private customFetch: typeof fetch;
  private authBaseUrl: string;
  private apiBaseUrl: string;

  constructor(config: SpotClientConfig) {
    this.refreshToken = config.refreshToken;
    this.customFetch = config.fetch ?? fetch;
    this.authBaseUrl = config.authUrl ?? AUTH_BASE_URL;
    this.apiBaseUrl = config.baseUrl ?? API_BASE_URL;

    const authMiddleware: Middleware = {
      onRequest: async ({ request }) => {
        // Skip auth for endpoints that handle their own auth
        const url = request.url;
        if (
          url.includes("/oauth/token") ||
          url.includes("/generate-kubeconfig")
        ) {
          return request;
        }

        // Ensure we have a valid token
        await this.ensureAuthenticated();

        if (this.accessToken) {
          request.headers.set("Authorization", `Bearer ${this.accessToken}`);
        }
        return request;
      },
    };

    this.client = createClient<paths>({
      baseUrl: this.apiBaseUrl,
      fetch: this.customFetch,
    });
    this.client.use(authMiddleware);
  }

  private async ensureAuthenticated(): Promise<void> {
    // Check if token is still valid (with 60s buffer)
    if (this.accessToken && Date.now() < this.tokenExpiry - 60000) {
      return;
    }

    await this.authenticate();
  }

  async authenticate(): Promise<void> {
    const response = await this.customFetch(`${this.authBaseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        refresh_token: this.refreshToken,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Authentication failed: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as TokenResponse;
    this.accessToken = data.id_token;
    this.tokenExpiry = Date.now() + data.expires_in * 1000;
  }

  // ==================== Regions ====================

  async listRegions() {
    const { data, error } = await this.client.GET("/apis/ngpc.rxt.io/v1/regions");
    if (error) throw new Error(`Failed to list regions: ${JSON.stringify(error)}`);
    return data;
  }

  async getRegion(name: string) {
    const { data, error } = await this.client.GET("/apis/ngpc.rxt.io/v1/regions/{name}", {
      params: { path: { name } },
    });
    if (error) throw new Error(`Failed to get region: ${JSON.stringify(error)}`);
    return data;
  }

  // ==================== Server Classes ====================

  async listServerClasses() {
    const { data, error } = await this.client.GET("/apis/ngpc.rxt.io/v1/serverclasses");
    if (error) throw new Error(`Failed to list server classes: ${JSON.stringify(error)}`);
    return data;
  }

  async getServerClass(name: string) {
    const { data, error } = await this.client.GET("/apis/ngpc.rxt.io/v1/serverclasses/{name}", {
      params: { path: { name } },
    });
    if (error) throw new Error(`Failed to get server class: ${JSON.stringify(error)}`);
    return data;
  }

  // ==================== Organizations ====================

  async listOrganizations() {
    const { data, error } = await this.client.GET("/apis/auth.ngpc.rxt.io/v1/organizations");
    if (error) throw new Error(`Failed to list organizations: ${JSON.stringify(error)}`);
    return data;
  }

  // ==================== Cloudspaces ====================

  async listCloudspaces(namespace: string) {
    const { data, error } = await this.client.GET(
      "/apis/ngpc.rxt.io/v1/namespaces/{namespace}/cloudspaces",
      { params: { path: { namespace } } }
    );
    if (error) throw new Error(`Failed to list cloudspaces: ${JSON.stringify(error)}`);
    return data;
  }

  async getCloudspace(namespace: string, name: string) {
    const { data, error } = await this.client.GET(
      "/apis/ngpc.rxt.io/v1/namespaces/{namespace}/cloudspaces/{name}",
      { params: { path: { namespace, name } } }
    );
    if (error) throw new Error(`Failed to get cloudspace: ${JSON.stringify(error)}`);
    return data;
  }

  async createCloudspace(
    namespace: string,
    cloudspace: {
      name: string;
      region: string;
      haControlPlane?: boolean;
    }
  ) {
    const { data, error } = await this.client.POST(
      "/apis/ngpc.rxt.io/v1/namespaces/{namespace}/cloudspaces",
      {
        params: { path: { namespace } },
        body: {
          apiVersion: "ngpc.rxt.io/v1",
          kind: "CloudSpace",
          metadata: {
            name: cloudspace.name,
            namespace,
          },
          spec: {
            region: cloudspace.region,
            haControlPlane: cloudspace.haControlPlane ?? false,
          },
        } as any,
      }
    );
    if (error) throw new Error(`Failed to create cloudspace: ${JSON.stringify(error)}`);
    return data;
  }

  async deleteCloudspace(namespace: string, name: string) {
    const { data, error } = await this.client.DELETE(
      "/apis/ngpc.rxt.io/v1/namespaces/{namespace}/cloudspaces/{name}",
      { params: { path: { namespace, name } } }
    );
    if (error) throw new Error(`Failed to delete cloudspace: ${JSON.stringify(error)}`);
    return data;
  }

  // ==================== Spot Node Pools ====================

  async listSpotNodePools(namespace: string, cloudspaceName?: string) {
    const { data, error } = await this.client.GET(
      "/apis/ngpc.rxt.io/v1/namespaces/{namespace}/spotnodepools",
      {
        params: {
          path: { namespace },
          query: cloudspaceName
            ? ({ labelSelector: `ngpc.rxt.io/cloudspace=${cloudspaceName}` } as any)
            : undefined,
        },
      }
    );
    if (error) throw new Error(`Failed to list spot node pools: ${JSON.stringify(error)}`);
    return data;
  }

  async getSpotNodePool(namespace: string, name: string) {
    const { data, error } = await this.client.GET(
      "/apis/ngpc.rxt.io/v1/namespaces/{namespace}/spotnodepools/{name}",
      { params: { path: { namespace, name } } }
    );
    if (error) throw new Error(`Failed to get spot node pool: ${JSON.stringify(error)}`);
    return data;
  }

  async createSpotNodePool(
    namespace: string,
    nodePool: {
      name: string;
      cloudspaceName: string;
      serverClassName: string;
      bidPrice: string;
      minNodes?: number;
      maxNodes?: number;
      desiredNodes?: number;
    }
  ) {
    const { data, error } = await this.client.POST(
      "/apis/ngpc.rxt.io/v1/namespaces/{namespace}/spotnodepools",
      {
        params: { path: { namespace } },
        body: {
          apiVersion: "ngpc.rxt.io/v1",
          kind: "SpotNodePool",
          metadata: {
            name: nodePool.name,
            namespace,
            labels: {
              "ngpc.rxt.io/cloudspace": nodePool.cloudspaceName,
            },
          },
          spec: {
            cloudspace: nodePool.cloudspaceName,
            serverClass: nodePool.serverClassName,
            bidPrice: nodePool.bidPrice,
            autoscaling: {
              minNodes: nodePool.minNodes ?? 0,
              maxNodes: nodePool.maxNodes ?? 10,
            },
            desired: nodePool.desiredNodes ?? 1,
          },
        } as any,
      }
    );
    if (error) throw new Error(`Failed to create spot node pool: ${JSON.stringify(error)}`);
    return data;
  }

  async deleteSpotNodePool(namespace: string, name: string) {
    const { data, error } = await this.client.DELETE(
      "/apis/ngpc.rxt.io/v1/namespaces/{namespace}/spotnodepools/{name}",
      { params: { path: { namespace, name } } }
    );
    if (error) throw new Error(`Failed to delete spot node pool: ${JSON.stringify(error)}`);
    return data;
  }

  // ==================== On-Demand Node Pools ====================

  async listOnDemandNodePools(namespace: string, cloudspaceName?: string) {
    const { data, error } = await this.client.GET(
      "/apis/ngpc.rxt.io/v1/namespaces/{namespace}/ondemandnodepools",
      {
        params: {
          path: { namespace },
          query: cloudspaceName
            ? ({ labelSelector: `ngpc.rxt.io/cloudspace=${cloudspaceName}` } as any)
            : undefined,
        },
      }
    );
    if (error) throw new Error(`Failed to list on-demand node pools: ${JSON.stringify(error)}`);
    return data;
  }

  async getOnDemandNodePool(namespace: string, name: string) {
    const { data, error } = await this.client.GET(
      "/apis/ngpc.rxt.io/v1/namespaces/{namespace}/ondemandnodepools/{name}",
      { params: { path: { namespace, name } } }
    );
    if (error) throw new Error(`Failed to get on-demand node pool: ${JSON.stringify(error)}`);
    return data;
  }

  async createOnDemandNodePool(
    namespace: string,
    nodePool: {
      name: string;
      cloudspaceName: string;
      serverClassName: string;
      minNodes?: number;
      maxNodes?: number;
      desiredNodes?: number;
    }
  ) {
    const { data, error } = await this.client.POST(
      "/apis/ngpc.rxt.io/v1/namespaces/{namespace}/ondemandnodepools",
      {
        params: { path: { namespace } },
        body: {
          apiVersion: "ngpc.rxt.io/v1",
          kind: "OnDemandNodePool",
          metadata: {
            name: nodePool.name,
            namespace,
            labels: {
              "ngpc.rxt.io/cloudspace": nodePool.cloudspaceName,
            },
          },
          spec: {
            cloudspace: nodePool.cloudspaceName,
            serverClass: nodePool.serverClassName,
            autoscaling: {
              minNodes: nodePool.minNodes ?? 0,
              maxNodes: nodePool.maxNodes ?? 10,
            },
            desired: nodePool.desiredNodes ?? 1,
          },
        } as any,
      }
    );
    if (error) throw new Error(`Failed to create on-demand node pool: ${JSON.stringify(error)}`);
    return data;
  }

  async deleteOnDemandNodePool(namespace: string, name: string) {
    const { data, error } = await this.client.DELETE(
      "/apis/ngpc.rxt.io/v1/namespaces/{namespace}/ondemandnodepools/{name}",
      { params: { path: { namespace, name } } }
    );
    if (error) throw new Error(`Failed to delete on-demand node pool: ${JSON.stringify(error)}`);
    return data;
  }

  // ==================== Kubeconfig ====================

  async generateKubeconfig(organizationName: string, cloudspaceName: string) {
    const response = await this.customFetch(
      `${this.apiBaseUrl}/apis/auth.ngpc.rxt.io/v1/generate-kubeconfig`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          organization_name: organizationName,
          cloudspace_name: cloudspaceName,
          refresh_token: this.refreshToken,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to generate kubeconfig: ${response.status} - ${error}`);
    }

    return response.json();
  }

  // ==================== Pricing ====================

  async getPriceHistory(serverClass: string, region: string) {
    await this.ensureAuthenticated();
    const response = await this.customFetch(
      `${this.apiBaseUrl}/apis/ngpc.rxt.io/v1/serverclasses/${serverClass}/regions/${region}/price-history`,
      {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get price history: ${response.status} - ${error}`);
    }

    return response.json();
  }

  async getMarketPriceCapacity() {
    await this.ensureAuthenticated();
    const response = await this.customFetch(
      `${this.apiBaseUrl}/apis/pricing.ngpc.rxt.io/v1/market-price-capacity`,
      {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get market price capacity: ${response.status} - ${error}`);
    }

    return response.json();
  }

  async getPercentileInformation() {
    await this.ensureAuthenticated();
    const response = await this.customFetch(
      `${this.apiBaseUrl}/apis/pricing.ngpc.rxt.io/v1/percentile`,
      {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get percentile information: ${response.status} - ${error}`);
    }

    return response.json();
  }
}
